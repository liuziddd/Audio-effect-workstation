/**
 * 自动母带引擎（DSP，非 AI 模型）
 *
 * 信号链参考 ISC 项目 Web Audio Mastering：分析 → 自动音色修正 → 响度归一化
 * → 软削波 → 峰值限制，按 ITU-R BS.1770 简化 K 加权测量。
 * 硬件调度：逐样本分析交给多核 Worker 并行；渲染交给 OfflineAudioContext
 * （浏览器原生音频线程，C++/SIMD 实现），主线程只做调度与参数决策。
 */
import MasterAnalysisWorker from '../workers/masterAnalysis.worker?worker';
import type { SegmentStats } from './masterAnalysis';

const TARGET_LUFS = -14;
const CEILING_DB = -1;

export interface MasterMetrics {
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
    const lufs = toLufs(finalP);
    const peakDb = toDb(peak);
    return {
        lufs,
        peakDb,
        crestDb: peakDb - toDb(Math.sqrt(total)),
        lowDb: toDb(Math.sqrt(sum('lowSq') / samples / total)),
        midDb: toDb(Math.sqrt(sum('midSq') / samples / total)),
        highDb: toDb(Math.sqrt(sum('highSq') / samples / total)),
    };
};

/** 由分析结果推导处理参数 */
export const buildPlan = (m: MasterMetrics): MasterPlan => {
    const target = { low: -5.5, mid: -7.0, high: -10.0 };
    const shape = (v: number) => clamp(v * 0.35, -3, 3);
    return {
        lowGain: shape(target.low - m.lowDb),
        midGain: shape(target.mid - m.midDb),
        highGain: shape(target.high - m.highDb),
        makeupDb: clamp(TARGET_LUFS - m.lufs, -6, 12),
        threshold: clamp(-8 - (m.crestDb - 12) * 0.7, -20, -6),
        ratio: clamp(1.4 + (m.crestDb - 9) * 0.15, 1.3, 3.2),
    };
};

/** 离线渲染母带链：全部在浏览器原生音频线程执行 */
export const masterAudio = async (buffer: AudioBuffer, plan: MasterPlan): Promise<AudioBuffer> => {
    const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const lowShelf = ctx.createBiquadFilter();
    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = 180;
    lowShelf.gain.value = plan.lowGain;

    const midPeak = ctx.createBiquadFilter();
    midPeak.type = 'peaking';
    midPeak.frequency.value = 1200;
    midPeak.Q.value = 0.8;
    midPeak.gain.value = plan.midGain;

    const highShelf = ctx.createBiquadFilter();
    highShelf.type = 'highshelf';
    highShelf.frequency.value = 5000;
    highShelf.gain.value = plan.highGain;

    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = plan.threshold;
    glue.knee.value = 12;
    glue.ratio.value = plan.ratio;
    glue.attack.value = 0.02;
    glue.release.value = 0.18;

    const makeup = ctx.createGain();
    makeup.gain.value = Math.pow(10, plan.makeupDb / 20);

    // 软削波曲线把输出限制在 ±1 内，无需渲染后再扫描归一化
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    const knee = 0.7;
    for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        const a = Math.abs(x);
        curve[i] = a <= knee ? x : Math.sign(x) * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
    }
    shaper.curve = curve;
    shaper.oversample = '2x';

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = CEILING_DB;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;

    source.connect(lowShelf).connect(midPeak).connect(highShelf).connect(glue)
        .connect(makeup).connect(shaper).connect(limiter).connect(ctx.destination);
    source.start(0);
    return ctx.startRendering();
};
