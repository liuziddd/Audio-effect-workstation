/**
 * 专业音频检测分析：波形峰值、频谱、电平/响度/削波/相位等指标，及专业评价。
 * 纯函数模块，不依赖 React，输入 AudioBuffer 输出结构化结果。
 */

export interface WaveformPeaks {
    min: number;
    max: number;
}

export interface SpectrumBand {
    freq: number;   // 中心频率 Hz
    level: number;  // 幅值 dB
}

export interface AudioMetrics {
    duration: number;
    sampleRate: number;
    channels: number;
    peakDb: number;            // 峰值电平 dBFS
    truePeakDb: number;        // 真实峰值 dBTP（4x 过采样）
    rmsDb: number;             // RMS 电平 dBFS
    crestDb: number;           // 动态范围（波峰因数）dB
    lufs: number;              // 近似集成响度 LUFS（EBU R128）
    dcOffset: number;          // 直流偏置（归一化）
    clippedSamples: number;    // 削波样本数
    clipRatio: number;         // 削波比例 0~1
    phaseCorrelation: number | null; // 立体声相位相关性 -1~1，单声道为 null
    spectralCentroid: number;  // 频谱质心 Hz
    leadSilenceMs: number;     // 开头静音时长 ms
    tailSilenceMs: number;     // 结尾静音时长 ms
}

export interface AnalysisResult {
    metrics: AudioMetrics;
    peaks: WaveformPeaks[][];   // [声道][桶]
    spectrum: SpectrumBand[];
}

const WAVEFORM_BUCKETS = 1200;
const SPECTRUM_BANDS = 60;
const SILENCE_DB = -60;         // 静音判定阈值 dBFS

const toDb = (x: number) => 20 * Math.log10(Math.max(x, 1e-6));

/** 波形峰值分桶（每桶取 min/max，保留细节不丢包络） */
const computePeaks = (data: Float32Array, buckets: number): WaveformPeaks[] => {
    const result: WaveformPeaks[] = new Array(buckets);
    const per = Math.max(1, Math.floor(data.length / buckets));
    for (let b = 0; b < buckets; b++) {
        let min = 0;
        let max = 0;
        const start = b * per;
        const end = Math.min(start + per, data.length);
        for (let i = start; i < end; i++) {
            const v = data[i];
            if (v < min) min = v;
            if (v > max) max = v;
        }
        result[b] = { min, max };
    }
    return result;
};

/** 迭代 radix-2 FFT（就地），re 为实部，im 为虚部 */
const fft = (re: Float32Array, im: Float32Array): void => {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            [re[i], re[j]] = [re[j], re[i]];
            [im[i], im[j]] = [im[j], im[i]];
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = (-2 * Math.PI) / len;
        const wRe = Math.cos(ang);
        const wIm = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
            let cr = 1;
            let ci = 0;
            const half = len >> 1;
            for (let k = 0; k < half; k++) {
                const uRe = re[i + k];
                const uIm = im[i + k];
                const vRe = re[i + k + half] * cr - im[i + k + half] * ci;
                const vIm = re[i + k + half] * ci + im[i + k + half] * cr;
                re[i + k] = uRe + vRe;
                im[i + k] = uIm + vIm;
                re[i + k + half] = uRe - vRe;
                im[i + k + half] = uIm - vIm;
                const nr = cr * wRe - ci * wIm;
                ci = cr * wIm + ci * wRe;
                cr = nr;
            }
        }
    }
};

/** 对数频段频谱（FFT + Hann 窗 + 能量归并），并返回频谱质心 */
const computeSpectrum = (mono: Float32Array, sampleRate: number) => {
    let n = 1;
    while (n < mono.length) n <<= 1;
    n = Math.min(n, 65536);
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / n)); // Hann
        re[i] = mono[i % mono.length] * w;
    }
    fft(re, im);

    const nyquist = sampleRate / 2;
    const mag: number[] = new Array(n / 2);
    let centroidNum = 0;
    let centroidDen = 0;
    for (let i = 0; i < n / 2; i++) {
        const amp = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / n;
        mag[i] = amp;
        const freq = (i * sampleRate) / n;
        const power = amp * amp;
        centroidNum += freq * power;
        centroidDen += power;
    }

    const loFreq = 20;
    const hiFreq = Math.min(20000, nyquist);
    const bands: SpectrumBand[] = new Array(SPECTRUM_BANDS);
    const loLog = Math.log10(loFreq);
    const hiLog = Math.log10(hiFreq);
    for (let b = 0; b < SPECTRUM_BANDS; b++) {
        const f0 = Math.pow(10, loLog + ((hiLog - loLog) * b) / SPECTRUM_BANDS);
        const f1 = Math.pow(10, loLog + ((hiLog - loLog) * (b + 1)) / SPECTRUM_BANDS);
        const i0 = Math.max(0, Math.floor((f0 * n) / sampleRate));
        const i1 = Math.min(n / 2, Math.ceil((f1 * n) / sampleRate));
        let energy = 0;
        let count = 0;
        for (let i = i0; i < i1; i++) {
            energy += mag[i] * mag[i];
            count++;
        }
        bands[b] = {
            freq: Math.sqrt(f0 * f1),
            level: count ? 10 * Math.log10(Math.max(energy / count, 1e-12)) : -120,
        };
    }
    const spectralCentroid = centroidDen ? centroidNum / centroidDen : 0;
    return { bands, spectralCentroid };
};

