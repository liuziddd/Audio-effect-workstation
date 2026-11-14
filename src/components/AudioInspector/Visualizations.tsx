import { useEffect, useRef } from 'react';
import type { WaveformPeaks, SpectrumBand } from '../../utils/audioAnalysis';
import { themeColor } from '../../utils/theme';

/** 用 ResizeObserver 监听容器宽度，配合 devicePixelRatio 高清重绘 Canvas */
const useCanvas = (draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) => {
    const ref = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;
        const resize = () => {
            const dpr = window.devicePixelRatio || 1;
            const { width, height } = canvas.getBoundingClientRect();
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            draw(ctx, width, height);
        };
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(canvas);
        return () => observer.disconnect();
    }, [draw]);
    return ref;
};

interface WaveformViewProps {
    peaks: WaveformPeaks[][];
    channels: number;
}

/** 波形图：立体声上下双轨，单声道单轨 */
export const WaveformView = ({ peaks, channels }: WaveformViewProps) => {
    const ref = useCanvas((ctx, w, h) => {
        ctx.clearRect(0, 0, w, h);
        const trackHeight = h / channels;
        peaks.forEach((track, c) => {
            const top = c * trackHeight;
            const center = top + trackHeight / 2;
            const half = trackHeight * 0.44;
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.beginPath();
            ctx.moveTo(0, center);
            ctx.lineTo(w, center);
            ctx.stroke();

            const gradient = ctx.createLinearGradient(0, top, 0, top + trackHeight);
            gradient.addColorStop(0, themeColor('--accent', '#A6FF00'));
            gradient.addColorStop(1, themeColor('--accent-2', '#C6FF4D'));
            ctx.fillStyle = gradient;
            ctx.beginPath();
            const step = w / track.length;
            track.forEach((p, i) => {
                const x = i * step;
                const y1 = center - p.max * half;
                const y2 = center - p.min * half;
                if (i === 0) ctx.moveTo(x, y1);
                else ctx.lineTo(x, y1);
                ctx.lineTo(x, y2);
            });
            for (let i = track.length - 1; i >= 0; i--) {
                const x = i * step;
                ctx.lineTo(x, center - track[i].min * half);
            }
            ctx.closePath();
            ctx.fill();
        });
    });
    return <canvas ref={ref} className="waveform-canvas" />;
};

interface SpectrumViewProps {
    spectrum: SpectrumBand[];
}

/** 频谱图：对数频率轴 + dB 幅度 */
export const SpectrumView = ({ spectrum }: SpectrumViewProps) => {
    const ref = useCanvas((ctx, w, h) => {
        ctx.clearRect(0, 0, w, h);
        if (!spectrum.length) return;
        const minDb = -100;
        const maxDb = 0;
        const toY = (db: number) => h - ((db - minDb) / (maxDb - minDb)) * h;
        const step = w / spectrum.length;

        const gradient = ctx.createLinearGradient(0, 0, 0, h);
        gradient.addColorStop(0, themeColor('--accent', '#A6FF00'));
        gradient.addColorStop(1, themeColor('--accent-2', '#C6FF4D'));
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(0, h);
        spectrum.forEach((band, i) => {
            const x = i * step;
            const y = toY(band.level);
            ctx.lineTo(x, y);
        });
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'left';
        for (const freq of [100, 1000, 10000]) {
            const x = ((Math.log10(freq) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20))) * w;
            ctx.fillText(freq >= 1000 ? `${freq / 1000}k` : `${freq}`, x, h - 2);
        }
    });
    return <canvas ref={ref} className="spectrum-canvas" />;
};
