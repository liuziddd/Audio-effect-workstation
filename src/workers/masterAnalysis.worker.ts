/// <reference lib="webworker" />
/** 母带分析 Worker：只接收分片 PCM，逐样本统计，结果回传主线程合并 */
import { analyzeSegment } from '../utils/masterAnalysis';

self.onmessage = (e: MessageEvent<{ left: Float32Array; right: Float32Array; sampleRate: number }>) => {
    const { left, right, sampleRate } = e.data;
    const stats = analyzeSegment(left, right, sampleRate);
    self.postMessage(stats);
};
