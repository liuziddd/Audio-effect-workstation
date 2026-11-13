/**
 * ITO-Master 白盒母带链：6 模块（参量 EQ → 失真 → 3 段多频压缩 → 增益 → M/S 立体声 → 限制器）
 *
 * 移植自 Hugging Face Space `kramp/audio-master` 的 src/lib/ito_dsp.js
 * （1:1 复刻 dasp-pytorch 的 RBJ 双二阶、torchcomp 的压缩/限制器包络与
 *  ITO-Master 的 Linkwitz-Riley 分频），原工程与模型均为 CC BY-NC 4.0，仅限非商业使用。
 * 出处：https://huggingface.co/spaces/kramp/audio-master
 * 模型：Koo et al., ITO-Master (Sony Research, ISMIR 2025), CC BY-NC 4.0
 *
 * 顺序与反归一化范围来自模型仓库 kramp/ito-master-onnx 的 config.json。
 */
import { applyGain, type Stem } from './loudness';

const EPS = 1e-6;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

type Coeffs = { b0: number; b1: number; b2: number; a1: number; a2: number };

/** RBJ 双二阶系数（与 dasp_pytorch.signal.biquad 一致） */
function biquadCoeffs(type: string, gainDb: number, fc: number, q: number, fs: number): Coeffs {
    const A = Math.pow(10, gainDb / 40);
    const w0 = 2 * Math.PI * (fc / fs);
    const cw = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    const sqA = Math.sqrt(A);
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    if (type === 'low_shelf') {
        b0 = A * (A + 1 - (A - 1) * cw + 2 * sqA * alpha);
        b1 = 2 * A * (A - 1 - (A + 1) * cw);
        b2 = A * (A + 1 - (A - 1) * cw - 2 * sqA * alpha);
        a0 = A + 1 + (A - 1) * cw + 2 * sqA * alpha;
        a1 = -2 * (A - 1 + (A + 1) * cw);
        a2 = A + 1 + (A - 1) * cw - 2 * sqA * alpha;
    } else if (type === 'high_shelf') {
        b0 = A * (A + 1 + (A - 1) * cw + 2 * sqA * alpha);
        b1 = -2 * A * (A - 1 + (A + 1) * cw);
        b2 = A * (A + 1 + (A - 1) * cw - 2 * sqA * alpha);
        a0 = A + 1 - (A - 1) * cw + 2 * sqA * alpha;
        a1 = 2 * (A - 1 - (A + 1) * cw);
        a2 = A + 1 - (A - 1) * cw - 2 * sqA * alpha;
    } else if (type === 'peaking') {
        b0 = 1 + alpha * A;
        b1 = -2 * cw;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cw;
        a2 = 1 - alpha / A;
    } else if (type === 'low_pass') {
        b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2;
        a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    } else {
        b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
        a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    }
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function biquadInPlace(x: Float32Array, c: Coeffs) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
        const xi = x[i];
        const yi = c.b0 * xi + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
        x2 = x1; x1 = xi;
        y2 = y1; y1 = yi;
        x[i] = yi;
    }
}

/** torchcomp.ms2coef：毫秒 → 一阶平滑系数，越大越快 */
const ms2coef = (ms: number, fs: number) => 1 - Math.exp(-2200 / ms / fs);

/** 46 个归一化输出的反归一化范围：value = norm * (max - min) + min */
const R = (min: number, max: number) => ({ min, max });
const R60 = R(-60, -1e-6), MS = R(5, 100), RATIO = R(1.000001, 20), ERATIO = R(1e-6, 0.999999);
const ITO_PARAM_SPEC = [
    R(-20, 20), R(20, 2000), R(0.1, 5),         // 低架：增益 / 截止 / Q
    R(-20, 20), R(80, 2000), R(0.1, 5),         // band0
    R(-20, 20), R(2000, 8000), R(0.1, 5),       // band1
    R(-20, 20), R(8000, 12000), R(0.1, 5),      // band2
    R(-20, 20), R(12000, 21050), R(0.1, 5),     // band3
    R(-20, 20), R(4000, 21050), R(0.1, 5),      // 高架
    R(0, 8), R(0.2, 0.7),                        // 失真：drive / mix
    R(20, 300), R(2000, 12000), R(0.2, 0.7),    // 多频：分频点 ×2 / mix
    R60, RATIO, R60, ERATIO, MS, MS,            // 低频段压缩/扩展
    R60, RATIO, R60, ERATIO, MS, MS,            // 中频段
    R60, RATIO, R60, ERATIO, MS, MS,            // 高频段
    R(-24, 24),                                  // 增益 dB
    R(0, 1),                                     // 立体声宽度
    R60, MS, MS,                                 // 限制器：阈值 / 起控 / 释放
];

