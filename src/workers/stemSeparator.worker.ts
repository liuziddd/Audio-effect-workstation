/// <reference lib="webworker" />
/**
 * AI 分轨推理 Worker：demucs-web (HTDemucs ONNX) + onnxruntime-web
 * 有 WebGPU 就走显卡，没有就走 WASM
 * 模型下载与缓存由主线程负责（主线程 caches 可靠），本 Worker 只做推理
 */

type StemResult = Record<string, { left: Float32Array; right: Float32Array }>;

type WorkerRequest = {
    type: 'separate';
    left: Float32Array;
    right: Float32Array;
    modelBuffer: ArrayBuffer;
};

type WorkerResponse =
    | { type: 'device'; gpu: boolean; isolated: boolean }
    | { type: 'status'; phase: 'init' | 'separate' | 'done'; text: string }
    | { type: 'progress'; progress: number }
    | { type: 'done'; result: StemResult }
    | { type: 'failed'; reason: string };

const post = (message: WorkerResponse) => self.postMessage(message);
const isolated = self.crossOriginIsolated === true;

/** 检测 WebGPU：要高性能独显那一块 */
async function detectGpu(): Promise<boolean> {
    try {
        const gpu = (navigator as Navigator & {
            gpu?: { requestAdapter(o?: { powerPreference?: string }): Promise<unknown> };
        }).gpu;
        if (!gpu) return false;
        return Boolean(await gpu.requestAdapter({ powerPreference: 'high-performance' }));
    } catch {
        return false;
    }
}

type Separator = {
    loadModel(buffer: ArrayBuffer): Promise<unknown>;
    separate(left: Float32Array, right: Float32Array): Promise<StemResult>;
};

type OrtLike = { env: { wasm: { wasmPaths: string; proxy: boolean; numThreads: number } } };
type Runtime = { DemucsProcessor: new (o: object) => Separator; ort: OrtLike };

let runtimePromise: Promise<Runtime> | null = null;

function loadRuntime(): Promise<Runtime> {
    if (!runtimePromise) {
        runtimePromise = Promise.all([
            import('demucs-web'),
            import('onnxruntime-web'),
        ]).then(([demucs, ort]) => {
            const runtime = ort as unknown as OrtLike;
            // WASM 运行时从 CDN 按需加载，不进部署包；按跨域隔离状态配置线程数
            runtime.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/';
            runtime.env.wasm.proxy = false;
            runtime.env.wasm.numThreads = isolated ? Math.min(4, navigator.hardwareConcurrency || 4) : 1;
            return {
                DemucsProcessor: demucs.DemucsProcessor as unknown as new (o: object) => Separator,
                ort: runtime,
            };
        });
    }
    return runtimePromise;
}

/** 建会话 + 分离 */
async function runPath(modelBuffer: ArrayBuffer, useGpu: boolean, left: Float32Array, right: Float32Array) {
    const { DemucsProcessor, ort } = await loadRuntime();
    post({
        type: 'status',
        phase: 'init',
        text: `正在初始化推理引擎（${useGpu ? 'WebGPU · 显卡加速' : isolated ? 'CPU 多线程' : 'CPU 单线程'}）`,
    });
    const separator = new DemucsProcessor({
        ort,
        sessionOptions: { executionProviders: useGpu ? ['webgpu', 'wasm'] : ['wasm'] },
        onProgress: (info: { progress: number }) => post({ type: 'progress', progress: info.progress }),
    });
    await separator.loadModel(modelBuffer);
    post({ type: 'status', phase: 'separate', text: '正在分离音轨' });
    return separator.separate(left, right);
}

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
    const { type, left, right, modelBuffer } = event.data;
    if (type !== 'separate') return;

    // 设备探测先于运行时加载完成，立即回报硬件状态，避免界面一直停在「检测中…」
    const useGpu = await detectGpu();
    post({ type: 'device', gpu: useGpu, isolated });

    try {
        const result = await runPath(modelBuffer, useGpu, left, right);
        post({ type: 'status', phase: 'done', text: '分离完成' });
        post({ type: 'done', result });
    } catch (error) {
        // 清掉缓存的 rejected Promise，让重新选文件能重试
        runtimePromise = null;
        post({ type: 'failed', reason: error instanceof Error ? error.message : String(error) });
    }
});