/** RBJ 高通滤波器系数 */
const highpassCoeffs = (fs: number, f0: number, q: number) => {
    const w0 = (2 * Math.PI * f0) / fs;
    const alpha = Math.sin(w0) / (2 * q);
    const cos = Math.cos(w0);
    const a0 = 1 + alpha;
    return {
        b0: (1 + cos) / 2 / a0,
        b1: -(1 + cos) / a0,
        b2: (1 + cos) / 2 / a0,
        a1: (-2 * cos) / a0,
        a2: (1 - alpha) / a0,
    };
};

/** RBJ 高架滤波器系数（K-weighting 第一段） */
const highshelfCoeffs = (fs: number, f0: number, q: number, db: number) => {
    const A = Math.sqrt(Math.pow(10, db / 20));
    const w0 = (2 * Math.PI * f0) / fs;
    const alpha = Math.sin(w0) / (2 * q);
    const cos = Math.cos(w0);
    const twoSqrtA = 2 * Math.sqrt(A) * alpha;
    const a0 = A + 1 + (A - 1) * cos + twoSqrtA;
    return {
        b0: (A * (A + 1 + (A - 1) * cos + twoSqrtA)) / a0,
        b1: (-2 * A * (A - 1 + (A + 1) * cos)) / a0,
        b2: (A * (A + 1 + (A - 1) * cos - twoSqrtA)) / a0,
        a1: (2 * (A - 1 - (A + 1) * cos)) / a0,
        a2: (A + 1 - (A - 1) * cos - twoSqrtA) / a0,
    };
};

/** 对样本应用 biquad 滤波（就地），返回新数组 */
const applyBiquad = (data: Float32Array, c: ReturnType<typeof highpassCoeffs>): Float32Array => {
    const out = new Float32Array(data.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < data.length; i++) {
        const x = data[i];
        const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
        out[i] = y;
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
    }
    return out;
};

/** K-weighting 滤波（EBU R128 / ITU-R BS.1770）：高架 +4dB@1681.97Hz 级联高通@38.13Hz */
const applyKWeighting = (data: Float32Array, fs: number): Float32Array =>
    applyBiquad(applyBiquad(data, highshelfCoeffs(fs, 1681.97, 0.7071, 4)), highpassCoeffs(fs, 38.13, 0.5003));

/** 近似集成响度 LUFS（K-weighting + 400ms 块 + 绝对/相对门控） */
const computeLufs = (channels: Float32Array[], fs: number): number => {
    const filtered = channels.map((ch) => applyKWeighting(ch, fs));
    const block = Math.round(0.4 * fs);
    const step = Math.round(0.1 * fs);
    const length = filtered[0].length;
    const loudness: number[] = [];
    for (let start = 0; start + block <= length; start += step) {
        let energy = 0;
        for (const ch of filtered) {
            let sum = 0;
            for (let i = start; i < start + block; i++) sum += ch[i] * ch[i];
            energy += sum / block;
        }
        loudness.push(-0.691 + 10 * Math.log10(Math.max(energy, 1e-12)));
    }
    if (!loudness.length) return -120;

    const meanLoudness = (list: number[]) =>
        10 * Math.log10(list.reduce((s, l) => s + Math.pow(10, l / 10), 0) / list.length);

    let gated = loudness.filter((l) => l > -70); // 绝对门控
    if (!gated.length) return -120;
    for (let i = 0; i < 2; i++) { // 相对门控（迭代两次收敛）
        const mean = meanLoudness(gated);
        gated = gated.filter((l) => l > mean - 10);
        if (!gated.length) return mean;
    }
    return meanLoudness(gated);
};

/** 真实峰值：4x 线性插值后取最大幅值 */
const computeTruePeak = (channels: Float32Array[]): number => {
    let max = 0;
    for (const ch of channels) {
        for (let i = 0; i < ch.length - 1; i++) {
            const a = ch[i];
            const b = ch[i + 1];
            for (let k = 0; k < 4; k++) {
                const v = Math.abs(a + ((b - a) * k) / 4);
                if (v > max) max = v;
            }
        }
    }
    return max;
};

