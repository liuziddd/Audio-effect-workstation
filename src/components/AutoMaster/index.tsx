import { useEffect, useRef, useState } from 'react';
import type { AudioFile } from '../../types/audio';
import { analyzeAudio, buildPlan, masterAudio, masterThreadCount } from '../../utils/autoMaster';
import type { MasterMetrics, MasterPlan } from '../../utils/autoMaster';
import { encodeAudioBuffer, downloadBlob } from '../../utils/wav';
import './styles.css';

interface AutoMasterProps {
    audioFile: AudioFile | null;
}

type Phase = 'idle' | 'working' | 'done';

const fmt = (v: number, unit: string) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} ${unit}`;

const MetricRow = ({ label, before, after, unit }: { label: string; before: number; after: number; unit: string }) => (
    <div className="am-metric">
        <span className="am-metric__label">{label}</span>
        <span className="am-metric__before">{fmt(before, unit)}</span>
        <span className="am-metric__arrow">→</span>
        <span className="am-metric__after">{fmt(after, unit)}</span>
    </div>
);

export const AutoMaster = ({ audioFile }: AutoMasterProps) => {
    const [phase, setPhase] = useState<Phase>('idle');
    const [status, setStatus] = useState('');
    const [progress, setProgress] = useState(0);
    const [before, setBefore] = useState<MasterMetrics | null>(null);
    const [after, setAfter] = useState<MasterMetrics | null>(null);
    const [plan, setPlan] = useState<MasterPlan | null>(null);
    const [previewUrl, setPreviewUrl] = useState('');
    const [threads, setThreads] = useState(0);
    const previewUrlRef = useRef('');
    const resultBlobRef = useRef<Blob | null>(null);

    useEffect(() => () => {
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    }, []);

    const run = async () => {
        if (!audioFile || phase === 'working') return;
        setPhase('working');
        setStatus('正在解码音频…');
        setProgress(0.05);

        const res = await fetch(audioFile.url);
        const ctx = new AudioContext();
        const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
        await ctx.close();

        const count = masterThreadCount(buffer.length, buffer.sampleRate);
        setThreads(count);
        setStatus(`${count} 线程并行分析响度与频段…`);
        const metrics = await analyzeAudio(buffer, (r) => setProgress(0.05 + r * 0.3));
        setBefore(metrics);
        const p = buildPlan(metrics);
        setPlan(p);

        setStatus('原生音频线程离线渲染母带链…');
        setProgress(0.55);
        const mastered = await masterAudio(buffer, p);
        setProgress(0.85);

        const result = await analyzeAudio(mastered, (r) => setProgress(0.85 + r * 0.15));
        setAfter(result);
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        const blob = encodeAudioBuffer(mastered);
        resultBlobRef.current = blob;
        const url = URL.createObjectURL(blob);
        previewUrlRef.current = url;
        setPreviewUrl(url);
        setProgress(1);
        setStatus('母带处理完成');
        setPhase('done');
    };

    const download = () => {
        if (!resultBlobRef.current || !audioFile) return;
        downloadBlob(resultBlobRef.current, `${audioFile.name.replace(/\.[^.]+$/, '')}_master.wav`);
    };

    return (
        <div className="auto-master">
            <div className="am-header">
                <h3 className="am-title">✨ 自动母带</h3>
                <span className="am-badge">DSP · 本地 · 零模型</span>
            </div>
            <p className="am-desc">
                基于信号处理的自动母带（非 AI 模型）：ITU-R BS.1770 响度测量、三频平衡分析，
                自动推导 EQ／压缩／响度补偿，再离线渲染软削波与峰值限制。
                分析跑在多核 Worker，渲染跑在浏览器原生音频线程，目标 −14 LUFS、峰值 −1 dBFS。
                {threads > 0 && ` 本次使用 ${threads} 个分析线程。`}
            </p>

            <button className="am-run" onClick={() => run().catch(() => setPhase('idle'))} disabled={!audioFile || phase === 'working'}>
                {phase === 'working' ? '处理中…' : phase === 'done' ? '重新处理' : '一键智能母带'}
            </button>
            {!audioFile && <p className="am-hint">请先在工作区上传音频文件</p>}

            {(phase === 'working' || phase === 'done') && (
                <div className="am-progress">
                    <div className="am-progress__head">
                        <span>{status}</span>
                        <span>{Math.round(progress * 100)}%</span>
                    </div>
                    <div className="am-progress__track">
                        <span className="am-progress__fill" style={{ transform: `scaleX(${progress})` }} />
                    </div>
                </div>
            )}

            {before && after && (
                <div className="am-metrics">
                    <div className="am-metric am-metric--head">
                        <span>指标</span><span>原始</span><span /><span>母带后</span>
                    </div>
                    <MetricRow label="积分响度" before={before.lufs} after={after.lufs} unit="LUFS" />
                    <MetricRow label="峰值" before={before.peakDb} after={after.peakDb} unit="dBFS" />
                    <MetricRow label="动态余量" before={before.crestDb} after={after.crestDb} unit="dB" />
                    <MetricRow label="低频平衡" before={before.lowDb} after={after.lowDb} unit="dB" />
                    <MetricRow label="中频平衡" before={before.midDb} after={after.midDb} unit="dB" />
                    <MetricRow label="高频平衡" before={before.highDb} after={after.highDb} unit="dB" />
                </div>
            )}

            {plan && (
                <div className="am-plan">
                    <span>低架 {fmt(plan.lowGain, 'dB')}</span>
                    <span>中频 {fmt(plan.midGain, 'dB')}</span>
                    <span>高架 {fmt(plan.highGain, 'dB')}</span>
                    <span>补偿 {fmt(plan.makeupDb, 'dB')}</span>
                    <span>压缩 {plan.ratio.toFixed(1)}:1</span>
                </div>
            )}

            {previewUrl && (
                <div className="am-result">
                    <audio controls src={previewUrl} preload="none" />
                    <button className="am-download" onClick={download}>下载母带 WAV</button>
                </div>
            )}
        </div>
    );
};
