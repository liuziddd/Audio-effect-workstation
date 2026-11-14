/**
 * 音乐信息检索：节拍速度（BPM）与调性（Key），零依赖纯 TS，跑在 Worker 里。
 *
 * 算法参考（均为开源项目 / 公开论文，此处为轻量重实现，不引入依赖）：
 * · SuperFlux（S. Böck & G. Widmer, 2013）：对数谱 + 频率方向极大值滤波 + 正向差分。
 *   比普通谱通量更抗颤音 / 滑音造成的假起音，是 madmom / Essentia 的常用 ODF。
 * · Essentia RhythmExtractor2013 / librosa.beat：40–208 BPM 搜索、局部归一化自相关、
 *   谐波和与节奏先验压制 octave error、半拍加倍校验。
 * · Essentia KeyExtractor / E. Gómez "Tonal Description of Polyphonic Audio" (2006)：
 *   谱峰（Blackman-Harris + 抛物线插值）→ HPCP 谐波归位的音调类剖面 → 调性模板相关。
 * · Essentia Key 的 multi-profile 方法（Faraldo et al., 2017）：多组模板投票降低单一模板偏差；
 *   模板数值取自 MTG/essentia `src/algorithms/tonal/key.cpp`（Shaath / EDMA）。
 *
 * 与上一版的关键差别：
 *   BPM 起音改成 SuperFlux，候选只从最强的两个自相关峰派生（多派生的 1.22×、1.5× 等假节拍层会毁掉结果）；
 *   调性改为整首分析、主谱从 110Hz 起（更低的音在 93ms 窗里分不开半音），并按谱平坦度给每帧降权。
 */

import { fft, hann, blackmanHarris } from './fft';

export interface MusicAnalysis {
    bpm: number | null;
    bpmConfidence: number;
    bpmAlternatives: number[];
    key: string | null;
    keyConfidence: number;
    keyAlternatives: string[];
    /** 12 维归一化音调类剖面，顺序 C, C#, … B，供 UI 绘制 */
    chroma: number[];
}

const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 取一段代表窗口：长音频跳过头尾，最多 maxSec 秒 */
const analysisWindow = (mono: Float32Array, sampleRate: number, maxSec: number, skipSec: number): Float32Array => {
    const total = mono.length / sampleRate;
    if (total <= maxSec) return mono;
    const start = Math.floor(Math.min(skipSec, (total - maxSec) / 2) * sampleRate);
    const end = Math.min(mono.length, start + Math.floor(maxSec * sampleRate));
    return mono.subarray(start, end);
};

/** 盒式平均抽取（自带低通，抑制混叠） */
const downsample = (src: Float32Array, factor: number): Float32Array => {
    const out = new Float32Array(Math.floor(src.length / factor));
    for (let i = 0; i < out.length; i++) {
        let sum = 0;
        for (let j = 0; j < factor; j++) sum += src[i * factor + j];
        out[i] = sum / factor;
    }
    return out;
};

/* ------------------------------- BPM ------------------------------- */

const BPM_TARGET_SR = 11025;
const BPM_FRAME = 256;
const BPM_HOP = 64;
const BPM_MIN = 40;
const BPM_MAX = 208;
/** 节奏先验：以 128 BPM 为中心的对数正态（σ 0.7 约等于大半个八度），只用来打破倍/半速的平局 */
const TEMPO_PRIOR_CENTER = 128;
const TEMPO_PRIOR_SIGMA = 0.7;

/**
 * SuperFlux 起音强度包络。
 * 对数幅度谱先做频率方向的 3 点极大值滤波（颤音会让同一个谱峰在两个 bin 之间摆动，
 * 滤波后这种摆动不再产生差分），再与上一帧做正向差分；低频瞬态权重更高，
 * 免得反拍 hi-hat 把周期推到半拍。
 */
