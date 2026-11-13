/**
 * 响度测量与交付规格：ITU-R BS.1770-4 / EBU R128
 *
 * 移植自 Hugging Face Space `kramp/audio-master` 的 src/lib/loudness.js
 * （该工程与 ITO-Master 模型均为 CC BY-NC 4.0，仅限非商业使用）。
 * 出处：https://huggingface.co/spaces/kramp/audio-master
 * 模型：Koo et al., ITO-Master (Sony Research, ISMIR 2025), CC BY-NC 4.0
 */
export type Stem = { left: Float32Array; right: Float32Array };

const EPS = 1e-9;
const toDb = (v: number) => 20 * Math.log10(Math.max(v, EPS));

/** 双二阶直接 I 型，返回新数组（K 加权用） */
function biquad(x: Float32Array, b0: number, b1: number, b2: number, a1: number, a2: number) {
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
        const xi = x[i];
        const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = xi;
        y2 = y1; y1 = yi;
        y[i] = yi;
    }
    return y;
}

/** K 加权第一级：+4 dB 高架 */
function preFilter(x: Float32Array, fs: number) {
    const f0 = 1681.9744509555319;
    const G = 3.99984385397;
    const Q = 0.7071752369554193;
    const K = Math.tan((Math.PI * f0) / fs);
    const Vh = Math.pow(10, G / 20);
    const Vb = Math.pow(Vh, 0.4996667741545416);
    const a0 = 1 + K / Q + K * K;
    return biquad(x,
        (Vh + (Vb * K) / Q + K * K) / a0,
        (2 * (K * K - Vh)) / a0,
        (Vh - (Vb * K) / Q + K * K) / a0,
        (2 * (K * K - 1)) / a0,
        (1 - K / Q + K * K) / a0);
}

