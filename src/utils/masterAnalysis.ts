/**
 * 母带分析的逐样本内核（主线程与 Worker 共用，纯函数无副作用）。
 * K 加权按 ITU-R BS.1770-4 的模拟原型推导双二阶系数（与 pyloudnorm 同式），
 * 左右声道各自滤波后求和，替代早期的一阶近似。
 */
export interface SegmentStats {
    blockPowers: number[];
    peak: number;
    totalSq: number;
    lowSq: number;
    midSq: number;
    highSq: number;
    samples: number;
}

const BLOCK_SEC = 0.4;

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

/** 两级 K 加权系数（sr 自适应，44.1k / 48k 均正确） */
const kWeightCoeffs = (fs: number): [Biquad, Biquad] => {
    // 一级：+4 dB 高架
    const f1 = 1681.9744509555319, G = 3.99984385397, Q1 = 0.7071752369554193;
    const K1 = Math.tan((Math.PI * f1) / fs);
    const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    const a01 = 1 + K1 / Q1 + K1 * K1;
    const shelf: Biquad = {
        b0: (Vh + (Vb * K1) / Q1 + K1 * K1) / a01,
        b1: (2 * (K1 * K1 - Vh)) / a01,
        b2: (Vh - (Vb * K1) / Q1 + K1 * K1) / a01,
        a1: (2 * (K1 * K1 - 1)) / a01,
        a2: (1 - K1 / Q1 + K1 * K1) / a01,
    };
    // 二级：RLB 高通
    const f2 = 38.13547087613982, Q2 = 0.5003270373253953;
    const K2 = Math.tan((Math.PI * f2) / fs);
    const a02 = 1 + K2 / Q2 + K2 * K2;
    const hp: Biquad = {
        b0: 1, b1: -2, b2: 1,
        a1: (2 * (K2 * K2 - 1)) / a02,
        a2: (1 - K2 / Q2 + K2 * K2) / a02,
    };
    return [shelf, hp];
};

function filter(x: Float32Array, c: Biquad, out: Float32Array) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
        const xi = x[i];
        const yi = c.b0 * xi + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
        x2 = x1; x1 = xi;
        y2 = y1; y1 = yi;
        out[i] = yi;
    }
}

/** K 加权块功率 + 一阶分频能量 + 峰值，供多核分片并行 */
export const analyzeSegment = (left: Float32Array, right: Float32Array, sampleRate: number): SegmentStats => {
    const [shelf, hp] = kWeightCoeffs(sampleRate);
    const n = left.length;
    const tmp = new Float32Array(n);
    const kl = new Float32Array(n), kr = new Float32Array(n);
    filter(left, shelf, tmp); filter(tmp, hp, kl);
    filter(right, shelf, tmp); filter(tmp, hp, kr);

    const aLow = 1 - Math.exp((-2 * Math.PI * 200) / sampleRate);
    const aMid = 1 - Math.exp((-2 * Math.PI * 2000) / sampleRate);
    const blockSize = Math.max(1, Math.round(sampleRate * BLOCK_SEC));
    const blockPowers: number[] = [];

    let peak = 0, totalSq = 0, lowSq = 0, midSq = 0, highSq = 0;
    let lpLow = 0, lpMid = 0, blockSq = 0, blockCount = 0;

    for (let i = 0; i < n; i++) {
        blockSq += kl[i] * kl[i] + kr[i] * kr[i];
        blockCount++;
        if (blockCount >= blockSize) {
            blockPowers.push(blockSq / blockCount);
            blockSq = 0;
            blockCount = 0;
        }

        const x = (left[i] + right[i]) * 0.5;
        lpLow += aLow * (x - lpLow);
        lpMid += aMid * (x - lpMid);
        const lo = lpLow, md = lpMid - lpLow, hi = x - lpMid;
        lowSq += lo * lo;
        midSq += md * md;
        highSq += hi * hi;
        totalSq += x * x;
        const a = Math.max(Math.abs(left[i]), Math.abs(right[i]));
        if (a > peak) peak = a;
    }
    if (blockCount > 0) blockPowers.push(blockSq / blockCount);

    return { blockPowers, peak, totalSq, lowSq, midSq, highSq, samples: n };
};
