import { useEffect, useRef } from 'react';
import type { Chain } from './contourField';
import { CELL, fillGrid, levelValues, relaxChain, traceLevel } from './contourField';

interface WaveBackgroundProps {
    /** 等值线条数 */
    levels?: number;
    /** 波动速度 */
    speed?: number;
}

const FRAME_MS = 40; // 25fps

/** 编辑页背景：实时波动的拓扑等高线（Catmull-Rom 三次贝塞尔，切线连续） */
export const WaveBackground = ({ levels = 18, speed = 0.19 }: WaveBackgroundProps) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let raf = 0;
        let lastFrame = 0;
        let cols = 0;
        let rows = 0;
        let grid = new Float32Array(0);
        let w = 0;
        let h = 0;

        const resize = () => {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            w = window.innerWidth;
            h = window.innerHeight;
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            cols = Math.ceil(w / CELL) + 1;
            rows = Math.ceil(h / CELL) + 1;
            grid = new Float32Array(cols * rows);
        };
        resize();
        window.addEventListener('resize', resize);

        /** 经过每个轮廓点的三次贝塞尔，切向由前后两点决定，曲率连续不再有折角 */
        const strokeChain = (chain: Chain) => {
            const pts = chain.pts;
            const n = pts.length;
            if (n < 2) return;
            ctx.moveTo(pts[0][0], pts[0][1]);
            const count = chain.closed ? n : n - 1;
            for (let i = 0; i < count; i++) {
                const p0 = pts[chain.closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
                const p1 = pts[i];
                const p2 = pts[(i + 1) % n];
                const p3 = pts[chain.closed ? (i + 2) % n : Math.min(n - 1, i + 2)];
                ctx.bezierCurveTo(
                    p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
                    p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
                    p2[0], p2[1],
                );
            }
            if (chain.closed) ctx.closePath();
        };

        const draw = (now: number) => {
            raf = requestAnimationFrame(draw);
            if (now - lastFrame < FRAME_MS) return;
            lastFrame = now;
            fillGrid(grid, cols, rows, w, h, now * 0.001 * speed);

            ctx.clearRect(0, 0, w, h);
            const light = document.documentElement.classList.contains('light');
            ctx.strokeStyle = light ? 'rgba(72, 78, 90, 0.42)' : 'rgba(186, 192, 204, 0.48)';
            ctx.lineWidth = 1.2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            for (const L of levelValues(grid, levels)) {
                for (const chain of traceLevel(grid, cols, rows, L)) strokeChain(relaxChain(chain));
            }
            ctx.stroke();
        };

        raf = requestAnimationFrame(draw);

        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('resize', resize);
        };
    }, [levels, speed]);

    return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none" style={{ width: '100%', height: '100%' }} aria-hidden />;
};
