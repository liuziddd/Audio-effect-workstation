/** 母带响度/频段分析的逐样本内核（主线程与 Worker 共用，纯函数无副作用） */
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

/** 单声道混合 + K 加权分块功率 + 一阶分频能量，供多核分片并行 */
export const analyzeSegment = (
    left: Float32Array,
    right: Float32Array,
    sampleRate: number,
): SegmentStats => {
    const aShelf = 1 - Math.exp((-2 * Math.PI * 1500) / sampleRate);
    const aLow = 1 - Math.exp((-2 * Math.PI * 200) / sampleRate);
    const aMid = 1 - Math.exp((-2 * Math.PI * 2000) / sampleRate);
    const blockSize = Math.max(1, Math.round(sampleRate * BLOCK_SEC));
    const blockPowers: number[] = [];

    let peak = 0;
    let totalSq = 0;
    let lowSq = 0;
    let midSq = 0;
    let highSq = 0;
    let lpShelf = 0;
    let lpLow = 0;
    let lpMid = 0;
    let prev = 0;
    let hp = 0;
    let blockSq = 0;
    let blockCount = 0;

    for (let i = 0; i < left.length; i++) {
        const x = (left[i] + right[i]) * 0.5;
        hp = 0.999 * (hp + x - prev);
        prev = x;
        lpShelf += aShelf * (hp - lpShelf);
        const k = hp + 0.58 * (hp - lpShelf);
        blockSq += k * k;
        blockCount++;
        if (blockCount >= blockSize) {
            blockPowers.push(blockSq / blockCount);
            blockSq = 0;
            blockCount = 0;
        }

        lpLow += aLow * (x - lpLow);
        lpMid += aMid * (x - lpMid);
        const lo = lpLow;
        const md = lpMid - lpLow;
        const hi = x - lpMid;
        lowSq += lo * lo;
        midSq += md * md;
        highSq += hi * hi;
        totalSq += x * x;
        if (Math.abs(x) > peak) peak = Math.abs(x);
    }
    if (blockCount > 0) blockPowers.push(blockSq / blockCount);

    return { blockPowers, peak, totalSq, lowSq, midSq, highSq, samples: left.length };
};
