import React from 'react';
import StemSeparatorWorker from '../../workers/stemSeparator.worker?worker';
import './styles.css';

interface StemData {
    left: Float32Array;
    right: Float32Array;
}

const STEM_NAMES: { key: string; label: string; icon: string }[] = [
    { key: 'vocals', label: '人声', icon: '🎤' },
    { key: 'drums', label: '鼓', icon: '🥁' },
    { key: 'bass', label: '贝斯', icon: '🎸' },
    { key: 'other', label: '其他乐器', icon: '🎹' },
];

const SAMPLE_RATE = 44100;

const encodeWav = (stem: StemData): Blob => {
    const length = stem.left.length;
    const channels = 2;
    const bytesPerSample = 2;
    const dataSize = length * channels * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeString = (offset: number, value: string) => {
        for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, SAMPLE_RATE, true);
    view.setUint32(28, SAMPLE_RATE * channels * bytesPerSample, true);
    view.setUint16(32, channels * bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < length; i++) {
        for (const channelData of [stem.left, stem.right]) {
            const sample = Math.max(-1, Math.min(1, channelData[i]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
            offset += 2;
        }
    }
    return new Blob([buffer], { type: 'audio/wav' });
};

const formatBytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1) + ' MB';

const MODEL_URL = 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx';
const MODEL_CACHE = 'demucs-model-v1';

/** 主线程加载模型：优先读浏览器缓存，未命中则下载并写入缓存（同 URL 覆盖，不会重复占空间） */
async function loadModelBuffer(onProgress: (loaded: number, total: number) => void):
    Promise<{ buffer: ArrayBuffer; fromCache: boolean }> {
    const cache = await caches.open(MODEL_CACHE);
    const cached = await cache.match(MODEL_URL);
    if (cached) return { buffer: await cached.arrayBuffer(), fromCache: true };

    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`模型下载失败：HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;

    if (res.body) {
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
        await cache.put(MODEL_URL, new Response(buffer));
        return { buffer: buffer.buffer, fromCache: false };
    }

    const buffer = await res.arrayBuffer();
    await cache.put(MODEL_URL, new Response(buffer));
    return { buffer, fromCache: false };
}

type Phase = 'idle' | 'working' | 'done' | 'error';

const StemSeparator: React.FC = () => {
    const workerRef = React.useRef<Worker | null>(null);
    const [phase, setPhase] = React.useState<Phase>('idle');
    const [statusText, setStatusText] = React.useState('');
    const [downloadProgress, setDownloadProgress] = React.useState(0);
    const [separateProgress, setSeparateProgress] = React.useState(0);
    const [fileName, setFileName] = React.useState('');
    const [stems, setStems] = React.useState<Record<string, StemData> | null>(null);
    const [urls, setUrls] = React.useState<Record<string, string>>({});
    const [deviceLabel, setDeviceLabel] = React.useState('检测中…');
    const [deviceKind, setDeviceKind] = React.useState<'gpu' | 'cpu'>('cpu');

    React.useEffect(() => {
        return () => {
            workerRef.current?.terminate();
            workerRef.current = null;
        };
    }, []);

    React.useEffect(() => {
        if (!stems) return;
        const next: Record<string, string> = {};
        for (const { key } of STEM_NAMES) {
            const stem = stems[key];
            if (stem) next[key] = URL.createObjectURL(encodeWav(stem));
        }
        setUrls(next);
        return () => Object.values(next).forEach(url => URL.revokeObjectURL(url));
    }, [stems]);

    const handleFile = async (file: File) => {
        if (!file || phase === 'working') return;

        setStems(null);
        setUrls({});
        setDownloadProgress(0);
        setSeparateProgress(0);
        setFileName(file.name);
        setPhase('working');

        try {
            // 解码并重采样为 44.1kHz 立体声
            const arrayBuffer = await file.arrayBuffer();
            const decodeCtx = new AudioContext();
            const decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
            await decodeCtx.close();

            const frames = Math.ceil(decoded.duration * SAMPLE_RATE);
            const offline = new OfflineAudioContext(2, frames, SAMPLE_RATE);
            const source = offline.createBufferSource();
            source.buffer = decoded;
            source.connect(offline.destination);
            source.start(0);
            const rendered = await offline.startRendering();

            const left = rendered.getChannelData(0).slice();
            const right = rendered.numberOfChannels > 1
                ? rendered.getChannelData(1).slice()
                : rendered.getChannelData(0).slice();

            // 加载模型：缓存命中秒读，否则下载并缓存（进度走 downloadProgress）
            setStatusText('正在准备模型…');
            const { buffer: modelBuffer, fromCache } = await loadModelBuffer((loaded, total) => {
                setDownloadProgress(total ? loaded / total : 0);
            });
            setStatusText(fromCache ? '已从浏览器缓存读取模型' : '模型已下载并缓存（下次无需再下载）');

            const worker = new StemSeparatorWorker();
            workerRef.current = worker;

            worker.onmessage = (event: MessageEvent) => {
                const data = event.data;
                if (data.type === 'device') {
                    setDeviceKind(data.gpu ? 'gpu' : 'cpu');
                    setDeviceLabel(data.gpu
                        ? 'WebGPU（显卡加速）'
                        : data.isolated ? 'CPU 多线程' : 'CPU 单线程');
                } else if (data.type === 'progress') {
                    setSeparateProgress(data.progress);
                } else if (data.type === 'status') {
                    setStatusText(data.text);
                } else if (data.type === 'done') {
                    setStems(data.result);
                    setPhase('done');
                    worker.terminate();
                } else if (data.type === 'error') {
                    setStatusText(`分离失败：${data.message}`);
                    setPhase('error');
                    worker.terminate();
                }
            };
            worker.onerror = (event) => {
                setStatusText(`推理线程出错：${event.message}`);
                setPhase('error');
            };

            worker.postMessage(
                { type: 'separate', left, right, modelBuffer },
                [left.buffer, right.buffer, modelBuffer],
            );
        } catch (error) {
            setStatusText(`无法处理该文件：${error instanceof Error ? error.message : String(error)}`);
            setPhase('error');
        }
    };

    const busy = phase === 'working';

    return (
        <div className="stem-separator">
            <div className="stem-header">
                <h3 className="stem-title">🎛️ AI 音轨分离</h3>
                <span className={`stem-device ${deviceKind}`}>{deviceLabel}</span>
            </div>
            <p className="stem-desc">
                基于 Meta HTDemucs 模型，将音频分离为人声、鼓、贝斯、其他乐器四轨。
                推理全部在本机完成，音频不会上传；模型（172MB）首次使用时从 HuggingFace 下载并缓存。
            </p>

            <label className={`stem-dropzone ${busy ? 'disabled' : ''}`}>
                <input
                    type="file"
                    accept="audio/*"
                    disabled={busy}
                    onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                />
                {busy ? '处理中…' : fileName ? `已选：${fileName}（点击更换）` : '选择音频文件开始分离'}
            </label>

            {phase === 'working' && (
                <div className="stem-progress-area">
                    <p className="stem-status">{statusText}</p>
                    {downloadProgress > 0 && downloadProgress < 1 && (
                        <div className="stem-progress-row">
                            <span>模型下载 {Math.round(downloadProgress * 100)}%</span>
                            <progress value={downloadProgress} max={1} />
                        </div>
                    )}
                    {separateProgress > 0 && (
                        <div className="stem-progress-row">
                            <span>分离进度 {Math.round(separateProgress * 100)}%</span>
                            <progress value={separateProgress} max={1} />
                        </div>
                    )}
                </div>
            )}

            {phase === 'error' && <p className="stem-error">❌ {statusText}</p>}

            {stems && (
                <div className="stem-results">
                    {STEM_NAMES.map(({ key, label, icon }) => {
                        const stem = stems[key];
                        if (!stem) return null;
                        const size = stem.left.length * 2 * 2;
                        return (
                            <div className="stem-track" key={key}>
                                <div className="stem-track-header">
                                    <span className="stem-track-name">{icon} {label}</span>
                                    <span className="stem-track-size">{formatBytes(size)}</span>
                                </div>
                                <audio controls src={urls[key]} preload="none" />
                                <a
                                    className="stem-download"
                                    href={urls[key]}
                                    download={`${fileName.replace(/\.[^.]+$/, '')}_${key}.wav`}
                                >
                                    下载 WAV
                                </a>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default StemSeparator;
