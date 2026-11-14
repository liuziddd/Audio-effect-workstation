import { useEffect, useRef } from 'react';
import * as Tone from 'tone';
import { useThemeTokens } from '../../utils/theme';

interface WaveformProps {
    /** 通道后级分析器（推子之后、声像之前），读到的是这一路真实信号 */
    analyser: Tone.Analyser | null;
    playing: boolean;
    /** 换文件 / 清空时重置画面 */
    resetKey: string;
}

/** 一行代表的时间 */
const ROW_SECONDS = 0.018;
/** 环形缓冲容量（行），够高通道回看约 11 秒 */
const CAPACITY = 640;
/** 顶到满刻度即视为削波 */
const CLIP_LEVEL = 0.999;
/**
 * 通道波形：只在播放时绘制，底部是播放头，向上是最近这一段历史。
 * 每一行取分析器里真实采样的最大值与最小值，所以推子拉爆、效果器失真、
 * 削波平顶都会原样显示；暂停/停止后画面冻结，不播时保持空白。
 */
export const Waveform = ({ analyser, playing, resetKey }: WaveformProps) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { isLight } = useThemeTokens();
    const ring = useRef({
        hi: new Float32Array(CAPACITY),
        lo: new Float32Array(CAPACITY),
        head: 0,
        count: 0,
    }).current;
    const lastPushRef = useRef(0);
    const paintRef = useRef<() => void>(() => {});

    // 换文件 / 清空：丢掉旧画面
    useEffect(() => {
        ring.head = 0;
        ring.count = 0;
        paintRef.current();
    }, [resetKey, ring]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;

        let width = 0;
        let height = 0;
        let rowH = 1;
        const ink = isLight ? '#D99300' : '#FFD23F';
        const over = '#FF3B30';

        /** 同步画布像素尺寸；闭包里的 width/height 每次都跟着刷新，不能只在尺寸变化时赋值 */
        const fit = () => {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
            const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
            const changed = w !== canvas.width || h !== canvas.height;
            if (changed) {
                canvas.width = w;
                canvas.height = h;
            }
            width = w;
            height = h;
            rowH = dpr;
            return changed;
        };

        /** 用环形缓冲重画：最新的一行在最底部；没有历史就保持空白 */
        const paint = () => {
            ctx.clearRect(0, 0, width, height);
            if (!ring.count) return;
            const rows = Math.max(1, Math.round(height / rowH));
            const visible = Math.min(rows, ring.count);
            const mid = width / 2;
            const gap = height / rows;
            for (let i = 0; i < visible; i++) {
                const index = (ring.head - 1 - i + CAPACITY) % CAPACITY;
                const hi = ring.hi[index];
                const lo = ring.lo[index];
                // 超过满刻度的部分被画成贴边的平顶，并且整行标红
                ctx.fillStyle = hi >= CLIP_LEVEL || lo <= -CLIP_LEVEL ? over : ink;
                const left = mid + Math.max(-1, lo) * mid;
                const right = mid + Math.min(1, hi) * mid;
                if (right - left < 1) continue;
                ctx.fillRect(left, height - (i + 1) * gap, right - left, gap + 0.5);
            }
        };
        paintRef.current = paint;

        /** 从分析器取一帧的真实最小 / 最大值，按真实时间每 18ms 推进一行 */
        const sample = (now: number) => {
            if (!analyser) return;
            const data = analyser.getValue() as Float32Array;
            let hi = 0;
            let lo = 0;
            for (let i = 0; i < data.length; i++) {
                const value = data[i];
                if (value > hi) hi = value;
                if (value < lo) lo = value;
            }
            const last = lastPushRef.current;
            if (!last) {
                lastPushRef.current = now;
                return;
            }
            let rows = Math.floor((now - last) / (ROW_SECONDS * 1000));
            if (rows < 1) return;
            if (rows > 6) rows = 6;
            lastPushRef.current = last + rows * ROW_SECONDS * 1000;
            for (let i = 0; i < rows; i++) {
                ring.hi[ring.head] = hi;
                ring.lo[ring.head] = lo;
                ring.head = (ring.head + 1) % CAPACITY;
                if (ring.count < CAPACITY) ring.count += 1;
            }
        };

        fit();
        paint();

        let raf = 0;
        if (playing && analyser) {
            lastPushRef.current = 0;
            const loop = (now: number) => {
                sample(now);
                paint();
                raf = requestAnimationFrame(loop);
            };
            raf = requestAnimationFrame(loop);
        }

        const observer = new ResizeObserver(() => {
            if (fit()) paint();
        });
        observer.observe(canvas);

        return () => {
            cancelAnimationFrame(raf);
            observer.disconnect();
        };
    }, [playing, analyser, isLight, ring]);

    return <canvas ref={canvasRef} />;
};
