/**
 * 音乐信息检索：节拍速度（BPM）与调性（Key），零依赖纯 TS，跑在 Worker 里。
 *
 * 算法参考（均为开源项目 / 公开论文，此处为轻量重实现，不引入依赖）：
 * · librosa.beat.beat_track / D. Ellis "Beat Tracking by Dynamic Programming" (2007)：
 *   onset strength → 周期估计 → 节拍相位对齐。
 * · Essentia RhythmExtractor2013：40–208 BPM 搜索范围、多特征节奏证据。
 * · Essentia KeyExtractor / E. Gómez "Tonal Description of Polyphonic Audio" (2006)：
 *   SpectralPeaks（Blackman-Harris + 抛物线插值）→ HPCP 谐波音调类剖面 → 调性模板相关。
 * · Essentia Key 的 multi-profile method（Faraldo et al., 2017）：多组模板投票降低单一模板偏差；
 *   模板数值取自 MTG/essentia `src/algorithms/tonal/key.cpp`。
 * · BeatTracker / web-audio-beat-detector（MIT）：纯 JS + Web Worker 的谱通量路线。
 *
 * 与旧实现的关键差别：
 *   BPM 不再用 RMS 包络正差分（易被音量起伏误导），改用对数谱通量 + 自适应去趋势；
 *   用「局部归一化自相关 + 谐波和 + 半拍检验」抑制半速/倍速（octave error），并给低频瞬态加权；
 *   Key 不再把每个 FFT bin 直接丢进音级（泛音会污染 chroma），改用谱峰 + 谐波归位 + 逐帧归一化。
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

/** 只分析有代表性的片段：长音频跳过头尾，最多 90 秒（Essentia 的精度/耗时折中） */
const MAX_ANALYZE_SEC = 90;
const SKIP_HEAD_SEC = 10;

const analysisWindow = (mono: Float32Array, sampleRate: number): Float32Array => {
    const total = mono.length / sampleRate;
    if (total <= MAX_ANALYZE_SEC) return mono;
    const start = Math.floor(Math.min(SKIP_HEAD_SEC, (total - MAX_ANALYZE_SEC) / 2) * sampleRate);
    const end = Math.min(mono.length, start + Math.floor(MAX_ANALYZE_SEC * sampleRate));
    return mono.subarray(start, end);
};

/** 盒式平均抽取（自带低通，抑制混叠），把节拍分析降到约 11kHz */
const downsample = (src: Float32Array, factor: number): Float32Array => {
    const out = new Float32Array(Math.floor(src.length / factor));
    for (let i = 0; i < out.length; i++) {
        let sum = 0;
        for (let j = 0; j < factor; j++) sum += src[i * factor + j];
        out[i] = sum / factor;
    }
    return out;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/* ------------------------------- BPM ------------------------------- */

const BPM_TARGET_SR = 11025;
const BPM_FRAME = 256;
const BPM_HOP = 64; // @11025Hz → 172.27 帧/秒

/** 对数幅度谱的正向差分（谱通量）→ 自适应去趋势 → 平滑，得到 onset 强度包络 */
const onsetEnvelope = (mono: Float32Array, sampleRate: number) => {
    const factor = Math.max(1, Math.round(sampleRate / BPM_TARGET_SR));
    const sig = factor > 1 ? downsample(mono, factor) : mono;
    const fs = sampleRate / factor;
    const frameRate = fs / BPM_HOP;
    const frames = Math.floor((sig.length - BPM_FRAME) / BPM_HOP);
    if (frames < 256) return { onset: new Float32Array(0), frameRate };

    const window = hann(BPM_FRAME);
    const re = new Float32Array(BPM_FRAME);
    const im = new Float32Array(BPM_FRAME);
    const prev = new Float32Array(BPM_FRAME / 2);
    const flux = new Float32Array(frames);
    const binMin = Math.max(1, Math.floor((30 * BPM_FRAME) / fs));
    const binMax = Math.min(BPM_FRAME / 2, Math.ceil((5000 * BPM_FRAME) / fs));
    // 低频瞬态（底鼓/军鼓）权重更高，弱化高频 hi-hat 制造的半拍假周期
    const bandWeight = new Float32Array(binMax);
    for (let k = binMin; k < binMax; k++) {
        const hz = (k * fs) / BPM_FRAME;
        bandWeight[k] = hz < 250 ? 1.6 : hz < 2000 ? 1 : 0.45;
    }

    for (let f = 0; f < frames; f++) {
        const start = f * BPM_HOP;
        for (let i = 0; i < BPM_FRAME; i++) {
            re[i] = sig[start + i] * window[i];
            im[i] = 0;
        }
        fft(re, im);
        let sum = 0;
        for (let k = binMin; k < binMax; k++) {
            const mag = Math.log1p(100 * Math.sqrt(re[k] * re[k] + im[k] * im[k]) / BPM_FRAME);
            const delta = mag - prev[k];
            if (delta > 0) sum += bandWeight[k] * delta;
            prev[k] = mag;
        }
        flux[f] = sum;
    }

    // 减去 150ms 局部均值：渐强、总线压缩这类「整体能量抬升」不再被当成节拍
    const prefix = new Float32Array(frames + 1);
    for (let i = 0; i < frames; i++) prefix[i + 1] = prefix[i] + flux[i];
    const win = Math.max(4, Math.round(frameRate * 0.15));
    const onset = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
        const a = Math.max(0, i - win);
        const b = Math.min(frames, i + win + 1);
        const mean = (prefix[b] - prefix[a]) / (b - a);
        onset[i] = Math.max(0, flux[i] - mean);
    }
    // 3 点平滑，容忍 onset 落点有 ±1 帧抖动
    const smoothed = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
        smoothed[i] = (onset[Math.max(0, i - 1)] + 2 * onset[i] + onset[Math.min(frames - 1, i + 1)]) / 4;
    }
    return { onset: smoothed, frameRate };
};

