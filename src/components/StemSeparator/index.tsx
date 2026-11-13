import React from 'react';
import StemSeparatorWorker from '../../workers/stemSeparator.worker?worker';
import { dragBridge } from '../../utils/dragBridge';
import LatticeLoader from '../effects/LatticeLoader';
import { encodeWav } from '../../utils/wav';
import { loadModelFile, clearModelCache, type ModelFileSpec } from '../../utils/modelDownload';
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

const formatBytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1) + ' MB';


const MODEL_CACHE = 'demucs-model-v1';
const DEMUCS_MODEL: ModelFileSpec = {
    key: 'htdemucs_embedded.onnx',
    urls: [
        'https://hf-mirror.com/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx',
        'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx',
    ],
    minBytes: 1024 * 1024,
    expectedBytes: 180534758,
};
const loadModelBuffer = (onProgress: (loaded: number, total: number) => void) =>
    loadModelFile(MODEL_CACHE, DEMUCS_MODEL, onProgress);

type Phase = 'idle' | 'working' | 'done';

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
    const [isDragOver, setIsDragOver] = React.useState(false);

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
            if (stem) next[key] = URL.createObjectURL(encodeWav(stem.left, stem.right, SAMPLE_RATE));
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
        setStatusText('正在解码音频…');
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
            // 缓存命中也要把模型条置满，否则会一直停在 0% 造成「卡住」的错觉
            setDownloadProgress(1);
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
                    workerRef.current = null;
                } else if (data.type === 'failed') {
                    // 推理失败：状态复位 + 清掉可能损坏的模型缓存，下次重新下载
                    console.warn('音轨分离未完成：', data.reason);
                    void clearModelCache(MODEL_CACHE, [DEMUCS_MODEL.key]);
                    worker.terminate();
                    workerRef.current = null;
                    setPhase('idle');
                }
            };
            worker.onerror = () => {
                // worker 脚本/模块加载失败：同样复位，避免永久卡在「处理中」
                worker.terminate();
                workerRef.current = null;
                setPhase('idle');
            };

            worker.postMessage(
                { type: 'separate', left, right, modelBuffer },
                [left.buffer, right.buffer, modelBuffer],
            );
        } catch {
            setPhase('idle');
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        if (phase === 'working') return;
        const file = Array.from(e.dataTransfer.files)[0] ?? dragBridge.peek();
        if (file) handleFile(file);
    };

    const busy = phase === 'working';
    // 两条独立进度条，各自 0→100%，不做阶段硬拼（硬拼会造成 4% 卡住再跳到 52%）

    return (
        <div className="stem-separator">
            <div className="stem-header">
                <h3 className="stem-title">🎛️ AI 音轨分离</h3>
                <span className={`stem-device ${deviceKind}`}>{deviceLabel}</span>
            </div>
            <p className="stem-desc">
                基于 Meta HTDemucs 模型，将音频分离为人声、鼓、贝斯、其他乐器四轨。
                推理全部在本机完成，音频不会上传；模型（约 172MB）首次使用时从国内镜像多线程下载并缓存，之后秒开。
            </p>

            <label
                className={`stem-dropzone ${busy ? 'disabled' : ''}${isDragOver && !busy ? ' drag-over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!busy) setIsDragOver(true); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false); }}
                onDrop={handleDrop}
            >
                <input
                    type="file"
                    accept="audio/*"
                    disabled={busy}
                    onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                />
                {busy ? '处理中…' : fileName ? `已选：${fileName}（点击或拖拽更换）` : '拖拽音频文件到此处，或点击选择'}
            </label>

            {(phase === 'working' || phase === 'done') && (
                <div className="stem-progress-area">
                    <LatticeLoader
                        status={phase}
                        label="音轨分离"
                        doneLabel="分离完成"
                        color="#7B9CFF"
                        doneColor="#A6FF00"
                    />
                    {phase === 'working' && (
                        <>
                            <p className="stem-status">{statusText}</p>
                            <div className="stem-progress">
                                <div className="stem-progress__head">
                                    <span>模型准备</span>
                                    <span>{Math.round(downloadProgress * 100)}%</span>
                                </div>
                                <div className="stem-progress__track">
                                    <span className="stem-progress__fill" style={{ transform: `scaleX(${downloadProgress})` }} />
                                </div>
                            </div>
                            <div className="stem-progress">
                                <div className="stem-progress__head">
                                    <span>分离推理</span>
                                    <span>{Math.round(separateProgress * 100)}%</span>
                                </div>
                                <div className="stem-progress__track">
                                    <span className="stem-progress__fill" style={{ transform: `scaleX(${separateProgress})` }} />
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}

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
