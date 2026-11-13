import { useEffect, useRef, useState } from 'react';
import MasterWorker from '../../workers/master.worker?worker';
import { loadModelFiles, clearModelCache, type ModelFileSpec } from '../../utils/modelDownload';
import {
    analyzeAudio, buildPlan, masterAudio, bufferToStem, masterThreadCount,
    type MasterPlan,
} from '../../utils/autoMaster';
import type { LoudnessReport } from '../../utils/loudness';
import { encodeWav24, downloadBlob } from '../../utils/wav';
import { dragBridge } from '../../utils/dragBridge';
import './styles.css';

const FS = 44100;
const MODEL_CACHE = 'ito-master-model-v1';
const ITO_MODELS: ModelFileSpec[] = [
    {
        key: 'ito_fxencoder.onnx',
        urls: [
            'https://hf-mirror.com/kramp/ito-master-onnx/resolve/main/fxencoder.onnx',
            'https://huggingface.co/kramp/ito-master-onnx/resolve/main/fxencoder.onnx',
        ],
        minBytes: 300 * 1024 * 1024,
        expectedBytes: 325556673,
    },
    {
        key: 'ito_mastering_tcn.onnx',
        urls: [
            'https://hf-mirror.com/kramp/ito-master-onnx/resolve/main/mastering_tcn.onnx',
            'https://huggingface.co/kramp/ito-master-onnx/resolve/main/mastering_tcn.onnx',
        ],
        minBytes: 40 * 1024 * 1024,
        expectedBytes: 42238138,
    },
];

const PRESETS = [
    { label: '流媒体', lufs: -14 },
    { label: 'Apple', lufs: -16 },
    { label: 'CD', lufs: -9 },
    { label: '广播', lufs: -23 },
];

type Engine = 'dsp' | 'neural';
type Phase = 'idle' | 'working' | 'done';
type EqMove = { freq: number; gain: number };
type Display = { eq: EqMove[]; width: number };

type WorkerMessage =
    | { type: 'device'; gpu: boolean; isolated: boolean }
    | { type: 'stage'; progress: number; text: string }
    | {
        type: 'done';
        left: Float32Array; right: Float32Array;
        before: LoudnessReport; after: LoudnessReport;
        display: Display; engine: Engine;
    }
    | { type: 'failed'; reason: string };