const onsetEnvelope = (mono: Float32Array, sampleRate: number) => {
    const factor = Math.max(1, Math.round(sampleRate / BPM_TARGET_SR));
    const sig = factor > 1 ? downsample(mono, factor) : mono;
    const fs = sampleRate / factor;
    const frameRate = fs / BPM_HOP;
    const frames = Math.floor((sig.length - BPM_FRAME) / BPM_HOP);
    if (frames < 256) return { onset: new Float32Array(0), frameRate };

    const half = BPM_FRAME / 2;
    const window = hann(BPM_FRAME);
    const re = new Float32Array(BPM_FRAME);
    const im = new Float32Array(BPM_FRAME);
    const prev = new Float32Array(half);
    const cur = new Float32Array(half);
    const flux = new Float32Array(frames);
    const binMin = Math.max(2, Math.floor((30 * BPM_FRAME) / fs));
    const binMax = Math.min(half - 2, Math.ceil((5000 * BPM_FRAME) / fs));
    const bandWeight = new Float32Array(half);
    for (let k = binMin; k <= binMax; k++) {
        const hz = (k * fs) / BPM_FRAME;
        bandWeight[k] = hz < 200 ? 1.5 : hz < 1500 ? 1 : 0.6;
    }

    for (let f = 0; f < frames; f++) {
        const start = f * BPM_HOP;
        for (let i = 0; i < BPM_FRAME; i++) {
            re[i] = sig[start + i] * window[i];
            im[i] = 0;
        }
        fft(re, im);
        for (let k = 0; k <= binMax + 1; k++) {
            cur[k] = Math.log1p((40 * Math.sqrt(re[k] * re[k] + im[k] * im[k])) / half);
        }
        let sum = 0;
        for (let k = binMin; k <= binMax; k++) {
            const peak = Math.max(cur[k - 1], cur[k], cur[k + 1]);
            const delta = peak - prev[k];
            if (delta > 0) sum += bandWeight[k] * delta;
        }
        for (let k = 0; k <= binMax + 1; k++) prev[k] = cur[k];
        flux[f] = sum;
    }

    // 减去 200ms 局部均值：渐强、总线压缩这类「整体能量抬升」不再被当成节拍
    const prefix = new Float32Array(frames + 1);
    for (let i = 0; i < frames; i++) prefix[i + 1] = prefix[i] + flux[i];
    const win = Math.max(4, Math.round(frameRate * 0.2));
    const onset = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
        const a = Math.max(0, i - win);
        const b = Math.min(frames, i + win + 1);
        onset[i] = Math.max(0, flux[i] - (prefix[b] - prefix[a]) / (b - a));
    }
    // 3 点平滑，容忍起音落点有 ±1 帧抖动
    const smoothed = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
        smoothed[i] = (onset[Math.max(0, i - 1)] + 2 * onset[i] + onset[Math.min(frames - 1, i + 1)]) / 4;
    }
    // 归一到单位标准差，后面的脉冲拟合与阈值判断才与录音电平无关
    let sq = 0;
    for (let i = 0; i < frames; i++) sq += smoothed[i] * smoothed[i];
    const sd = Math.sqrt(sq / frames) || 1;
    for (let i = 0; i < frames; i++) smoothed[i] /= sd;
    return { onset: smoothed, frameRate };
};

/** 归一化自相关：用前缀和求局部能量，结果不受重叠长度影响 */
const autocorrelation = (onset: Float32Array, maxLag: number): Float64Array => {
    const n = onset.length;
    const sqPrefix = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) sqPrefix[i + 1] = sqPrefix[i] + onset[i] * onset[i];
    const corr = new Float64Array(maxLag + 1);
    for (let lag = 1; lag <= maxLag; lag++) {
        let dot = 0;
        for (let i = 0; i + lag < n; i++) dot += onset[i] * onset[i + lag];
        const a = sqPrefix[n - lag];
        const b = sqPrefix[n] - sqPrefix[lag];
        corr[lag] = a > 0 && b > 0 ? dot / Math.sqrt(a * b) : 0;
    }
    return corr;
};

/**
 * 给一个候选周期铺节拍网格，返回网格上的平均起音强度（取 ±1 帧的最大值，容忍抖动）。
 * 相位先按 period/24 粗搜再在附近逐帧精修。
 */
