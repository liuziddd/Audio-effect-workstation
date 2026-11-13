/**
 * 浏览器端模型下载：多源回退 + Range 分片 + Cache API 分片级断点续传 + 完整性校验。
 * AI 音轨分离（HTDemucs）与 AI 神经母带（ITO-Master）共用同一套基础设施。
 */
export interface ModelFileSpec {
    /** Cache API 的固定 key，与具体下载源解耦，换源不会让缓存失效 */
    key: string;
    /** 主源 + 兜底源 */
    urls: string[];
    /** 低于此字节数视为错误页 / 不完整下载 */
    minBytes: number;
    /** 文件精确字节数：既用于进度加权，也作为分片总长度（不依赖 Content-Range 响应头） */
    expectedBytes: number;
}

interface LoadedModel {
    buffer: ArrayBuffer;
    fromCache: boolean;
}

const PARALLEL_CHUNKS = 4;
const CHUNK_RETRY = 3;

/** 可选：ModelScope 公开仓库 ID，配置后自动作为首选国内源 */
const SCOPE_REPO = (import.meta.env.VITE_MODELSCOPE_REPO as string | undefined)?.trim() ?? '';

const sourcesOf = (spec: ModelFileSpec): string[] => {
    if (!SCOPE_REPO) return spec.urls;
    const name = spec.urls[0].split('/').pop()!;
    return [
        `https://www.modelscope.cn/api/v1/models/${SCOPE_REPO}/repo?Revision=master&FilePath=${encodeURIComponent(name)}`,
        ...spec.urls,
    ];
};

const partKey = (key: string, index: number) => `${key}.part-${index}`;

/** 清掉某文件的所有分片缓存（完整文件写入后、或模型损坏时） */
const clearParts = async (cache: Cache, key: string) => {
    const requests = await cache.keys();
    await Promise.all(
        requests.filter((r) => r.url.includes(`${key}.part-`)).map((r) => cache.delete(r)),
    );
};

/** 单流读取（服务端不支持 Range 时的兜底） */
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

/** 按 expectedBytes 切分 Range；每个分片下完立即写入 Cache，中断后只补缺片 */
const downloadParallel = async (
    cache: Cache,
    spec: ModelFileSpec,
    url: string,
    onProgress: (loaded: number, total: number) => void,
) => {
    const total = spec.expectedBytes;
    const chunkSize = Math.ceil(total / PARALLEL_CHUNKS);
    const ranges: { start: number; end: number }[] = [];
    for (let start = 0; start < total; start += chunkSize) {
        ranges.push({ start, end: Math.min(start + chunkSize - 1, total - 1) });
    }

    const parts = await Promise.all(
        ranges.map((_, i) => cache.match(partKey(spec.key, i)).then(async (hit) =>
            hit ? new Uint8Array(await hit.arrayBuffer()) : null)),
    );
    let loaded = parts.reduce((sum, part) => sum + (part?.byteLength ?? 0), 0);
    onProgress(loaded, total);

    let nextIndex = 0;
    const fetchPart = async (index: number) => {
        const { start, end } = ranges[index];
        const want = end - start + 1;
        for (let attempt = 0; attempt < CHUNK_RETRY; attempt++) {
            try {
                const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
                if (res.status === 200) throw new Error('RANGE_UNSUPPORTED');
                if (res.status !== 206) continue;
                const data = new Uint8Array(await res.arrayBuffer());
                if (data.byteLength !== want) continue;
                parts[index] = data;
                await cache.put(partKey(spec.key, index), new Response(data));
                loaded += data.byteLength;
                onProgress(loaded, total);
                return;
            } catch (error) {
                // 服务端完全不支持 Range 时立即交给单流兜底；其余失败只重试本片
                if (error instanceof Error && error.message === 'RANGE_UNSUPPORTED') throw error;
            }
        }
    };

    await Promise.all(
        Array.from({ length: Math.min(PARALLEL_CHUNKS, ranges.length) }, async () => {
            for (;;) {
                const index = nextIndex++;
                if (index >= ranges.length) break;
                if (!parts[index]) await fetchPart(index);
            }
        }),
    );
    if (parts.some((part) => !part)) throw new Error('分片下载失败');

    const buffer = new Uint8Array(total);
    for (let i = 0; i < ranges.length; i++) {
        const part = parts[i];
        if (!part || part.byteLength !== ranges[i].end - ranges[i].start + 1) {
            throw new Error('分片数据不完整');
        }
        buffer.set(part, ranges[i].start);
    }
    return buffer;
};

/** 加载单个模型文件：完整缓存优先，未命中则多源下载；已下载的分片跨源、跨会话保留 */
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
            await clearParts(cache, spec.key);
            return { buffer: bytes.buffer, fromCache: true };
        }
        await cache.delete(spec.key);
    }

    for (const url of sourcesOf(spec)) {
        try {
            let bytes: Uint8Array;
            try {
                bytes = await downloadParallel(cache, spec, url, onProgress);
            } catch (error) {
                if (!(error instanceof Error && error.message === 'RANGE_UNSUPPORTED')) throw error;
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                bytes = await readStream(res, onProgress);
            }
            if (bytes.byteLength < spec.minBytes) throw new Error('模型数据不完整');
            await cache.put(spec.key, new Response(bytes));
            await clearParts(cache, spec.key);
            return { buffer: bytes.buffer, fromCache: false };
        } catch {
            // 换下一个源；已落盘的分片保留，不会从头重下
        }
    }
    throw new Error(`模型下载失败：${spec.key}`);
};

/** 推理失败时清掉可能损坏的缓存（含分片），避免下次反复加载坏模型 */
export const clearModelCache = async (cacheName: string, keys: string[]) => {
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();
    await Promise.all(
        requests.filter((r) => keys.some((key) => r.url.includes(key))).map((r) => cache.delete(r)),
    );
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