const fmt = (v: number, unit: string) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} ${unit}`;
const formatFreq = (f: number) => (f >= 1000 ? `${(f / 1000).toFixed(f % 1000 ? 1 : 0)}k` : `${f}`);

/** 解码并统一到 44.1kHz 立体声（ITO-Master 训练采样率） */
const decodeToStereo = async (file: File): Promise<AudioBuffer> => {
    const ctx = new AudioContext();
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    await ctx.close();
    if (decoded.sampleRate === FS && decoded.numberOfChannels === 2) return decoded;
    const offline = new OfflineAudioContext(2, Math.ceil(decoded.duration * FS), FS);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    return offline.startRendering();
};

const ProgressBar = ({ label, value }: { label: string; value: number }) => (
    <div className="am-progress">
        <div className="am-progress__head">
            <span>{label}</span>
            <span>{Math.round(value * 100)}%</span>
        </div>
        <div className="am-progress__track">
            <span className="am-progress__fill" style={{ transform: `scaleX(${value})` }} />
        </div>
    </div>
);

const MetricRow = ({ label, before, after, unit }: {
    label: string; before: number; after: number; unit: string;
}) => (
    <div className="am-metric">
        <span className="am-metric__label">{label}</span>
        <span className="am-metric__before">{fmt(before, unit)}</span>
        <span className="am-metric__arrow">→</span>
        <span className="am-metric__after">{fmt(after, unit)}</span>
    </div>
);

export const AutoMaster = () => {
    const inputRef = useRef<{ name: string; buffer: AudioBuffer; url: string } | null>(null);
    const referenceRef = useRef<AudioBuffer | null>(null);
    const workerRef = useRef<Worker | null>(null);
    const previewUrlRef = useRef('');
    const audioElRef = useRef<HTMLAudioElement>(null);
    const runIdRef = useRef(0);
    const appliedSettings = useRef({ targetLufs: -14, ceilingDb: -1 });

    const [engine, setEngine] = useState<Engine>('dsp');
    const [phase, setPhase] = useState<Phase>('idle');
    const [fileName, setFileName] = useState('');
    const [refName, setRefName] = useState('');
    const [originalUrl, setOriginalUrl] = useState('');
    const [isDragOver, setIsDragOver] = useState(false);
    const [targetLufs, setTargetLufs] = useState(-14);
    const [ceilingDb, setCeilingDb] = useState(-1);
    const [modelProgress, setModelProgress] = useState(0);
    const [workProgress, setWorkProgress] = useState(0);
    const [status, setStatus] = useState('');
    const [deviceLabel, setDeviceLabel] = useState('');
    const [deviceKind, setDeviceKind] = useState<'gpu' | 'cpu'>('cpu');
    const [threads, setThreads] = useState(0);
    const [before, setBefore] = useState<LoudnessReport | null>(null);
    const [after, setAfter] = useState<LoudnessReport | null>(null);
    const [display, setDisplay] = useState<Display | null>(null);
    const [plan, setPlan] = useState<MasterPlan | null>(null);
    const [previewUrl, setPreviewUrl] = useState('');
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [ab, setAb] = useState<'original' | 'master'>('master');

    useEffect(() => () => {
        workerRef.current?.terminate();
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        if (inputRef.current) URL.revokeObjectURL(inputRef.current.url);
    }, []);

    /** 电平匹配 A/B：把更响的一侧衰减到同一感知响度，避免「响 = 好」的错觉 */
    useEffect(() => {
        const el = audioElRef.current;
        if (!el || !before || !after) return;
        const diff = after.lufs - before.lufs;
        el.volume = ab === 'master'
            ? (diff > 0 ? Math.pow(10, -diff / 20) : 1)
            : (diff < 0 ? Math.pow(10, diff / 20) : 1);
    }, [ab, before, after, previewUrl]);

    /** 处理完成后调整响度：用 Worker 缓存的链输出秒级重算，不重跑模型 */
    useEffect(() => {
        if (phase !== 'done') return;
        const applied = appliedSettings.current;
        if (applied.targetLufs === targetLufs && applied.ceilingDb === ceilingDb) return;
        const timer = setTimeout(() => {
            appliedSettings.current = { targetLufs, ceilingDb };
            setStatus('正在按新响度重新归一化…');
            workerRef.current?.postMessage({ type: 'finalize', targetLufs, ceilingDb });
        }, 180);
        return () => clearTimeout(timer);
    }, [targetLufs, ceilingDb, phase]);

    const resetResult = () => {
        runIdRef.current++;
        workerRef.current?.terminate();
        workerRef.current = null;
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = '';
        setPreviewUrl('');
        setResultBlob(null);
        setBefore(null);
        setAfter(null);
        setDisplay(null);
        setPlan(null);
        setModelProgress(0);
        setWorkProgress(0);
        setStatus('');
        setPhase('idle');
    };

    const loadInput = async (file: File) => {
        if (phase === 'working') return;
        setStatus('正在解码音频…');
        try {
            const buffer = await decodeToStereo(file);
            if (inputRef.current) URL.revokeObjectURL(inputRef.current.url);
            const url = URL.createObjectURL(file);
            inputRef.current = { name: file.name, buffer, url };
            setFileName(file.name);
            setOriginalUrl(url);
            resetResult();
        } catch {
            setStatus('');
        }
    };

    const loadReference = async (file: File) => {
        if (phase === 'working') return;
        try {
            referenceRef.current = await decodeToStereo(file);
            setRefName(file.name);
        } catch {
            setStatus('');
        }
    };

    const clearReference = () => {
        referenceRef.current = null;
        setRefName('');
    };

    const selectEngine = (next: Engine) => {
        if (next === engine || phase === 'working') return;
        setEngine(next);
        setDeviceLabel('');
        resetResult();
    };

    const getWorker = () => {
        if (!workerRef.current) workerRef.current = new MasterWorker();
        return workerRef.current;
    };

    const run = async () => {
        const input = inputRef.current;
        if (!input || phase === 'working') return;
        const runId = ++runIdRef.current;
        const settings = { targetLufs, ceilingDb };
        appliedSettings.current = settings;

        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = '';
        setPreviewUrl('');
        setResultBlob(null);
        setBefore(null);
        setAfter(null);
        setDisplay(null);
        setPlan(null);
        setModelProgress(0);
        setWorkProgress(0);
        setStatus('正在准备…');
        setPhase('working');

        const worker = getWorker();
        worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
            const data = event.data;
            if (data.type === 'device') {
                setDeviceKind(data.gpu ? 'gpu' : 'cpu');
                setDeviceLabel(data.gpu
                    ? 'WebGPU · 显卡加速'
                    : data.isolated ? 'CPU 多线程' : 'CPU 单线程');
            } else if (data.type === 'stage') {
                setStatus(data.text);
                setWorkProgress(data.progress);
            } else if (data.type === 'failed') {
                console.warn('母带处理未完成：', data.reason);
                if (engine === 'neural') {
                    void clearModelCache(MODEL_CACHE, ITO_MODELS.map((m) => m.key));
                }
                setPhase('idle');
            } else if (data.type === 'done') {
                const blob = encodeWav24(data.left, data.right, FS);
                const url = URL.createObjectURL(blob);
                previewUrlRef.current = url;
                setResultBlob(blob);
                setPreviewUrl(url);
                setBefore(data.before);
                setAfter(data.after);
                setDisplay(data.display);
                setWorkProgress(1);
                setStatus('母带处理完成');
                setPhase('done');
            }
        };
        worker.onerror = () => setPhase('idle');

        const buffer = input.buffer;
        try {
            if (engine === 'dsp') {
                const count = masterThreadCount(buffer.length, buffer.sampleRate);
                setThreads(count);
                setStatus(`${count} 线程并行分析响度与频段…`);
                const metrics = await analyzeAudio(buffer, (r) => setWorkProgress(r * 0.35));
                if (runIdRef.current !== runId) return;
                const p = buildPlan(metrics, settings.targetLufs);
                setPlan(p);
                setStatus('原生音频线程离线渲染母带链…');
                setWorkProgress(0.45);
                const rendered = await masterAudio(buffer, p);
                if (runIdRef.current !== runId) return;
                const stem = bufferToStem(rendered);
                setWorkProgress(0.78);
                worker.postMessage({
                    type: 'dsp',
                    left: stem.left, right: stem.right,
                    eq: [
                        { freq: 90, gain: p.lowGain },
                        { freq: 1200, gain: p.midGain },
                        { freq: 8000, gain: p.highGain },
                    ],
                    targetLufs: settings.targetLufs,
                    ceilingDb: settings.ceilingDb,
                    sampleRate: FS,
                }, [stem.left.buffer, stem.right.buffer]);
            } else {
                setStatus('正在准备 AI 模型（首次约 368MB，之后走缓存）…');
                const { buffers, fromCache } = await loadModelFiles(MODEL_CACHE, ITO_MODELS, setModelProgress);
                if (runIdRef.current !== runId) return;
                setModelProgress(1);
                setStatus(fromCache ? '模型已从缓存读取' : '模型已下载并缓存');
                const left = buffer.getChannelData(0).slice();
                const right = (buffer.numberOfChannels > 1
                    ? buffer.getChannelData(1) : buffer.getChannelData(0)).slice();
                const ref = referenceRef.current;
                const refLeft = ref ? ref.getChannelData(0).slice() : undefined;
                const refRight = ref ? (ref.numberOfChannels > 1
                    ? ref.getChannelData(1) : ref.getChannelData(0)).slice() : undefined;
                const transfer: Transferable[] = [left.buffer, right.buffer, buffers[0], buffers[1]];
                if (refLeft && refRight) transfer.push(refLeft.buffer, refRight.buffer);
                worker.postMessage({
                    type: 'neural',
                    left, right, refLeft, refRight,
                    fxBuffer: buffers[0], tcnBuffer: buffers[1],
                    targetLufs: settings.targetLufs,
                    ceilingDb: settings.ceilingDb,
                    sampleRate: FS,
                }, transfer);
            }
        } catch {
            setPhase('idle');
        }
    };

    const download = () => {
        if (!resultBlob) return;
        const base = (fileName || 'audio').replace(/\.[^.]+$/, '');
        downloadBlob(resultBlob, `${base}_master_${engine === 'neural' ? 'ITO' : 'DSP'}_${targetLufs}LUFS.wav`);
    };

    const busy = phase === 'working';
    const neural = engine === 'neural';

    return (
        <div className="auto-master">
            <div className="am-header">
                <h3 className="am-title">✨ AI 自动母带</h3>
                <span className={`am-device ${deviceKind}`}>
                    {deviceLabel || (neural ? '模型推理' : `本地 · ${threads || '多核'} 线程`)}
                </span>
            </div>

            <div className="am-engines">
                <button
                    className={`am-engine ${!neural ? 'active' : ''}`}
                    onClick={() => selectEngine('dsp')}
                    disabled={busy}
                >
                    <strong>DSP 智能母带</strong>
                    <span>零下载 · 即刻可用</span>
                </button>
                <button
                    className={`am-engine ${neural ? 'active' : ''}`}
                    onClick={() => selectEngine('neural')}
                    disabled={busy}
                >
                    <strong>AI 神经母带</strong>
                    <span>ITO-Master · 368MB</span>
                </button>
            </div>

            <p className="am-desc">
                {neural
                    ? 'Sony Research ITO-Master 白盒神经母带：FXencoder + TCN 在 WebGPU（失败自动降级 WASM）推理出 46 个可解释参数，驱动 6 模块工业链（6 段参量 EQ／饱和／3 段 Linkwitz-Riley 多频压缩／增益／M-S 立体声／限制器）。CC BY-NC 4.0，仅限非商业使用。'
                    : '零模型 DSP 智能母带：BS.1770-4 K 加权多核并行分析 → 30Hz 次声清理 → 校正 EQ → 胶合压缩 → 温和饱和，响度与真峰值由交付层按 EBU R128 两遍归一化。'}
                {' '}测量结果含积分响度 LUFS-I、4× 过采样真峰值 dBTP 与响度范围 LRA，导出 24-bit WAV。
            </p>

            <label
                className={`am-dropzone ${busy ? 'disabled' : ''}${isDragOver && !busy ? ' drag-over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!busy) setIsDragOver(true); }}
                onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false);
                }}
                onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDragOver(false);
                    if (busy) return;
                    const file = Array.from(e.dataTransfer.files)[0] ?? dragBridge.peek();
                    if (file) void loadInput(file);
                }}
            >
                <input
                    type="file"
                    accept="audio/*"
                    disabled={busy}
                    onChange={(e) => e.target.files?.[0] && void loadInput(e.target.files[0])}
                />
                {busy ? '处理中…' : fileName ? `已选：${fileName}（点击或拖拽更换）` : '拖拽音频到此处，或点击上传'}
            </label>

            {neural && (
                <div className="am-reference">
                    <label>
                        <input
                            type="file"
                            accept="audio/*"
                            disabled={busy}
                            onChange={(e) => e.target.files?.[0] && void loadReference(e.target.files[0])}
                        />
                        <span>{refName ? `参考曲：${refName}` : '参考曲（可选，不选则用输入自身风格）'}</span>
                    </label>
                    {refName && <button onClick={clearReference} disabled={busy} title="移除参考曲">×</button>}
                </div>
            )}

            <div className="am-settings">
                <div className="am-settings__head">
                    <span>目标响度 · 积分 LUFS-I</span>
                    <strong>{targetLufs} LUFS</strong>
                </div>
                <input
                    className="am-slider"
                    type="range"
                    min={-23}
                    max={-9}
                    step={0.5}
                    value={targetLufs}
                    onChange={(e) => setTargetLufs(Number(e.target.value))}
                />
                <div className="am-presets">
                    {PRESETS.map((p) => (
                        <button
                            key={p.label}
                            className={targetLufs === p.lufs ? 'active' : ''}
                            onClick={() => setTargetLufs(p.lufs)}
                        >
                            {p.label} {p.lufs}
                        </button>
                    ))}
                </div>
                <div className="am-settings__head">
                    <span>真峰值上限 · dBTP</span>
                    <strong>{ceilingDb} dBTP</strong>
                </div>
                <div className="am-presets">
                    {[-1, -2].map((c) => (
                        <button
                            key={c}
                            className={ceilingDb === c ? 'active' : ''}
                            onClick={() => setCeilingDb(c)}
                        >
                            {c} dBTP{c === -1 ? '（流媒体）' : '（Amazon）'}
                        </button>
                    ))}
                </div>
            </div>

            <button className="am-run" onClick={() => void run()} disabled={!fileName || busy}>
                {busy ? '处理中…' : phase === 'done' ? '重新处理' : neural ? '下载模型并智能母带' : '一键智能母带'}
            </button>

            {(busy || phase === 'done') && (
                <div className="am-progress-area">
                    {neural && <ProgressBar label="模型准备" value={modelProgress} />}
                    <ProgressBar label="母带处理" value={workProgress} />
                    {status && <p className="am-status">{status}</p>}
                </div>
            )}

            {before && after && (
                <>
                    <div className="am-metrics">
                        <div className="am-metric am-metric--head">
                            <span>指标</span><span>原始</span><span /><span>母带后</span>
                        </div>
                        <MetricRow label="积分响度" before={before.lufs} after={after.lufs} unit="LUFS" />
                        <MetricRow label="真峰值" before={before.truePeakDb} after={after.truePeakDb} unit="dBTP" />
                        <MetricRow label="样本峰值" before={before.samplePeakDb} after={after.samplePeakDb} unit="dBFS" />
                        <MetricRow label="响度范围" before={before.lra} after={after.lra} unit="LU" />
                        <MetricRow label="波峰因数" before={before.crestDb} after={after.crestDb} unit="dB" />
                    </div>

                    {display && (
                        <div className="am-plan">
                            {display.eq.map((e, i) => (
                                <span key={i}>{formatFreq(e.freq)}Hz {fmt(e.gain, 'dB')}</span>
                            ))}
                            <span>宽度 {display.width.toFixed(2)}</span>
                            {plan && (
                                <>
                                    <span>预补偿 {fmt(plan.makeupDb, 'dB')}</span>
                                    <span>压缩 {plan.ratio.toFixed(1)}:1</span>
                                </>
                            )}
                        </div>
                    )}

                    <div className="am-result">
                        <div className="am-ab">
                            <button
                                className={ab === 'original' ? 'active' : ''}
                                onClick={() => setAb('original')}
                            >原始</button>
                            <button
                                className={ab === 'master' ? 'active' : ''}
                                onClick={() => setAb('master')}
                            >母带</button>
                            <span>电平匹配 A/B</span>
                        </div>
                        <audio
                            ref={audioElRef}
                            controls
                            src={ab === 'original' ? originalUrl : previewUrl}
                            preload="none"
                        />
                        <button className="am-download" onClick={download}>下载 24-bit WAV</button>
                    </div>
                </>
            )}
        </div>
    );
};
