/// <reference lib="webworker" />
/**
 * AI 分轨推理 Worker：demucs-web (HTDemucs ONNX) + onnxruntime-web
 * GPU 优先（WebGPU），无 WebGPU 时回退多线程 WASM（CPU）
 * 模型下载与缓存由主线程负责（主线程 caches 可靠），本 Worker 只做推理
 */

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
    | { type: 'done'; result: Record<string, { left: Float32Array; right: Float32Array }> };

const post = (message: WorkerResponse) => self.postMessage(message);

/** 真实检测 WebGPU：优先高性能独显（5090），失败再回退默认适配器 */
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

type Separator = {
    separate(left: Float32Array, right: Float32Array):
        Promise<Record<string, { left: Float32Array; right: Float32Array }>>;
};

let processorPromise: Promise<Separator> | null = null;

async function getProcessor(modelBuffer: ArrayBuffer): Promise<Separator> {
    if (processorPromise) return processorPromise;

    processorPromise = (async () => {
        const [{ DemucsProcessor }, ort] = await Promise.all([
            import('demucs-web'),
            import('onnxruntime-web'),
        ]);

        // WASM 运行时从 CDN 按需加载，不进部署包；按跨域隔离状态配置线程数
        (ort as { env: { wasm: { wasmPaths: string; proxy: boolean; numThreads: number } } }).env.wasm.wasmPaths =
            'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/';
        ort.env.wasm.proxy = false;
        const isolated = self.crossOriginIsolated === true;
        ort.env.wasm.numThreads = isolated ? Math.min(4, navigator.hardwareConcurrency || 4) : 1;

        const gpu = await detectGpu();
        post({ type: 'device', gpu, isolated });

        const engineText = gpu
            ? 'WebGPU · 显卡加速'
            : isolated ? 'CPU 多线程' : 'CPU 单线程';
        post({ type: 'status', phase: 'init', text: `正在初始化推理引擎（${engineText}）` });

        const processor = new DemucsProcessor({
            ort,
            sessionOptions: { executionProviders: gpu ? ['webgpu', 'wasm'] : ['wasm'] },
            onProgress: (info: { progress: number }) => post({ type: 'progress', progress: info.progress }),
        });
        await processor.loadModel(modelBuffer);
        return processor;
    })();

    return processorPromise;
}

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
    const { type, left, right, modelBuffer } = event.data;
    if (type !== 'separate') return;

    const processor = await getProcessor(modelBuffer);
    post({ type: 'status', phase: 'separate', text: '正在分离音轨' });
    const result = await processor.separate(left, right);
    post({ type: 'status', phase: 'done', text: '分离完成' });
    post({ type: 'done', result });
});