const gridMean = (onset: Float32Array, period: number, phase: number): number => {
    let sum = 0;
    let count = 0;
    for (let i = phase; i < onset.length; i += period) {
        const left = i > 0 ? onset[i - 1] : 0;
        const center = onset[i];
        const right = i + 1 < onset.length ? onset[i + 1] : 0;
        sum += Math.max(left, center, right);
        count++;
    }
    return count ? sum / count : 0;
};

const pulseFit = (onset: Float32Array, period: number) => {
    let bestPhase = 0;
    let bestScore = -1;
    const steps = Math.max(1, Math.round(period / 24));
    for (let s = 0; s < steps; s++) {
        const phase = Math.round((s * period) / steps);
        const score = gridMean(onset, period, phase);
        if (score > bestScore) {
            bestScore = score;
            bestPhase = phase;
        }
    }
    const span = Math.max(1, Math.round(period / steps));
    for (let phase = Math.max(0, bestPhase - span); phase <= bestPhase + span; phase++) {
        const score = gridMean(onset, period, phase);
        if (score > bestScore) {
            bestScore = score;
            bestPhase = phase;
        }
    }
    return { score: bestScore, phase: bestPhase };
};

interface TempoCandidate { period: number; score: number }

/**
 * 候选周期 = ACF 谐波和最强的两个局部峰的 1 / 2 / ½ / 3 / ⅓ 倍。
 * 只从最强的两个峰派生，是为了避免从弱峰派生出 1.22×、1.5× 这类根本不存在的节拍层。
 */
const tempoCandidates = (onset: Float32Array, frameRate: number): TempoCandidate[] => {
    const n = onset.length;
    const minPeriod = Math.max(3, Math.floor((60 * frameRate) / BPM_MAX));
    const maxPeriod = Math.min(Math.floor(n / 4), Math.ceil((60 * frameRate) / BPM_MIN));
    if (maxPeriod <= minPeriod) return [];

    const maxLag = Math.min(n - 1, maxPeriod * 3);
    const corr = autocorrelation(onset, maxLag);
    let maxCorr = 0;
    for (let lag = minPeriod; lag <= maxPeriod; lag++) maxCorr = Math.max(maxCorr, corr[lag]);
    // 没有任何周期性证据（纯正弦、环境音）时不硬报 BPM
    if (maxCorr < 0.1) return [];

    // 谐波和：真周期在 2L / 3L 处也有共振，把它们叠进来压住半速候选
    const harmonic = new Float32Array(maxPeriod + 1);
    for (let period = minPeriod; period <= maxPeriod; period++) {
        let sum = 0;
        let weight = 0;
        for (let m = 1; m <= 3; m++) {
            const lag = Math.round(period * m);
            if (lag > maxLag) break;
            const w = m === 1 ? 1 : m === 2 ? 0.55 : 0.3;
            sum += w * Math.max(0, corr[lag]);
            weight += w;
        }
        harmonic[period] = sum / weight;
    }

    const peaks: number[] = [];
    for (let period = minPeriod + 1; period < maxPeriod; period++) {
        if (harmonic[period] < harmonic[period - 1] || harmonic[period] < harmonic[period + 1]) continue;
        peaks.push(period);
    }
    peaks.sort((a, b) => harmonic[b] - harmonic[a]);

    const periods = new Set<number>();
    for (const period of peaks.slice(0, 2)) {
        for (const scale of [1, 2, 0.5, 3, 1 / 3]) {
            const candidate = Math.round(period * scale);
            if (candidate >= minPeriod && candidate <= maxPeriod) periods.add(candidate);
        }
    }
    return Array.from(periods, (period) => ({ period, score: harmonic[period] }));
};