interface TempoCandidate { bpm: number; score: number; period: number }

/**
 * 局部归一化自相关 + 谐波和。
 * 真实节拍周期 L 的 2L / 3L / 4L 处也会共振，把这些谐波叠进 L 的分数；
 * 半速候选 2L 的谐波落在 4L / 6L（更弱甚至超出范围），倍速候选 L/2 若半拍没有真 onset 也拿不到分，
 * 因此 octave error 被自然抑制 —— 这比「硬偏向 120 BPM」可靠得多。
 */
const tempoCandidates = (onset: Float32Array, frameRate: number): TempoCandidate[] => {
    const n = onset.length;
    const minPeriod = Math.max(2, Math.floor((60 * frameRate) / 208));
    const maxPeriod = Math.min(Math.floor(n / 4), Math.ceil((60 * frameRate) / 40));
    const maxLag = Math.min(n - 1, maxPeriod * 4);
    if (maxPeriod <= minPeriod) return [];

    // 前缀和：O(1) 求每个 lag 的局部能量，得到不受重叠长度影响的归一化互相关
    const sqPrefix = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) sqPrefix[i + 1] = sqPrefix[i] + onset[i] * onset[i];

    const corr = new Float64Array(maxLag + 1);
    let maxCorr = 0;
    for (let lag = 1; lag <= maxLag; lag++) {
        let dot = 0;
        for (let i = 0; i + lag < n; i++) dot += onset[i] * onset[i + lag];
        const a = sqPrefix[n - lag];
        const b = sqPrefix[n] - sqPrefix[lag];
        const value = a > 0 && b > 0 ? dot / Math.sqrt(a * b) : 0;
        corr[lag] = value;
        if (lag >= minPeriod && value > maxCorr) maxCorr = value;
    }
    // 没有任何周期性证据时不硬报 BPM
    if (maxCorr < 0.15) return [];

    const weights = [1, 0.6, 0.35, 0.2];
    const raw: { score: number; period: number }[] = [];
    for (let period = minPeriod; period <= maxPeriod; period++) {
        let harmonic = 0;
        for (let m = 1; m <= weights.length; m++) {
            const lag = Math.round(period * m);
            if (lag <= maxLag) harmonic += weights[m - 1] * Math.max(0, corr[lag]);
        }
        if (harmonic <= 0) continue;
        const bpm = (60 * frameRate) / period;
        // 宽对数正态先验（中心 115、σ≈0.62）只占 20%，用于打破接近候选的平局
        const prior = Math.exp(-0.5 * Math.pow(Math.log(bpm / 115) / 0.62, 2));
        raw.push({ score: harmonic * (0.8 + 0.2 * prior), period });
    }
    if (!raw.length) return [];

    const maxScore = Math.max(...raw.map((r) => r.score));
    if (maxScore <= 1e-8) return [];
    // 抛物线插值精化峰值周期，得到小数 BPM
    const peak = raw.reduce((a, b) => (b.score > a.score ? b : a));
    const at = (period: number) => raw.find((r) => r.period === period)?.score ?? 0;
    const s0 = at(peak.period - 1), s1 = peak.score, s2 = at(peak.period + 1);
    const denom = s0 - 2 * s1 + s2;
    const delta = Math.abs(denom) > 1e-12 ? clamp(0.5 * (s0 - s2) / denom, -0.5, 0.5) : 0;

    return raw.map((r) => ({
        bpm: (60 * frameRate) / (r.period === peak.period ? r.period + delta : r.period),
        score: r.score / maxScore,
        period: r.period,
    }));
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
    // 纯正弦 / 长音 pad 只有起振处一个孤立尖峰，包络极度稀疏（rms/mean 可达数十），
    // 不是持续节奏；真实鼓点该比值通常 2~5。
    if (mean < 1e-5 || (mean > 0 && rms / mean > 12)) {
        return { bpm: null, confidence: 0, alternatives: [] as number[] };
    }

    const candidates = tempoCandidates(onset, frameRate);
    if (!candidates.length) return { bpm: null, confidence: 0, alternatives: [] as number[] };

    // 去重（相差 <3% 视作同一速度），保留分数最高的若干候选
    const ranked = [...candidates].sort((a, b) => b.score - a.score);
    const distinct: TempoCandidate[] = [];
    for (const c of ranked) {
        if (distinct.every((d) => Math.abs(c.bpm - d.bpm) / d.bpm > 0.03)) distinct.push(c);
        if (distinct.length === 3) break;
    }
    let best = distinct[0];
    let octaveResolved = false;

    /**
     * 半拍检验（tempo octave disambiguation）：若最佳周期的半拍位置也有接近整拍强度的 onset，
     * 说明它其实是半速，真实节拍是它的两倍。低频加权已压低反拍 hi-hat，因此不会误伤正常 4/4 曲目。
     */
    const period = Math.round((60 * frameRate) / best.bpm);
    if (period >= 4) {
        let bestPhase = 0;
        let onGrid = 0;
        for (let phase = 0; phase < period; phase++) {
            let sum = 0;
            let count = 0;
            for (let i = phase; i < onset.length; i += period) { sum += onset[i]; count++; }
            const average = count ? sum / count : 0;
            if (average > onGrid) { onGrid = average; bestPhase = phase; }
        }
        let offSum = 0;
        let offCount = 0;
        for (let i = bestPhase + Math.round(period / 2); i < onset.length; i += period) {
            offSum += onset[i];
            offCount++;
        }
        const ratio = onGrid > 0 && offCount > 3 ? (offSum / offCount) / onGrid : 0;
        const target = best.bpm * 2;
        if (ratio > 0.62 && target <= 208) {
            const doubled = ranked.find((c) => Math.abs(c.bpm - target) / target < 0.04);
            if (doubled && doubled.score > best.score * 0.65) {
                best = doubled;
                octaveResolved = true;
            }
        }
    }

    const others = distinct.filter((c) => c !== best);
    if (best !== distinct[0]) others.unshift(distinct[0]);
    const secondScore = ranked.find((c) => Math.abs(c.bpm - best.bpm) / best.bpm > 0.03)?.score ?? 0;
    const margin = (best.score - secondScore) / best.score;
    const bpm = Math.round(best.bpm * 10) / 10;
    // 备选只保留有解释力的半速/倍速候选，并去重
    const alternatives = [...new Set(others.map((c) => Math.round(c.bpm * 10) / 10))]
        .filter((v) => v >= bpm * 0.45 && v <= bpm * 2.1 && Math.abs(v - bpm) > 1)
        .slice(0, 2);
    return {
        bpm,
        // 半拍检验给出了明确的加倍证据，不应因 octave 候选分数接近而标成低置信
        confidence: clamp(Math.max(0.32 + margin * 1.1, octaveResolved ? 0.58 : 0), 0, 0.95),
        alternatives,
    };
};