interface ItoParams {
    eq: {
        lowShelf: { gain: number; freq: number; q: number };
        bands: { gain: number; freq: number; q: number }[];
        highShelf: { gain: number; freq: number; q: number };
    };
    distortion: { driveDb: number; mix: number };
    mb: {
        lowCut: number; highCut: number; mix: number;
        low: BandParams; mid: BandParams; high: BandParams;
    };
    gainDb: number;
    width: number;
    limiter: { threshold: number; at: number; rt: number };
}
type BandParams = {
    compThresh: number; compRatio: number; expThresh: number; expRatio: number; at: number; rt: number;
};

export function denormalizeParams(norm: Float32Array | number[]): ItoParams {
    const v = ITO_PARAM_SPEC.map((p, i) => norm[i] * (p.max - p.min) + p.min);
    let i = 0;
    const next = () => v[i++];
    const eq = {
        lowShelf: { gain: next(), freq: next(), q: next() },
        bands: [0, 1, 2, 3].map(() => ({ gain: next(), freq: next(), q: next() })),
        highShelf: { gain: next(), freq: next(), q: next() },
    };
    const distortion = { driveDb: next(), mix: next() };
    const band = (): BandParams => ({
        compThresh: next(), compRatio: next(), expThresh: next(),
        expRatio: next(), at: next(), rt: next(),
    });
    const mb = { lowCut: next(), highCut: next(), mix: next(), low: band(), mid: band(), high: band() };
    const gainDb = next();
    const width = next();
    const limiter = { threshold: next(), at: next(), rt: next() };
    return { eq, distortion, mb, gainDb, width, limiter };
}

function applyEQ(stem: Stem, eq: ItoParams['eq'], fs: number) {
    const sections: [string, { gain: number; freq: number; q: number }][] = [
        ['low_shelf', eq.lowShelf],
        ...eq.bands.map((b) => ['peaking', b] as [string, typeof b]),
        ['high_shelf', eq.highShelf],
    ];
    for (const [type, p] of sections) {
        const c = biquadCoeffs(type, p.gain, clamp(p.freq, 20, fs / 2 - 1), Math.max(0.1, p.q), fs);
        biquadInPlace(stem.left, c);
        biquadInPlace(stem.right, c);
    }
}

function applyDistortion(stem: Stem, d: ItoParams['distortion']) {
    const drive = Math.pow(10, d.driveDb / 20);
    for (let i = 0; i < stem.left.length; i++) {
        stem.left[i] = d.mix * Math.tanh(stem.left[i] * drive) + (1 - d.mix) * stem.left[i];
        stem.right[i] = d.mix * Math.tanh(stem.right[i] * drive) + (1 - d.mix) * stem.right[i];
    }
}

/** LR4 分频：同一个 Q=1/√2 巴特沃斯双二阶跑两次 */
function crossoverBand(stem: Stem, type: string, cutoff: number, fs: number): Stem {
    const c = biquadCoeffs(type, 0, clamp(cutoff, 20, fs / 2 - 1), Math.SQRT1_2, fs);
    const L = stem.left.slice(), R = stem.right.slice();
    biquadInPlace(L, c); biquadInPlace(L, c);
    biquadInPlace(R, c); biquadInPlace(R, c);
    return { left: L, right: R };
}

/** torchcomp.compexp_gain：压缩器 + 扩展器取更严格的增益，一阶起控/释放包络 */
function compexpGain(band: Stem, p: BandParams, fs: number) {
    const n = band.left.length;
    const g = new Float32Array(n);
    const at = ms2coef(clamp(p.at, 1, 1000), fs);
    const rt = ms2coef(clamp(p.rt, 1, 1000), fs);
    const compSlope = 1 - 1 / Math.max(1 + EPS, p.compRatio);
    const expSlope = 1 - 1 / clamp(p.expRatio, EPS, 1 - EPS);
    let gg = 1;
    for (let i = 0; i < n; i++) {
        const det = Math.abs(band.left[i] + band.right[i]) + EPS;
        const level = 20 * Math.log10(det);
        const gdb = Math.min(
            compSlope * (p.compThresh - level),
            expSlope * (p.expThresh - level),
            0,
        );
        const f = Math.pow(10, gdb / 20);
        const coeff = f < gg ? at : rt;
        gg = (1 - coeff) * gg + coeff * f;
        g[i] = gg;
    }
    return g;
}

