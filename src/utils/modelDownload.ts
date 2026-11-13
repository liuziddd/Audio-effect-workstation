/**
 * 浏览器端大模型下载：多源回退 + 多连接 Range 分片并行 + Cache API 缓存 + 完整性校验。
 * AI 音轨分离（HTDemucs）与 AI 神经母带（ITO-Master）共用同一套基础设施。
 */
export interface ModelFileSpec {
    /** Cache API 的固定 key，与具体下载源解耦，换源不会让缓存失效 */
    key: string;
    /** 国内镜像优先，官方源兜底 */
    urls: string[];
    /** 低于此字节数视为错误页 / 不完整下载 */
    minBytes: number;
    /** 用于多文件进度加权（0 = 未知） */
    expectedBytes: number;
}

interface LoadedModel {
    buffer: ArrayBuffer;
    fromCache: boolean;
}

const PARALLEL_CHUNKS = 8;
const CHUNK_RETRY = 3;

/** 探测总大小并确认服务端支持 Range 分片 */
const probeSize = async (url: string): Promise<number | null> => {
    try {
        const res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
        if (res.status === 206) {
            const m = res.headers.get('content-range')?.match(/\/(\d+)\s*$/);
            if (m) return Number(m[1]);
        }
        const cl = res.headers.get('content-length');
        return cl ? Number(cl) : null;
    } catch {
        return null;
    }
};

/** 单流读取（不支持 Range 时的兜底） */
const readStream = async (res: Response, onProgress: (loaded: number, total: number) => void) => {
    const total = Number(res.headers.get('content-length')) || 0;
    if (!res.body) {
        const buffer = new Uint8Array(await res.arrayBuffer());
        onProgress(buffer.byteLength, total || buffer.byteLength);
        return buffer;
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        onProgress(loaded, total);
    }
    const buffer = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.length;
    }
    return buffer;
};

/** 8 路并发分片下载，按序拼接 */
const downloadParallel = async (
    url: string,
    total: number,
    onProgress: (loaded: number, total: number) => void,
) => {
    const chunkSize = Math.ceil(total / PARALLEL_CHUNKS);
    const ranges: { start: number; end: number }[] = [];
    for (let start = 0; start < total; start += chunkSize) {
        ranges.push({ start, end: Math.min(start + chunkSize - 1, total - 1) });
    }
    const parts = new Array<Uint8Array>(ranges.length);
    let loaded = 0;
    let nextIndex = 0;

    const fetchOne = async (index: number) => {
        const { start, end } = ranges[index];
        let data: Uint8Array | null = null;
        for (let attempt = 0; attempt < CHUNK_RETRY && !data; attempt++) {
            const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
            if (res.status === 206) {
                data = new Uint8Array(await res.arrayBuffer());
                break;
            }
            if (res.status === 200) throw new Error('RANGE_UNSUPPORTED');
        }
        if (!data) throw new Error(`分片下载失败（bytes ${start}-${end}）`);
        parts[index] = data;
        loaded += data.byteLength;
        onProgress(loaded, total);
    };

    await Promise.all(
        Array.from({ length: Math.min(PARALLEL_CHUNKS, ranges.length) }, async () => {
            for (;;) {
                const index = nextIndex++;
                if (index >= ranges.length) break;
                await fetchOne(index);
            }
        }),
    );

    const buffer = new Uint8Array(total);
    for (let i = 0; i < ranges.length; i++) buffer.set(parts[i], ranges[i].start);
    return buffer;
};

/** 加载单个模型文件：缓存优先，未命中则多源下载并写入缓存 */
export const loadModelFile = async (
    cacheName: string,
    spec: ModelFileSpec,
    onProgress: (loaded: number, total: number) => void,
): Promise<LoadedModel> => {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(spec.key);
    if (cached) {
        const bytes = new Uint8Array(await cached.arrayBuffer());
        if (bytes.byteLength >= spec.minBytes) {
            onProgress(bytes.byteLength, bytes.byteLength);
            return { buffer: bytes.buffer, fromCache: true };
        }
        await cache.delete(spec.key);
    }

    for (const url of spec.urls) {
        try {
            const total = await probeSize(url);
            let bytes: Uint8Array;
            if (total && total > 0) {
                try {
                    bytes = await downloadParallel(url, total, onProgress);
                } catch (error) {
                    if (!(error instanceof Error && error.message === 'RANGE_UNSUPPORTED')) throw error;
                    const res = await fetch(url);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    bytes = await readStream(res, onProgress);
                }
            } else {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                bytes = await readStream(res, onProgress);
            }
            if (bytes.byteLength < spec.minBytes) throw new Error('模型数据不完整');
            await cache.put(spec.key, new Response(bytes));
            return { buffer: bytes.buffer, fromCache: false };
        } catch {
            // 换下一个源重试
        }
    }
    throw new Error(`模型下载失败：${spec.key}`);
};

/** 推理失败时清掉可能损坏的缓存，避免下次反复加载坏模型 */
export const clearModelCache = async (cacheName: string, keys: string[]) => {
    const cache = await caches.open(cacheName);
    await Promise.all(keys.map((key) => cache.delete(key)));
};

/** 多文件顺序加载，进度按 expectedBytes 加权合并成一条 0→100% 的进度 */
export const loadModelFiles = async (
    cacheName: string,
    specs: ModelFileSpec[],
    onProgress: (ratio: number) => void,
): Promise<{ buffers: ArrayBuffer[]; fromCache: boolean }> => {
    const total = specs.reduce((s, m) => s + m.expectedBytes, 0);
    let done = 0;
    let allCached = true;
    const buffers: ArrayBuffer[] = [];
    for (const spec of specs) {
        const result = await loadModelFile(cacheName, spec, (loaded, fileTotal) => {
            // 缓存命中（loaded === fileTotal）也累加完整权重，避免进度停在 0
            const weighted = loaded >= fileTotal ? spec.expectedBytes : loaded;
            onProgress(total ? Math.min(1, (done + weighted) / total) : 0);
        });
        if (!result.fromCache) allCached = false;
        done += spec.expectedBytes;
        buffers.push(result.buffer);
        onProgress(total ? Math.min(1, done / total) : 1);
    }
    return { buffers, fromCache: allCached };
};