/* ------------------------------- Key ------------------------------- */

const KEY_FRAME = 4096;
const KEY_HOP = 2048;
const REF_FREQ = 261.6255653; // C4 → chroma[0] 对应 C
const HARMONICS = 4;
const HARMONIC_SLOPE = 0.6;  // Essentia Key 的 slope 默认值

/**
 * HPCP：只取谱峰（局部极大 + 抛物线插值精化频率），按 1~4 次谐波把能量归回候选基音的音级，
 * 每帧单独 L2 归一化后再累加，避免强奏段落或泛音列主宰整首的 chroma。
 */
const computeChroma = (mono: Float32Array, sampleRate: number): number[] | null => {
    const frames = Math.floor((mono.length - KEY_FRAME) / KEY_HOP) + 1;
    if (frames < 8) return null;

    const window = blackmanHarris(KEY_FRAME);
    const re = new Float32Array(KEY_FRAME);
    const im = new Float32Array(KEY_FRAME);
    const minBin = Math.max(2, Math.ceil((60 * KEY_FRAME) / sampleRate));
    const maxBin = Math.min(KEY_FRAME / 2 - 2, Math.floor((3500 * KEY_FRAME) / sampleRate));
    if (maxBin <= minBin + 2) return null;

    const chroma = new Float32Array(12);
    let usedFrames = 0;

    for (let f = 0; f < frames; f++) {
        const start = f * KEY_HOP;
        for (let i = 0; i < KEY_FRAME; i++) {
            re[i] = mono[start + i] * window[i];
            im[i] = 0;
        }
        fft(re, im);

        const mag = new Float32Array(maxBin + 1);
        let maxMag = 0;
        for (let k = minBin - 1; k <= maxBin + 1; k++) {
            const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
            mag[k] = m;
            if (m > maxMag) maxMag = m;
        }
        if (maxMag < 1e-9) continue;

        const peaks: { freq: number; weight: number }[] = [];
        for (let k = minBin; k <= maxBin; k++) {
            const b = mag[k];
            if (b <= mag[k - 1] || b < mag[k + 1] || b < maxMag * 1e-3) continue;
            const la = Math.log(mag[k - 1] + 1e-12);
            const lb = Math.log(b + 1e-12);
            const lc = Math.log(mag[k + 1] + 1e-12);
            const denom = la - 2 * lb + lc;
            const delta = Math.abs(denom) > 1e-12 ? clamp(0.5 * (la - lc) / denom, -0.5, 0.5) : 0;
            peaks.push({ freq: ((k + delta) * sampleRate) / KEY_FRAME, weight: Math.sqrt(b) });
        }
        if (!peaks.length) continue;
        peaks.sort((a, b) => b.weight - a.weight);

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
        const scale = 1 / Math.sqrt(norm);
        for (let i = 0; i < 12; i++) chroma[i] += frameChroma[i] * scale;
        usedFrames++;
    }
    if (!usedFrames) return null;

    let total = 0;
    for (let i = 0; i < 12; i++) total += chroma[i] * chroma[i];
    if (total < 1e-12) return null;
    const scale = 1 / Math.sqrt(total);
    return Array.from(chroma, (v) => v * scale);
};