function applyMultiband(stem: Stem, mb: ItoParams['mb'], fs: number) {
    const n = stem.left.length;
    const low = crossoverBand(stem, 'low_pass', mb.lowCut, fs);
    const high = crossoverBand(stem, 'high_pass', mb.highCut, fs);
    const mid: Stem = { left: new Float32Array(n), right: new Float32Array(n) };
    for (let i = 0; i < n; i++) {
        mid.left[i] = stem.left[i] - low.left[i] - high.left[i];
        mid.right[i] = stem.right[i] - low.right[i] - high.right[i];
    }
    const gLow = compexpGain(low, mb.low, fs);
    const gMid = compexpGain(mid, mb.mid, fs);
    const gHigh = compexpGain(high, mb.high, fs);
    for (let i = 0; i < n; i++) {
        const l = low.left[i] * gLow[i] + mid.left[i] * gMid[i] + high.left[i] * gHigh[i];
        const r = low.right[i] * gLow[i] + mid.right[i] * gMid[i] + high.right[i] * gHigh[i];
        stem.left[i] = mb.mix * l + (1 - mb.mix) * stem.left[i];
        stem.right[i] = mb.mix * r + (1 - mb.mix) * stem.right[i];
    }
}

/** dasp_pytorch.stereo_widener：width 0.5 = 单位增益，0 = 单声道，1 = 全侧链 */
function applyImager(stem: Stem, width: number) {
    const s2 = Math.SQRT2;
    const mg = 2 * (1 - width), sg = 2 * width;
    for (let i = 0; i < stem.left.length; i++) {
        const l = stem.left[i], r = stem.right[i];
        const mid = ((l + r) / s2) * mg;
        const side = ((l - r) / s2) * sg;
        stem.left[i] = (mid + side) / s2;
        stem.right[i] = (mid - side) / s2;
    }
}

/** torchcomp.limiter_gain：因果峰值包络（起控/释放互换）+ 增益平滑 */
function applyLimiter(stem: Stem, lim: ItoParams['limiter'], fs: number) {
    const at = ms2coef(clamp(lim.at, 1, 1000), fs);
    const rt = ms2coef(clamp(lim.rt, 1, 1000), fs);
    const lt = Math.pow(10, lim.threshold / 20);
    let peak = 0, g = 1;
    for (let i = 0; i < stem.left.length; i++) {
        const det = Math.abs(stem.left[i] + stem.right[i]);
        const ecoef = det < peak ? rt : at;
        peak = (1 - ecoef) * peak + ecoef * det;
        const f = Math.min(1, peak > EPS ? lt / peak : 1e9);
        const coeff = f < g ? at : rt;
        g = (1 - coeff) * g + coeff * f;
        stem.left[i] *= g;
        stem.right[i] *= g;
    }
}

/** 完整 ITO 链（不含最终响度归一化，那层由 loudness.finalizeMaster 统一负责） */
export function applyItoChain(input: Stem, p: ItoParams, fs = 44100): Stem {
    const stem: Stem = { left: input.left.slice(), right: input.right.slice() };
    applyEQ(stem, p.eq, fs);
    applyDistortion(stem, p.distortion);
    applyMultiband(stem, p.mb, fs);
    applyGain(stem, Math.pow(10, p.gainDb / 20));
    applyImager(stem, clamp(p.width, 0, 1));
    applyLimiter(stem, p.limiter, fs);
    return stem;
}

/** 供 UI 展示的 6 段 EQ 动作与立体声宽度 */
export const itoDisplay = (p: ItoParams) => ({
    eq: [
        { freq: Math.round(p.eq.lowShelf.freq), gain: Math.round(p.eq.lowShelf.gain * 10) / 10 },
        ...p.eq.bands.map((b) => ({ freq: Math.round(b.freq), gain: Math.round(b.gain * 10) / 10 })),
        { freq: Math.round(p.eq.highShelf.freq), gain: Math.round(p.eq.highShelf.gain * 10) / 10 },
    ],
    width: Math.round(p.width * 200) / 100,
});