const detectTempo = (mono: Float32Array, sampleRate: number) => {
    const { onset, frameRate } = onsetEnvelope(mono, sampleRate);
    if (!onset.length) return { bpm: null, confidence: 0, alternatives: [] as number[] };

    let energy = 0;
    let sqEnergy = 0;
    for (let i = 0; i < onset.length; i++) {
        energy += onset[i];
        sqEnergy += onset[i] * onset[i];
    }
    const mean = energy / onset.length;
    const rms = Math.sqrt(sqEnergy / onset.length);
    // 纯正弦 / 长音 pad 只有起振处一个孤立尖峰，包络极度稀疏，不是持续节奏
    if (Math.abs(mean) < 1e-6 || rms / Math.abs(mean) > 12) {
        return { bpm: null, confidence: 0, alternatives: [] as number[] };
    }

    const candidates = tempoCandidates(onset, frameRate);
    if (!candidates.length) return { bpm: null, confidence: 0, alternatives: [] as number[] };

    /**
     * 自相关谐波和 × 节奏先验。
     * 先验只负责在「拍与半拍都说得通」时做决断（这里用对数正态，128 BPM 附近最宽），
     * 真正区分拍层的是自相关本身：半速候选在 2L 之外没有第三层共振，得分天然更低。
     */
    const scored = candidates.map((c) => {
        const bpm = (60 * frameRate) / c.period;
        const prior = Math.exp(-0.5 * Math.pow(Math.log(bpm / TEMPO_PRIOR_CENTER) / TEMPO_PRIOR_SIGMA, 2));
        return { period: c.period, bpm, total: c.score * prior };
    });
    scored.sort((a, b) => b.total - a.total);
    const best = scored[0];

    /**
     * 半拍检验：慢速候选如果「两拍之间的中点」也踩着起音（如 174 BPM 的鼓组在 87 的网格上
     * 只在正拍留点），说明感知的拍其实是它的两倍，加倍报出。
     */
    let bpm = best.bpm;
    const { phase } = pulseFit(onset, best.period);
    const onBeat = gridMean(onset, best.period, phase);
    const midBeat = gridMean(onset, best.period, phase + Math.round(best.period / 2));
    if (onBeat > 0 && midBeat / onBeat > 0.55 && bpm * 2 <= BPM_MAX) bpm *= 2;

    const second = scored.find((c) => Math.abs(Math.log(c.bpm / bpm)) > Math.log(1.05));
    const margin = second ? (best.total - second.total) / (best.total || 1) : 1;
    return {
        bpm: Math.round(bpm * 10) / 10,
        confidence: clamp(0.36 + margin * 1.2, 0, 0.95),
        alternatives: scored
            .filter((c) => Math.abs(Math.log(c.bpm / bpm)) > Math.log(1.05))
            .slice(0, 2)
            .map((c) => Math.round(c.bpm * 10) / 10),
    };
};

/* ------------------------------- Key ------------------------------- */

const KEY_FRAME = 4096;
const KEY_HOP = 4096;
/** 调性看整首：比 90 秒窗口稳得多（前奏 / 间奏没有和声的段落会被摊薄） */
const KEY_MAX_SEC = 240;
const KEY_SKIP_SEC = 4;
const REF_FREQ = 261.6255653; // C4 → chroma[0] 对应 C
const HARMONICS = 4;
const HARMONIC_SLOPE = 0.6;  // Essentia Key 的 slope 默认值
/**
 * 主谱下限。低于它的音（贝斯、底鼓）在 93ms 窗里一个 bin 就跨两三个半音，
 * 插值出来的音级是错的，所以不直接进 chroma —— 它们的音高由 2~4 次谐波带上来。
 */
const KEY_MIN_HZ = 110;

interface Peak { freq: number; weight: number }

