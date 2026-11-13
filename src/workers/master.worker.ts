/// <reference lib="webworker" />
/**
 * 母带处理 Worker：两种引擎共用同一条「响度最终化」通道。
 *
 * · neural — Sony Research ITO-Master 白盒神经母带：
 *     fxencoder.onnx（音频/参考曲 → 2048 维风格嵌入）+ mastering_tcn.onnx（音频+嵌入 → 46 参数）
 *     → 反归一化 → 6 模块 DSP 链。WebGPU 优先，建会话/推理任一步失败自动降级 WASM 完整重跑。
 * · dsp — 零下载 DSP 智能母带：链在 OfflineAudioContext（原生音频线程）渲染完，
 *     这里只接棒做交付层（BS.1770-4 门控 LUFS 归一化 + 真峰值限制）。
 * · finalize — 结果出来后调整目标响度，用缓存的链输出秒级重算，不重跑模型。
 *
 * 模型与 DSP 链移植自 Hugging Face Space `kramp/audio-master`（CC BY-NC 4.0，仅限非商业）。
 */
import { applyItoChain, denormalizeParams, itoDisplay } from '../utils/itoDsp';
import { finalizeMaster, measure, type Stem, type LoudnessReport } from '../utils/loudness';

type EqMove = { freq: number; gain: number };
type Display = { eq: EqMove[]; width: number };

type Request =
    | {
        type: 'neural';
        left: Float32Array; right: Float32Array;
        /** 不传参考曲即盲模式：把输入自身当作风格参考（官方做法） */
        refLeft?: Float32Array; refRight?: Float32Array;
        fxBuffer: ArrayBuffer; tcnBuffer: ArrayBuffer;
        targetLufs: number; ceilingDb: number; sampleRate: number;
    }
    | {
        type: 'dsp';
        left: Float32Array; right: Float32Array;
        eq: EqMove[];
        targetLufs: number; ceilingDb: number; sampleRate: number;
    }
    | { type: 'finalize'; targetLufs: number; ceilingDb: number };

type Response =
    | { type: 'device'; gpu: boolean; isolated: boolean }
    | { type: 'stage'; progress: number; text: string }
    | {
        type: 'done';
        left: Float32Array; right: Float32Array;
        before: LoudnessReport; after: LoudnessReport;
        display: Display; engine: 'dsp' | 'neural';
    }
    | { type: 'failed'; reason: string };

const post = (message: Response, transfer?: Transferable[]) =>
    self.postMessage(message, transfer ?? []);

const isolated = self.crossOriginIsolated === true;
const FS = 44100;
const INFER_MAX_SEC = 20; // 模型只吃中央 20 秒，参数是全局时域池化的

type OrtTensor = { data: Float32Array };
type OrtSession = { run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>> };
type OrtRuntime = {
    Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
    InferenceSession: { create(buffer: ArrayBuffer, options: object): Promise<OrtSession> };
    env: { wasm: { wasmPaths: string; proxy: boolean; numThreads: number } };
};

let ortPromise: Promise<OrtRuntime> | null = null;
let sessions: { encoder: OrtSession; tcn: OrtSession } | null = null;
let forceWasm = false;

/** 保存链输出与原始输入，供调整响度时重算 */
let rawStem: Stem | null = null;
let inputStem: Stem | null = null;
let reportBefore: LoudnessReport | null = null;
let display: Display = { eq: [], width: 1 };
let engine: 'dsp' | 'neural' = 'dsp';
let sampleRate = FS;

async function detectGpu(): Promise<boolean> {
    try {
        const gpu = (navigator as Navigator & {
            gpu?: { requestAdapter(o?: { powerPreference?: string }): Promise<unknown> };
        }).gpu;
        if (!gpu) return false;
        const adapter = (await gpu.requestAdapter({ powerPreference: 'high-performance' }))
            ?? (await gpu.requestAdapter());
        return !!adapter;
    } catch {
        return false;
    }
}

function loadOrt(): Promise<OrtRuntime> {
    if (!ortPromise) {
        ortPromise = import('onnxruntime-web').then((mod) => {
            const ort = mod as unknown as OrtRuntime;
            ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/';
            ort.env.wasm.proxy = false;
            ort.env.wasm.numThreads = isolated ? Math.min(4, navigator.hardwareConcurrency || 4) : 1;
            return ort;
        });
    }
    return ortPromise;
}

/** 中央片段，交错成 [1,2,N] 张量（L 段在前、R 段在后） */
function centralSegment(left: Float32Array, right: Float32Array) {
    const max = Math.floor(INFER_MAX_SEC * FS);
    const n = left.length;
    if (n <= max) return { left, right, n };
    const start = Math.floor((n - max) / 2);
    return { left: left.subarray(start, start + max), right: right.subarray(start, start + max), n: max };
}
function toCHW(seg: { left: Float32Array; right: Float32Array; n: number }) {
    const d = new Float32Array(2 * seg.n);
    d.set(seg.left, 0);
    d.set(seg.right, seg.n);
    return d;
}