/** 静音段时长：从边界向内连续低于阈值的时长 */
const computeSilence = (data: Float32Array, fs: number, fromTail: boolean): number => {
    const threshold = Math.pow(10, SILENCE_DB / 20);
    let count = 0;
    if (fromTail) {
        for (let i = data.length - 1; i >= 0; i--) {
            if (Math.abs(data[i]) < threshold) count++;
            else break;
        }
    } else {
        for (let i = 0; i < data.length; i++) {
            if (Math.abs(data[i]) < threshold) count++;
            else break;
        }
    }
    return (count / fs) * 1000;
};

/** 综合分析：一次遍历得到全部指标 + 波形 + 频谱 */
export const analyzeAudio = (buffer: AudioBuffer): AnalysisResult => {
    const channels = buffer.numberOfChannels;
    const channelData: Float32Array[] = [];
    for (let c = 0; c < channels; c++) channelData.push(buffer.getChannelData(c));

    const peaks = channelData.map((ch) => computePeaks(ch, WAVEFORM_BUCKETS));
    const mono = new Float32Array(buffer.length);
    for (const ch of channelData) for (let i = 0; i < buffer.length; i++) mono[i] += ch[i] / channels;
    const { bands: spectrum, spectralCentroid } = computeSpectrum(mono, buffer.sampleRate);

    let peakAbs = 0;
    let sumSquare = 0;
    let sumValue = 0;
    let clipped = 0;
    for (const ch of channelData) {
        for (let i = 0; i < ch.length; i++) {
            const v = ch[i];
            const a = Math.abs(v);
            if (a > peakAbs) peakAbs = a;
            if (a >= 1) clipped++;
            sumSquare += v * v;
            sumValue += v;
        }
    }
    const total = buffer.length * channels;
    const rms = Math.sqrt(sumSquare / total);

    let phaseCorrelation: number | null = null;
    if (channels === 2) {
        const l = channelData[0];
        const r = channelData[1];
        let num = 0;
        let lSum = 0;
        let rSum = 0;
        for (let i = 0; i < buffer.length; i++) {
            num += l[i] * r[i];
            lSum += l[i] * l[i];
            rSum += r[i] * r[i];
        }
        phaseCorrelation = lSum && rSum ? num / Math.sqrt(lSum * rSum) : 0;
    }

    const lead = channels === 1 ? mono : channelData[0];
    const tail = channels === 1 ? mono : channelData[0];

    const metrics: AudioMetrics = {
        duration: buffer.duration,
        sampleRate: buffer.sampleRate,
        channels,
        peakDb: toDb(peakAbs),
        truePeakDb: toDb(computeTruePeak(channelData)),
        rmsDb: toDb(rms),
        crestDb: toDb(peakAbs) - toDb(rms),
        lufs: computeLufs(channelData, buffer.sampleRate),
        dcOffset: sumValue / total,
        clippedSamples: clipped,
        clipRatio: clipped / total,
        phaseCorrelation,
        spectralCentroid,
        leadSilenceMs: computeSilence(lead, buffer.sampleRate, false),
        tailSilenceMs: computeSilence(tail, buffer.sampleRate, true),
    };

    return { metrics, peaks, spectrum };
};

/* ------------------------- 专业评价 ------------------------- */

export type Grade = 'good' | 'ok' | 'warn' | 'bad';

export interface EvaluationItem {
    label: string;
    value: string;
    grade: Grade;
    comment: string;
}

export interface Evaluation {
    score: number;
    grade: Grade;
    summary: string;
    items: EvaluationItem[];
}

const gradeOf = (score: number): Grade =>
    score >= 80 ? 'good' : score >= 60 ? 'ok' : score >= 40 ? 'warn' : 'bad';