/** 单帧谱峰：局部极大 + 抛物线插值精化频率 */
const framePeaks = (
    re: Float32Array, im: Float32Array, mag: Float32Array,
    minBin: number, maxBin: number, sampleRate: number,
): Peak[] => {
    let maxMag = 0;
    for (let k = minBin - 1; k <= maxBin + 1; k++) {
        const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
        mag[k] = m;
        if (m > maxMag) maxMag = m;
    }
    if (maxMag < 1e-9) return [];
    const peaks: Peak[] = [];
    for (let k = minBin; k <= maxBin; k++) {
        const b = mag[k];
        if (b <= mag[k - 1] || b < mag[k + 1] || b < maxMag * 1e-3) continue;
        const la = Math.log(mag[k - 1] + 1e-12);
        const lb = Math.log(b + 1e-12);
        const lc = Math.log(mag[k + 1] + 1e-12);
        const denom = la - 2 * lb + lc;
        const delta = Math.abs(denom) > 1e-12 ? clamp((0.5 * (la - lc)) / denom, -0.5, 0.5) : 0;
        peaks.push({ freq: ((k + delta) * sampleRate) / KEY_FRAME, weight: Math.sqrt(b) });
    }
    peaks.sort((a, b) => b.weight - a.weight);
    return peaks;
};

/**
 * HPCP（Gómez 2006）：只取谱峰，按 1~4 次谐波把能量归回候选基音的音级，每帧 L2 归一化后再累加。
 * 累加时按「谱平坦度」给每帧加权：鼓点、噪声帧的幅度谱接近白噪声，
 * 它们的 chroma 只是噪声的投影，会白白摊薄和声。
 */
const computeChroma = (mono: Float32Array, sampleRate: number): number[] | null => {
    const frames = Math.floor((mono.length - KEY_FRAME) / KEY_HOP) + 1;
    if (frames < 8) return null;

    const window = blackmanHarris(KEY_FRAME);
    const re = new Float32Array(KEY_FRAME);
    const im = new Float32Array(KEY_FRAME);
    const mag = new Float32Array(KEY_FRAME / 2 + 2);
    const minBin = Math.max(2, Math.ceil((KEY_MIN_HZ * KEY_FRAME) / sampleRate));
    const maxBin = Math.min(KEY_FRAME / 2 - 2, Math.floor((3500 * KEY_FRAME) / sampleRate));
    if (maxBin <= minBin + 2) return null;

    const chroma = new Float32Array(12);
    let used = 0;

    for (let f = 0; f < frames; f++) {
        const start = f * KEY_HOP;
        for (let i = 0; i < KEY_FRAME; i++) {
            re[i] = mono[start + i] * window[i];
            im[i] = 0;
        }
        fft(re, im);
        const peaks = framePeaks(re, im, mag, minBin, maxBin, sampleRate);
        if (!peaks.length) continue;

        let logSum = 0;
        let linSum = 0;
        for (let k = minBin; k <= maxBin; k++) {
            logSum += Math.log(mag[k] + 1e-12);
            linSum += mag[k];
        }
        const flatness = Math.exp(logSum / (maxBin - minBin + 1)) / (linSum / (maxBin - minBin + 1) + 1e-12);
        const frameWeight = Math.pow(clamp(1 - flatness / 0.35, 0, 1), 1.5);

        const frameChroma = new Float32Array(12);
        for (const peak of peaks.slice(0, 60)) {
            const pitch = 12 * Math.log2(peak.freq / REF_FREQ);
            for (let h = 1; h <= HARMONICS; h++) {
                const pc = pitch - 12 * Math.log2(h);
                const w = peak.weight * Math.pow(HARMONIC_SLOPE, h - 1);
                const base = Math.floor(pc);
                const frac = pc - base;
                const i0 = ((base % 12) + 12) % 12;
                frameChroma[i0] += w * (1 - frac);
                frameChroma[(i0 + 1) % 12] += w * frac;
            }
        }
        let norm = 0;
        for (let i = 0; i < 12; i++) norm += frameChroma[i] * frameChroma[i];
        if (norm < 1e-12) continue;
        const scale = frameWeight / Math.sqrt(norm);
        for (let i = 0; i < 12; i++) chroma[i] += frameChroma[i] * scale;
        used++;
    }
    if (!used) return null;

    let total = 0;
    for (let i = 0; i < 12; i++) total += chroma[i] * chroma[i];
    if (total < 1e-12) return null;
    const scale = 1 / Math.sqrt(total);
    return Array.from(chroma, (v) => v * scale);
};