/** 多组调性模板，数值取自 Essentia 开源实现；多角度投票降低单一模板的系统性偏差 */
const KEY_PROFILES: { name: string; weight: number; major: number[]; minor: number[] }[] = [
    {
        name: 'Krumhansl-Kessler', weight: 1,
        major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
        minor: [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
    },
    {
        name: 'Temperley (MIREX 2005)', weight: 1,
        major: [0.748, 0.060, 0.488, 0.082, 0.670, 0.460, 0.096, 0.715, 0.104, 0.366, 0.057, 0.400],
        minor: [0.712, 0.084, 0.474, 0.618, 0.049, 0.460, 0.105, 0.747, 0.404, 0.067, 0.133, 0.330],
    },
    {
        name: 'Gómez', weight: 0.9,
        major: [0.82, 0.00, 0.55, 0.00, 0.53, 0.30, 0.08, 1.00, 0.00, 0.38, 0.00, 0.47],
        minor: [0.81, 0.00, 0.53, 0.54, 0.00, 0.27, 0.07, 1.00, 0.27, 0.07, 0.10, 0.36],
    },
    {
        name: 'bgate (EDM)', weight: 0.9,
        major: [1.00, 0.00, 0.42, 0.00, 0.53, 0.37, 0.00, 0.77, 0.00, 0.38, 0.21, 0.30],
        minor: [1.00, 0.00, 0.36, 0.39, 0.00, 0.38, 0.00, 0.74, 0.27, 0.00, 0.42, 0.23],
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
        const correlations = new Float32Array(24);
        for (let shift = 0; shift < 12; shift++) {
            correlations[shift] = pearson(chroma, major, shift);
            correlations[12 + shift] = pearson(chroma, minor, shift);
        }
        // 每组模板内部做 z-score，消除不同量纲后再加权投票
        let mean = 0;
        for (let i = 0; i < 24; i++) mean += correlations[i];
        mean /= 24;
        let variance = 0;
        for (let i = 0; i < 24; i++) variance += (correlations[i] - mean) ** 2;
        const sd = Math.sqrt(variance / 24) || 1;
        for (let i = 0; i < 24; i++) votes[i] += weight * (correlations[i] - mean) / sd;
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
    const window = analysisWindow(mono, sampleRate);
    const tempo = detectTempo(window, sampleRate);
    const key = detectKey(window, sampleRate);
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