/** 根据指标生成专业评价（各维度评分 + 综合分） */
export const evaluateAudio = (m: AudioMetrics): Evaluation => {
    const scores: { score: number; weight: number; item: EvaluationItem }[] = [];

    // 削波 / 过载
    {
        const r = m.clipRatio;
        const score = r === 0 ? 100 : r < 0.00001 ? 90 : r < 0.0001 ? 70 : r < 0.001 ? 40 : 10;
        const value = r === 0 ? '无削波' : `${m.clippedSamples.toLocaleString()} 样本 (${(r * 100).toFixed(3)}%)`;
        const comment = r === 0 ? '未检测到数字削波，峰值保持在满刻度以下。'
            : r < 0.0001 ? '存在极少量削波样本，人耳通常不可闻。'
                : r < 0.001 ? '削波样本已可被察觉，建议降低输入增益重采。'
                    : '严重削波，会产生明显失真，强烈建议重新录制。';
        scores.push({ score, weight: 20, item: { label: '削波 / 过载', value, grade: gradeOf(score), comment } });
    }

    // 峰值电平
    {
        const p = m.peakDb;
        const score = p > -0.5 ? 60 : p > -1.5 ? 90 : p > -6 ? 100 : p > -12 ? 75 : 55;
        const value = `${p.toFixed(2)} dBFS`;
        const comment = p > -0.5 ? '峰值贴近满刻度，几乎没有余量，动态稍大就可能削波。'
            : p > -1.5 ? '峰值接近满刻度，余量偏小，谨慎处理。'
                : p > -6 ? '峰值电平健康，留有合理的动态余量。'
                    : p > -12 ? '峰值电平偏低，响度不足，后期需要较多增益补偿。'
                        : '峰值电平过低，信噪比可能不理想。';
        scores.push({ score, weight: 15, item: { label: '峰值电平', value, grade: gradeOf(score), comment } });
    }

    // 响度
    {
        const l = m.lufs;
        const score = l >= -16 && l <= -9 ? 100 : l > -9 && l <= -5 ? 85 : l > -5 ? 55 : l >= -23 ? 70 : 45;
        const value = Number.isFinite(l) ? `${l.toFixed(1)} LUFS` : '—';
        const comment = l >= -16 && l <= -9 ? '响度符合主流流媒体标准（约 -14 LUFS），无需额外增益。'
            : l > -9 && l <= -5 ? '响度偏高，接近平台上限，可能触发响度归一被压低。'
                : l > -5 ? '响度过大，动态被压缩，听感疲劳。'
                    : l >= -23 ? '响度偏低，发布到流媒体平台会被明显放大。'
                        : '响度很低，信号强度不足。';
        scores.push({ score, weight: 20, item: { label: '集成响度', value, grade: gradeOf(score), comment } });
    }

    // 动态范围
    {
        const c = m.crestDb;
        const score = c >= 6 && c <= 20 ? 100 : c < 6 ? 60 : c <= 30 ? 75 : 55;
        const value = `${c.toFixed(1)} dB`;
        const comment = c >= 6 && c <= 20 ? '动态范围自然，兼顾细节与力度。'
            : c < 6 ? '动态被过度压缩，声音偏"平"，缺少起伏。'
                : c <= 30 ? '动态偏大，个别峰值突兀。'
                    : '动态范围过大，弱音与强音差异悬殊。';
        scores.push({ score, weight: 15, item: { label: '动态范围', value, grade: gradeOf(score), comment } });
    }

    // 相位相关性（仅立体声）
    if (m.phaseCorrelation !== null) {
        const r = m.phaseCorrelation;
        const score = r >= 0.5 ? 100 : r >= 0 ? 75 : 20;
        const value = `${(r * 100).toFixed(0)}%`;
        const comment = r >= 0.5 ? '左右声道相位一致，立体声像清晰居中。'
            : r >= 0 ? '声道相关性偏弱，声场偏宽或存在轻微相位差。'
                : '检测到反相成分，单声道回放会严重抵消低频，需检查录音或效果链。';
        scores.push({ score, weight: 15, item: { label: '相位相关性', value, grade: gradeOf(score), comment } });
    }

    // 直流偏置
    {
        const d = Math.abs(m.dcOffset);
        const score = d < 0.0005 ? 100 : d < 0.01 ? 70 : 30;
        const value = `${(m.dcOffset * 100).toFixed(3)}%`;
        const comment = d < 0.0005 ? '无直流偏置，波形对称。'
            : d < 0.01 ? '存在轻微直流偏置，通常无影响。'
                : '直流偏置明显，会浪费动态余量，建议高通滤波去除。';
        scores.push({ score, weight: 10, item: { label: '直流偏置', value, grade: gradeOf(score), comment } });
    }

    // 频谱质心（信息项，轻微计分）
    {
        const c = m.spectralCentroid;
        const score = c >= 300 && c <= 6000 ? 100 : 80;
        const value = `${Math.round(c).toLocaleString()} Hz`;
        const comment = c < 300 ? '整体能量偏低频，声音偏闷。'
            : c > 8000 ? '整体能量偏高频，声音偏亮、可能有齿音。'
                : '频谱能量分布均衡。';
        scores.push({ score, weight: 5, item: { label: '频谱质心', value, grade: gradeOf(score), comment } });
    }

    const totalWeight = scores.reduce((s, x) => s + x.weight, 0);
    const score = Math.round(scores.reduce((s, x) => s + x.score * x.weight, 0) / totalWeight);
    const summary = `综合评分 ${score}/100：${score >= 80 ? '音质表现优秀，参数健康，可直接用于制作或发布。'
        : score >= 60 ? '整体良好，存在少量可优化项（见黄色/红色条目）。'
            : score >= 40 ? '存在明显问题，建议针对性处理后再使用。'
                : '问题较多，建议重新录制或做专业修复。'}`;

    return { score, grade: gradeOf(score), summary, items: scores.map((s) => s.item) };
};
