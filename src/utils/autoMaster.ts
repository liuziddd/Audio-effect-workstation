/**
 * DSP 智能母带引擎（零模型、零下载，与 AI 神经母带并列的第二引擎）
 *
 * 链路符合工业交付顺序：次声清理 → 校正 EQ → 胶合压缩 → 温和饱和 →
 * 目标响度两遍归一化 → 真峰值限制（后两层在 master.worker.ts 的交付层统一执行）。
 * 硬件调度：逐样本 K 加权分析跑多核 Worker 并行；链渲染跑 OfflineAudioContext
 * （浏览器原生音频线程，C++/SIMD）；主线程只做调度与参数决策。
 */
import MasterAnalysisWorker from '../workers/masterAnalysis.worker?worker';
import type { SegmentStats } from './masterAnalysis';
import type { Stem } from './loudness';

interface MasterMetrics {
    lufs: number;
    peakDb: number;
    crestDb: number;
    lowDb: number;
    midDb: number;
    highDb: number;
}

export interface MasterPlan {
    lowGain: number;
    midGain: number;
    highGain: number;
    makeupDb: number;
    threshold: number;
    ratio: number;
}

/** 计算核心数（上限 8，短音频不分片） */
export const masterThreadCount = (frames: number, sampleRate: number) =>
    Math.min(8, Math.max(1, navigator.hardwareConcurrency || 4), Math.ceil(frames / (sampleRate * 12)));

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const toDb = (v: number) => 20 * Math.log10(Math.max(v, 1e-9));

/** 分片并行分析：PCM 以 transfer 方式交给 Worker，零拷贝、不阻塞主线程 */
export const analyzeAudio = async (buffer: AudioBuffer, onProgress?: (ratio: number) => void): Promise<MasterMetrics> => {
    const left = buffer.getChannelData(0);
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
    const threads = masterThreadCount(buffer.length, buffer.sampleRate);
    const chunk = Math.ceil(buffer.length / threads);

    const parts = await Promise.all(
        Array.from({ length: threads }, (_, i) => {
            const from = i * chunk;
            const to = Math.min(from + chunk, buffer.length);
            return new Promise<SegmentStats>((resolve) => {
                const worker = new MasterAnalysisWorker();
                worker.onmessage = (e: MessageEvent<SegmentStats>) => {
                    resolve(e.data);
                    worker.terminate();
                    onProgress?.((i + 1) / threads);
                };
                const l = left.slice(from, to);
                const r = right.slice(from, to);
                worker.postMessage({ left: l, right: r, sampleRate: buffer.sampleRate }, [l.buffer, r.buffer]);
            });
        }),
    );

    const blockPowers = parts.flatMap((p) => p.blockPowers);
    const sum = (k: keyof Pick<SegmentStats, 'totalSq' | 'lowSq' | 'midSq' | 'highSq' | 'samples'>) =>
        parts.reduce((s, p) => s + p[k], 0);
    const peak = Math.max(...parts.map((p) => p.peak));
    const samples = sum('samples');

    const toLufs = (p: number) => -0.691 + 10 * Math.log10(Math.max(p, 1e-12));
    const absolute = blockPowers.filter((p) => toLufs(p) > -70);
    const seed = absolute.reduce((s, p) => s + p, 0) / Math.max(absolute.length, 1);
    const gated = absolute.filter((p) => toLufs(p) > toLufs(seed) - 10);
    const finalP = gated.length ? gated.reduce((s, p) => s + p, 0) / gated.length : seed;

    const total = sum('totalSq') / samples;
    return {
        lufs: toLufs(finalP),
        peakDb: toDb(peak),
        crestDb: toDb(peak) - toDb(Math.sqrt(total)),
        lowDb: toDb(Math.sqrt(sum('lowSq') / samples / total)),
        midDb: toDb(Math.sqrt(sum('midSq') / samples / total)),
        highDb: toDb(Math.sqrt(sum('highSq') / samples / total)),
    };
};

/** 由分析结果推导处理参数：目标为流媒体母带常见的温和下倾频谱 */
export const buildPlan = (m: MasterMetrics, targetLufs: number): MasterPlan => {
    const target = { low: -5.5, mid: -7.0, high: -10.0 };
    const shape = (v: number) => clamp(v * 0.35, -3, 3);
    return {
        lowGain: shape(target.low - m.lowDb),
        midGain: shape(target.mid - m.midDb),
        highGain: shape(target.high - m.highDb),
        // 温和预补偿，把链输出拉到目标附近；精确校准由交付层两遍归一化负责
        makeupDb: clamp(targetLufs - m.lufs, -6, 6),
        threshold: clamp(-8 - (m.crestDb - 12) * 0.7, -20, -6),
        ratio: clamp(1.4 + (m.crestDb - 9) * 0.15, 1.3, 3.2),
    };
};

/** 离线渲染母带链：全部在浏览器原生音频线程执行；不做最终限制，交给交付层 */
export const masterAudio = async (buffer: AudioBuffer, plan: MasterPlan): Promise<AudioBuffer> => {
    const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // 30Hz 高通清理次声，给后续响度留出余量（工业母带链第一步）
    const rumble = ctx.createBiquadFilter();
    rumble.type = 'highpass';
    rumble.frequency.value = 30;
    rumble.Q.value = 0.7;

    const lowShelf = ctx.createBiquadFilter();
    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = 90;
    lowShelf.gain.value = plan.lowGain;

    const midPeak = ctx.createBiquadFilter();
    midPeak.type = 'peaking';
    midPeak.frequency.value = 1200;
    midPeak.Q.value = 0.8;
    midPeak.gain.value = plan.midGain;

    const highShelf = ctx.createBiquadFilter();
    highShelf.type = 'highshelf';
    highShelf.frequency.value = 8000;
    highShelf.gain.value = plan.highGain;

    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = plan.threshold;
    glue.knee.value = 12;
    glue.ratio.value = plan.ratio;
    glue.attack.value = 0.02;
    glue.release.value = 0.18;

    const makeup = ctx.createGain();
    makeup.gain.value = Math.pow(10, plan.makeupDb / 20);

    // 温和饱和（knee 0.85）只加谐波，不把峰值压死，避免交付层归一化时二次削波
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    const knee = 0.85;
    for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        const a = Math.abs(x);
        curve[i] = a <= knee ? x : Math.sign(x) * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
    }
    shaper.curve = curve;
    shaper.oversample = '2x';

    source.connect(rumble).connect(lowShelf).connect(midPeak).connect(highShelf)
        .connect(glue).connect(makeup).connect(shaper).connect(ctx.destination);
    source.start(0);
    return ctx.startRendering();
};

/** 供交付层统一处理的立体声 PCM */
export const bufferToStem = (buffer: AudioBuffer): Stem => ({
    left: buffer.getChannelData(0).slice(),
    right: (buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0)).slice(),
});