/** K 加权第二级：RLB 高通 */
function highPass(x: Float32Array, fs: number) {
    const f0 = 38.13547087613982;
    const Q = 0.5003270373253953;
    const K = Math.tan((Math.PI * f0) / fs);
    const a0 = 1 + K / Q + K * K;
    return biquad(x, 1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
}

const BLOCK_SEC = 0.4;
const STEP_SEC = 0.1; // 75% 重叠，符合 BS.1770-4

/** 每个 400ms 块的 K 加权能量（线性域），供门控积分响度与 LRA 共用 */
function blockPowers(stem: Stem, fs: number): number[] {
    const chans = [stem.left, stem.right].map((c) => highPass(preFilter(c, fs), fs));
    const blockLen = Math.round(BLOCK_SEC * fs);
    const stepLen = Math.round(STEP_SEC * fs);
    const n = chans[0].length;
    const out: number[] = [];
    for (let start = 0; start + blockLen <= n; start += stepLen) {
        let sum = 0;
        for (const c of chans) {
            let s = 0;
            for (let i = start; i < start + blockLen; i++) s += c[i] * c[i];
            sum += s / blockLen; // 立体声声道权重均为 1.0
        }
        out.push(sum);
    }
    return out;
}

const lufsOf = (power: number) => (power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity);

/** 门控积分响度：绝对门 −70 LUFS + 相对门 −10 LU（复用已算好的块能量） */
function gatedLoudness(powers: number[]): number {
    const kept1 = powers.filter((p) => lufsOf(p) >= -70);
    if (!kept1.length) return -Infinity;
    const mean = (list: number[]) => list.reduce((s, p) => s + p, 0) / list.length;
    const rel = lufsOf(mean(kept1)) - 10;
    const kept2 = kept1.filter((p) => lufsOf(p) >= rel);
    return lufsOf(mean(kept2.length ? kept2 : kept1));
}

/** 3s 短时窗 / 1s 步进，−20 LU 相对门控后取 10%~95% 分位差 */
function rangeFromPowers(powers: number[], ref: number): number {
    const win = Math.round(3 / STEP_SEC);
    const hop = Math.round(1 / STEP_SEC);
    if (powers.length < win) return 0;
    const short: number[] = [];
    for (let s = 0; s + win <= powers.length; s += hop) {
        let sum = 0;
        for (let i = s; i < s + win; i++) sum += powers[i];
        short.push(lufsOf(sum / win));
    }
    const kept = short.filter((v) => isFinite(v) && v > ref - 20).sort((a, b) => a - b);
    if (kept.length < 2) return 0;
    const at = (q: number) => kept[Math.min(kept.length - 1, Math.floor(q * kept.length))];
    return at(0.95) - at(0.1);
}

/** 真峰值 dBTP：4× Catmull-Rom 过采样估计 inter-sample peak */
function truePeak(stem: Stem): number {
    let peak = EPS;
    for (const c of [stem.left, stem.right]) {
        const n = c.length;
        for (let i = 0; i < n - 1; i++) {
            const p0 = c[i > 0 ? i - 1 : 0];
            const p1 = c[i];
            const p2 = c[i + 1];
            const p3 = c[i + 2 < n ? i + 2 : n - 1];
            for (let s = 0; s < 4; s++) {
                const t = s / 4;
                const v = 0.5 * (2 * p1 + (-p0 + p2) * t
                    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                    + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
                const a = Math.abs(v);
                if (a > peak) peak = a;
            }
        }
    }
    return toDb(peak);
}

export interface LoudnessReport {
    lufs: number;        // 积分响度 LUFS-I
    truePeakDb: number;  // 真峰值 dBTP
    samplePeakDb: number;// 样本峰值 dBFS
    rmsDb: number;
    crestDb: number;
    lra: number;
}

/** 交付用指标报告：一次遍历 + 一次块统计 */
export function measure(stem: Stem, fs = 44100): LoudnessReport {
    let peak = EPS;
    let sq = 0;
    const n = stem.left.length;
    for (let i = 0; i < n; i++) {
        const l = stem.left[i], r = stem.right[i];
        peak = Math.max(peak, Math.abs(l), Math.abs(r));
        sq += (l * l + r * r) / 2;
    }
    const samplePeakDb = toDb(peak);
    const rmsDb = toDb(Math.sqrt(sq / Math.max(n, 1)));
    const powers = blockPowers(stem, fs);
    const lufs = gatedLoudness(powers);
    return {
        lufs,
        truePeakDb: truePeak(stem),
        samplePeakDb,
        rmsDb,
        crestDb: samplePeakDb - rmsDb,
        lra: rangeFromPowers(powers, lufs),
    };
}

export function applyGain(stem: Stem, gain: number) {
    for (let i = 0; i < stem.left.length; i++) {
        stem.left[i] *= gain;
        stem.right[i] *= gain;
    }
    return stem;
}

/** 砖墙限制：瞬时起控、指数释放、L/R 共享包络保持立体声像 */
function brickwallLimit(stem: Stem, ceilingDb: number, fs = 44100) {
    const ceiling = Math.pow(10, ceilingDb / 20);
    const relCoef = Math.exp(-1 / Math.max(1, Math.round(0.05 * fs)));
    let env = 0;
    for (let i = 0; i < stem.left.length; i++) {
        const peak = Math.max(Math.abs(stem.left[i]), Math.abs(stem.right[i]));
        env = peak > env ? peak : peak + (env - peak) * relCoef;
        const g = env > ceiling ? ceiling / env : 1;
        stem.left[i] *= g;
        stem.right[i] *= g;
    }
    return stem;
}

/**
 * 最终交付层：两遍响度归一化（限制器削掉的响度第二遍补回）+ 真峰值余量。
 * 样本峰值上限比目标真峰值低 1 dB，为 inter-sample peak 留余量。
 */
export function finalizeMaster(raw: Stem, targetLufs: number, ceilingDb: number, fs = 44100) {
    const stem: Stem = { left: raw.left.slice(), right: raw.right.slice() };
    for (let pass = 0; pass < 2; pass++) {
        const powers = blockPowers(stem, fs);
        const gated = gatedLoudness(powers);
        // 极端参数可能把信号压到 −70 LUFS 绝对门以下；此时退化为无门控均值，
        // 避免归一化被跳过后输出静音。
        const cur = isFinite(gated)
            ? gated
            : lufsOf(powers.reduce((s, p) => s + p, 0) / Math.max(powers.length, 1));
        if (!isFinite(cur)) break;
        applyGain(stem, Math.pow(10, (targetLufs - cur) / 20));
        brickwallLimit(stem, ceilingDb - 1, fs);
    }
    return { stem, report: measure(stem, fs) };
}
