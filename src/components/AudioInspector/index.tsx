import { useState, useEffect, useRef } from 'react';
import { analyzeAudio, evaluateAudio } from '../../utils/audioAnalysis';
import type { AnalysisResult, Evaluation, Grade } from '../../utils/audioAnalysis';
import { WaveformView, SpectrumView } from './Visualizations';
import './styles.css';

interface Spec {
    fileName: string;
    fileSize: string;
    container: string;
    codec: string;
    duration: string;
    sampleRate: string;
    channels: string;
    bitDepth: string;
    bitrate: string;
    mime: string;
}

interface PlayResult {
    ok: boolean;
    text: string;
    url?: string;
}

const FORMATS: [string, string][] = [
    ['MP3', 'audio/mpeg'],
    ['WAV', 'audio/wav'],
    ['OGG', 'audio/ogg'],
    ['AAC', 'audio/aac'],
    ['M4A', 'audio/mp4'],
    ['WebM', 'audio/webm'],
    ['FLAC', 'audio/flac'],
];

const GRADE_META: Record<Grade, { text: string; color: string }> = {
    good: { text: '优秀', color: '#34d399' },
    ok: { text: '良好', color: '#38bdf8' },
    warn: { text: '需注意', color: '#fbbf24' },
    bad: { text: '问题', color: '#f87171' },
};

const formatBytes = (bytes: number) => {
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = bytes === 0 ? 0 : Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2) + ' ' + units[i];
};

const formatDuration = (seconds: number | null) => {
    if (seconds == null || !isFinite(seconds)) return '—';
    const total = Math.round(seconds * 1000) / 1000;
    const mins = Math.floor(total / 60);
    const secs = (total % 60).toFixed(3).padStart(6, '0');
    return `${mins}:${secs}`;
};

const ascii = (bytes: Uint8Array, start: number, length: number) =>
    String.fromCharCode(...bytes.slice(start, start + length));

const detectFormat = (bytes: Uint8Array, fileName: string) => {
    if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') {
        let codec = 'WAV';
        let bitDepth: number | null = null;
        let offset = 12;
        while (offset + 8 <= bytes.length) {
            const chunkId = ascii(bytes, offset, 4);
            const chunkSize = bytes[offset + 4] | (bytes[offset + 5] << 8) | (bytes[offset + 6] << 16) | (bytes[offset + 7] << 24);
            if (chunkId === 'fmt ') {
                const view = new DataView(bytes.buffer, offset + 8, Math.min(chunkSize, 40));
                const format = view.getUint16(0, true);
                bitDepth = view.getUint16(14, true);
                codec = format === 1 ? 'PCM' : format === 3 ? 'IEEE Float' :
                    format === 0xfffe ? 'WAV Extensible' : `WAV (0x${format.toString(16)})`;
                break;
            }
            offset += 8 + chunkSize + (chunkSize & 1);
        }
        return { container: 'WAV', codec, bitDepth };
    }
    if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return { container: 'MP3', codec: 'MPEG Audio', bitDepth: null };
    if (ascii(bytes, 0, 4) === 'OggS') return { container: 'OGG', codec: 'Vorbis / Opus', bitDepth: null };
    if (ascii(bytes, 4, 4) === 'ftyp') {
        const brand = ascii(bytes, 8, 4);
        return { container: 'MP4/M4A', codec: brand.startsWith('M4A') ? 'AAC' : `AAC (${brand})`, bitDepth: null };
    }
    if (ascii(bytes, 0, 4) === 'fLaC') return { container: 'FLAC', codec: 'FLAC', bitDepth: null };
    if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
        return { container: 'WebM/EBML', codec: 'Opus/Vorbis', bitDepth: null };
    const ext = fileName.split('.').pop()?.toUpperCase();
    return { container: ext || '未知', codec: '未知', bitDepth: null };
};

const formatMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`);

export const AudioInspector = () => {
    const [spec, setSpec] = useState<Spec | null>(null);
    const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
    const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
    const [play, setPlay] = useState<PlayResult | null>(null);
    const [message, setMessage] = useState('');
    const [previewUrl, setPreviewUrl] = useState('');
    const [formats, setFormats] = useState<{ name: string; level: 'ok' | 'warn' | 'bad' }[]>([]);
    const objectUrlRef = useRef<string | null>(null);

    useEffect(() => {
        const probe = new Audio();
        setFormats(FORMATS.map(([name, mime]) => {
            const support = probe.canPlayType(mime);
            return { name, level: support === 'probably' ? 'ok' : support === 'maybe' ? 'warn' : 'bad' };
        }));
        return () => {
            if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        };
    }, []);

    const handleFile = async (file: File) => {
        setMessage('解析中...');
        setSpec(null);
        setAnalysis(null);
        setEvaluation(null);
        setPlay(null);

        try {
            const [header, audioBuffer] = await Promise.all([
                file.slice(0, 128).arrayBuffer().then((b) => new Uint8Array(b)),
                decodeFile(file),
            ]);

            const info = detectFormat(header, file.name);
            const duration = audioBuffer.duration;
            const bitrate = duration ? Math.round((file.size * 8) / duration / 1000) : null;
            setSpec({
                fileName: file.name,
                fileSize: formatBytes(file.size),
                container: info.container,
                codec: info.codec,
                duration: formatDuration(duration),
                sampleRate: audioBuffer.sampleRate.toLocaleString() + ' Hz',
                channels: `${audioBuffer.numberOfChannels} ch (${audioBuffer.numberOfChannels === 1 ? 'mono' : audioBuffer.numberOfChannels === 2 ? 'stereo' : 'multi'})`,
                bitDepth: info.bitDepth ? `${info.bitDepth} bit` : '—',
                bitrate: bitrate ? `${bitrate} kbps` : '—',
                mime: file.type || '未知',
            });

            setMessage('分析音频中...');
            await new Promise((r) => setTimeout(r, 0));
            const result = analyzeAudio(audioBuffer);
            setAnalysis(result);
            setEvaluation(evaluateAudio(result.metrics));
            setMessage('');

            const playResult = await testPlayback(file);
            setPlay(playResult);
        } catch (error) {
            setMessage(`解码失败：${error instanceof Error ? error.message : String(error)}`);
        }
    };

    const decodeFile = async (file: File) => {
        const buffer = await file.arrayBuffer();
        const ctx = new AudioContext();
        try {
            return await ctx.decodeAudioData(buffer);
        } finally {
            await ctx.close();
        }
    };

    const testPlayback = (file: File) =>
        new Promise<PlayResult>((resolve) => {
            if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
            const url = URL.createObjectURL(file);
            objectUrlRef.current = url;
            setPreviewUrl(url);

            const audio = new Audio();
            let settled = false;
            const finish = (result: PlayResult) => {
                if (settled) return;
                settled = true;
                resolve(result);
            };

            audio.addEventListener('loadedmetadata', () => {
                finish({ ok: true, text: '可播放（浏览器与 Web Audio 均可加载）', url });
            }, { once: true });
            audio.addEventListener('error', () => {
                const code = audio.error?.code ?? 0;
                const text = {
                    1: '加载被中止', 2: '网络错误', 3: '解码失败（文件损坏或编码不受支持）', 4: '格式不受支持',
                }[code] || `媒体错误（代码 ${code}）`;
                finish({ ok: false, text });
            }, { once: true });
            setTimeout(() => finish({ ok: false, text: '加载超时' }), 10000);
            audio.src = url;
            audio.preload = 'metadata';
        });

    return (
        <div className="audio-inspector">
            <label className="inspector-dropzone">
                <input type="file" accept="audio/*" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
                选择音频文件进行检测
            </label>
            <p className="inspector-hint">解析文件规格、波形/频谱、专业指标（响度/动态/削波/相位）并做播放测试，文件仅在本地处理。</p>

            {message && <p className="inspector-message info">{message}</p>}

            {analysis && spec && (
                <>
                    <div className="inspector-card">
                        <h4>波形</h4>
                        <WaveformView peaks={analysis.peaks} channels={analysis.metrics.channels} />
                    </div>

                    <div className="inspector-card">
                        <h4>频谱</h4>
                        <SpectrumView spectrum={analysis.spectrum} />
                    </div>

                    {evaluation && (
                        <div className="inspector-card">
                            <h4>专业评价</h4>
                            <div className="score-row">
                                <span className="score-badge" style={{ color: GRADE_META[evaluation.grade].color, borderColor: GRADE_META[evaluation.grade].color }}>
                                    {evaluation.score}
                                </span>
                                <div className="score-meta">
                                    <span className="grade-text" style={{ color: GRADE_META[evaluation.grade].color }}>
                                        {GRADE_META[evaluation.grade].text}
                                    </span>
                                    <p className="inspector-hint">{evaluation.summary}</p>
                                </div>
                            </div>
                            <div className="eval-list">
                                {evaluation.items.map((item) => (
                                    <div key={item.label} className="eval-item">
                                        <div className="eval-head">
                                            <span className="eval-label">{item.label}</span>
                                            <span className="eval-value">{item.value}</span>
                                            <span className="eval-grade" style={{ color: GRADE_META[item.grade].color }}>
                                                {GRADE_META[item.grade].text}
                                            </span>
                                        </div>
                                        <p className="inspector-hint">{item.comment}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {analysis && (
                        <div className="inspector-card">
                            <h4>专业指标</h4>
                            <table className="spec-table">
                                <tbody>
                                    {[
                                        ['峰值电平', `${analysis.metrics.peakDb.toFixed(2)} dBFS`],
                                        ['真实峰值', `${analysis.metrics.truePeakDb.toFixed(2)} dBTP`],
                                        ['RMS 电平', `${analysis.metrics.rmsDb.toFixed(2)} dBFS`],
                                        ['集成响度', Number.isFinite(analysis.metrics.lufs) ? `${analysis.metrics.lufs.toFixed(1)} LUFS` : '—'],
                                        ['动态范围', `${analysis.metrics.crestDb.toFixed(1)} dB`],
                                        ['相位相关', analysis.metrics.phaseCorrelation !== null ? `${(analysis.metrics.phaseCorrelation * 100).toFixed(0)}%` : '—（单声道）'],
                                        ['直流偏置', `${(analysis.metrics.dcOffset * 100).toFixed(3)}%`],
                                        ['频谱质心', `${Math.round(analysis.metrics.spectralCentroid).toLocaleString()} Hz`],
                                        ['开头静音', formatMs(analysis.metrics.leadSilenceMs)],
                                        ['结尾静音', formatMs(analysis.metrics.tailSilenceMs)],
                                    ].map(([k, v]) => (
                                        <tr key={k}><td>{k}</td><td>{v}</td></tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}

            {spec && (
                <div className="inspector-card">
                    <h4>文件规格</h4>
                    <table className="spec-table">
                        <tbody>
                            {Object.entries({
                                文件名: spec.fileName, 文件大小: spec.fileSize, 容器格式: spec.container, 编码: spec.codec,
                                时长: spec.duration, 采样率: spec.sampleRate, 声道: spec.channels, 位深: spec.bitDepth,
                                比特率: spec.bitrate, MIME: spec.mime,
                            }).map(([k, v]) => (
                                <tr key={k}><td>{k}</td><td>{v}</td></tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {play && (
                <div className="inspector-card">
                    <h4>播放测试</h4>
                    <p className={`inspector-message ${play.ok ? 'ok' : 'bad'}`}>{play.ok ? '✅' : '❌'} {play.text}</p>
                    {play.ok && <audio controls src={previewUrl} preload="none" />}
                    {!play.ok && <p className="inspector-hint">建议：用 FFmpeg 重编码为标准格式，例如 16-bit PCM WAV 或 192 kbps MP3。</p>}
                </div>
            )}

            <div className="inspector-card">
                <h4>当前浏览器格式支持</h4>
                <div className="format-grid">
                    {formats.map((f) => (
                        <span key={f.name} className={`format-item ${f.level}`}>
                            {f.name}{f.level === 'warn' ? ' ?' : f.level === 'bad' ? ' ✕' : ''}
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );
};