interface KeyProfile { name: string; weight: number; major: number[]; minor: number[] }

/** 每组模板先做 z-score，混用时才不会被量纲大的模板吃掉 */
const normalise = (values: number[]): number[] => {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length) || 1;
    return values.map((v) => (v - mean) / sd);
};

/** 模板数值取自 Essentia `src/algorithms/tonal/key.cpp`。Shaath 偏流行、EDMA 由电子舞曲语料统计而来 */
const KEY_PROFILES: KeyProfile[] = [
    {
        name: 'Shaath', weight: 1,
        major: normalise([6.6, 2.0, 3.5, 2.3, 4.6, 4.0, 2.5, 5.2, 2.4, 3.7, 2.3, 3.4]),
        minor: normalise([6.5, 2.7, 3.5, 5.4, 2.6, 3.5, 2.5, 5.2, 4.0, 2.7, 4.3, 3.2]),
    },
    {
        name: 'EDMA', weight: 1,
        major: normalise([1.00, 0.29, 0.50, 0.40, 0.60, 0.56, 0.32, 0.80, 0.31, 0.45, 0.42, 0.39]),
        minor: normalise([1.00, 0.31, 0.44, 0.58, 0.33, 0.49, 0.29, 0.78, 0.43, 0.29, 0.53, 0.32]),
    },
];

const pearson = (chroma: number[], profile: number[], shift: number): number => {
    let meanC = 0, meanP = 0;
    for (let i = 0; i < 12; i++) {
        meanC += chroma[i];
        meanP += profile[(i - shift + 12) % 12];
    }
    meanC /= 12; meanP /= 12;
    let num = 0, denC = 0, denP = 0;
    for (let i = 0; i < 12; i++) {
        const dc = chroma[i] - meanC;
        const dp = profile[(i - shift + 12) % 12] - meanP;
        num += dc * dp;
        denC += dc * dc;
        denP += dp * dp;
    }
    return num / Math.sqrt(denC * denP || 1e-12);
};

const labelOf = (index: number): string => {
    const shift = index % 12;
    return `${PITCH_CLASSES[shift]} ${index < 12 ? '大调' : '小调'}`;
};

const detectKey = (mono: Float32Array, sampleRate: number) => {
    const chroma = computeChroma(mono, sampleRate);
    if (!chroma) return { key: null, confidence: 0, alternatives: [] as string[], chroma: [] as number[] };

    const votes = new Float32Array(24);
    for (const { weight, major, minor } of KEY_PROFILES) {
        for (let shift = 0; shift < 12; shift++) {
            votes[shift] += weight * pearson(chroma, major, shift);
            votes[12 + shift] += weight * pearson(chroma, minor, shift);
        }
    }

    const ranked = Array.from(votes, (score, index) => ({ score, index }))
        .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    const margin = Math.max(0, best.score - ranked[1].score);
    return {
        key: labelOf(best.index),
        confidence: clamp(0.4 + margin * 0.8, 0, 0.95),
        alternatives: ranked.slice(1, 3).map((r) => labelOf(r.index)),
        chroma,
    };
};

/** 综合分析入口（供 Worker 调用） */
export const analyzeMusic = (left: Float32Array, right: Float32Array, sampleRate: number): MusicAnalysis => {
    const mono = new Float32Array(left.length);
    for (let i = 0; i < left.length; i++) mono[i] = (left[i] + right[i]) * 0.5;

    const tempo = detectTempo(analysisWindow(mono, sampleRate, 90, 8), sampleRate);
    const key = detectKey(analysisWindow(mono, sampleRate, KEY_MAX_SEC, KEY_SKIP_SEC), sampleRate);
    return {
        bpm: tempo.bpm,
        bpmConfidence: tempo.confidence,
        bpmAlternatives: tempo.alternatives,
        key: key.key,
        keyConfidence: key.confidence,
        keyAlternatives: key.alternatives,
        chroma: key.chroma,
    };
};