/** 完整跑一条神经路径：建双会话 + 编码 + 参数预测 */
async function runNeuralPath(
    fxBuffer: ArrayBuffer, tcnBuffer: ArrayBuffer, useGpu: boolean,
    input: Stem, reference: Stem, ort: OrtRuntime,
) {
    post({
        type: 'stage', progress: 0.08,
        text: `正在初始化推理引擎（${useGpu ? 'WebGPU · 显卡加速' : isolated ? 'CPU 多线程' : 'CPU 单线程'}）`,
    });
    const options = {
        executionProviders: useGpu ? ['webgpu', 'wasm'] : ['wasm'],
        graphOptimizationLevel: 'basic',
    };
    const built = sessions ?? {
        encoder: await ort.InferenceSession.create(fxBuffer, options),
        tcn: await ort.InferenceSession.create(tcnBuffer, options),
    };
    sessions = built;

    post({ type: 'stage', progress: 0.22, text: '正在分析参考风格（FXencoder）…' });
    const ref = centralSegment(reference.left, reference.right);
    const refOut = await built.encoder.run({
        ref_audio: new ort.Tensor('float32', toCHW(ref), [1, 2, ref.n]),
    });

    post({ type: 'stage', progress: 0.46, text: '正在预测 46 个母带参数（TCN）…' });
    const seg = centralSegment(input.left, input.right);
    const parOut = await built.tcn.run({
        in_audio: new ort.Tensor('float32', toCHW(seg), [1, 2, seg.n]),
        embedding: refOut.embedding,
    });
    return parOut.params.data;
}

function finish(targetLufs: number, ceilingDb: number) {
    const { stem, report } = finalizeMaster(rawStem!, targetLufs, ceilingDb, sampleRate);
    post({
        type: 'done', left: stem.left, right: stem.right,
        before: reportBefore!, after: report, display, engine,
    }, [stem.left.buffer, stem.right.buffer]);
}

self.addEventListener('message', async (event: MessageEvent<Request>) => {
    const msg = event.data;

    if (msg.type === 'finalize') {
        if (rawStem) finish(msg.targetLufs, msg.ceilingDb);
        return;
    }

    try {
        if (msg.type === 'dsp') {
            engine = 'dsp';
            sampleRate = msg.sampleRate;
            rawStem = { left: msg.left, right: msg.right };
            inputStem = rawStem;
            display = { eq: msg.eq, width: 1 };
            post({ type: 'stage', progress: 0.82, text: '正在测量原始响度与真峰值…' });
            reportBefore = measure(inputStem, sampleRate);
            post({ type: 'stage', progress: 0.9, text: '正在按目标响度归一化…' });
            finish(msg.targetLufs, msg.ceilingDb);
            return;
        }

        engine = 'neural';
        sampleRate = msg.sampleRate;
        const input: Stem = { left: msg.left, right: msg.right };
        const reference: Stem = msg.refLeft && msg.refRight
            ? { left: msg.refLeft, right: msg.refRight }
            : input;
        inputStem = input;

        const gpuDetected = await detectGpu();
        const useGpu = gpuDetected && !forceWasm;
        post({ type: 'device', gpu: useGpu, isolated });

        const ort = await loadOrt();
        let norm: Float32Array;
        try {
            norm = await runNeuralPath(msg.fxBuffer, msg.tcnBuffer, useGpu, input, reference, ort);
        } catch (gpuError) {
            if (!useGpu) throw gpuError;
            forceWasm = true;
            sessions = null;
            post({ type: 'device', gpu: false, isolated });
            norm = await runNeuralPath(msg.fxBuffer, msg.tcnBuffer, false, input, reference, ort);
        }

        post({ type: 'stage', progress: 0.6, text: '正在应用 6 模块母带链（EQ／失真／多频压缩／宽度／限制）…' });
        const params = denormalizeParams(norm);
        rawStem = applyItoChain(input, params, sampleRate);
        display = itoDisplay(params);
        post({ type: 'stage', progress: 0.85, text: '正在测量原始响度与真峰值…' });
        reportBefore = measure(inputStem, sampleRate);
        post({ type: 'stage', progress: 0.9, text: '正在按目标响度归一化…' });
        finish(msg.targetLufs, msg.ceilingDb);
    } catch (error) {
        // 清空缓存的 rejected Promise 与会话，保证下次可完整重试
        ortPromise = null;
        sessions = null;
        forceWasm = false;
        post({ type: 'failed', reason: error instanceof Error ? error.message : String(error) });
    }
});
