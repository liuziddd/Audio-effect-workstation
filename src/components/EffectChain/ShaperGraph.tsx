import React, { useRef, useEffect, useCallback, useState } from 'react';
import { ShaperPoint } from '../../types/audio';

interface ShaperGraphProps {
    points: ShaperPoint[];
    onChange: (points: ShaperPoint[]) => void;
}

const WIDTH = 520;
const HEIGHT = 220;
const PAD = 24;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// 输入值(-1..1) → 画布 x；输出值(-1..1) → 画布 y（y 轴向上）
const inToX = (v: number) => PAD + ((v + 1) / 2) * (WIDTH - 2 * PAD);
const xToIn = (x: number) => ((x - PAD) / (WIDTH - 2 * PAD)) * 2 - 1;
const outToY = (v: number) => PAD + ((1 - v) / 2) * (HEIGHT - 2 * PAD);
const yToOut = (y: number) => 1 - ((y - PAD) / (HEIGHT - 2 * PAD)) * 2;

/** Catmull-Rom 采样（与音频层一致），返回画布坐标曲线点 */
const sampleCurve = (points: ShaperPoint[]): { x: number; y: number }[] => {
    const pts = [...points].sort((a, b) => a.x - b.x);
    const n = pts.length;
    if (n === 0) return [];
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const result: { x: number; y: number }[] = [];
    const SEG = 160;
    for (let i = 0; i <= SEG; i++) {
        const x = -1 + (2 * i) / SEG;
        let seg = 0;
        while (seg < n - 1 && x > xs[seg + 1]) seg++;
        const p0 = Math.max(0, seg - 1);
        const p1 = seg;
        const p2 = Math.min(n - 1, seg + 1);
        const p3 = Math.min(n - 1, seg + 2);
        const t = (x - xs[p1]) / (xs[p2] - xs[p1] || 1);
        const tt = t * t;
        const y = 0.5 * (
            (2 * ys[p1]) +
            (-ys[p0] + ys[p2]) * t +
            (2 * ys[p0] - 5 * ys[p1] + 4 * ys[p2] - ys[p3]) * tt +
            (-ys[p0] + 3 * ys[p1] - 3 * ys[p2] + ys[p3]) * tt * t
        );
        result.push({ x: inToX(x), y: outToY(clamp(y, -1, 1)) });
    }
    return result;
};

const draw = (ctx: CanvasRenderingContext2D, points: ShaperPoint[], selectedIdx: number | null) => {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = '#101119';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // 网格
    ctx.lineWidth = 1;
    for (let i = -1; i <= 1; i += 0.5) {
        const x = inToX(i);
        const y = outToY(i);
        ctx.strokeStyle = i === 0 ? '#3a3e52' : '#232636';
        ctx.beginPath();
        ctx.moveTo(x, PAD);
        ctx.lineTo(x, HEIGHT - PAD);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(PAD, y);
        ctx.lineTo(WIDTH - PAD, y);
        ctx.stroke();
    }

    // 对角线参考（无失真 y=x）
    ctx.strokeStyle = '#3a3e52';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(inToX(-1), outToY(-1));
    ctx.lineTo(inToX(1), outToY(1));
    ctx.stroke();
    ctx.setLineDash([]);

    // 整形曲线
    const curve = sampleCurve(points);
    if (curve.length > 1) {
        ctx.beginPath();
        curve.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.strokeStyle = '#ff453a';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // 控制点（首尾端点固定，中间点可拖）
    points.forEach((p, i) => {
        const selected = i === selectedIdx;
        const isEnd = i === 0 || i === points.length - 1;
        const x = inToX(p.x);
        const y = outToY(p.y);
        ctx.beginPath();
        ctx.arc(x, y, selected ? 7 : 5, 0, Math.PI * 2);
        ctx.fillStyle = isEnd ? '#5b6172' : selected ? '#ffffff' : '#ff6b5e';
        ctx.fill();
        ctx.strokeStyle = '#0a0b12';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        if (selected) {
            ctx.beginPath();
            ctx.arc(x, y, 11, 0, Math.PI * 2);
            ctx.strokeStyle = '#ff453a';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    });
};

const toCanvasPoint = (canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    return {
        x: ((clientX - rect.left) * WIDTH) / rect.width,
        y: ((clientY - rect.top) * HEIGHT) / rect.height,
    };
};

/** 波形整形曲线编辑器（类 FL WaveShaper）：拖动控制点、点击空白添加、双击删除中间点 */
export const ShaperGraph: React.FC<ShaperGraphProps> = ({ points, onChange }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const dragRef = useRef<number | null>(null);
    const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = WIDTH * dpr;
        canvas.height = HEIGHT * dpr;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.scale(dpr, dpr);
        draw(ctx, points, selectedIdx);
    }, [points, selectedIdx]);

    const hitIndex = useCallback(
        (point: { x: number; y: number }) => {
            let nearest = -1;
            let minDist = 22;
            points.forEach((p, i) => {
                const d = Math.hypot(inToX(p.x) - point.x, outToY(p.y) - point.y);
                if (d < minDist) {
                    minDist = d;
                    nearest = i;
                }
            });
            return nearest >= 0 ? nearest : null;
        },
        [points]
    );

    const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const point = toCanvasPoint(canvas, e.clientX, e.clientY);
        const hit = hitIndex(point);

        let idx = hit;
        if (idx === null) {
            // 点击空白：插入新控制点（夹在现有 x 顺序中）
            const nx = clamp(xToIn(point.x), -0.9, 0.9);
            const ny = clamp(yToOut(point.y), -1, 1);
            const next = [...points, { x: nx, y: ny }].sort((a, b) => a.x - b.x);
            idx = next.findIndex((p) => p.x === nx && p.y === ny);
            onChange(next);
        }
        // 首尾端点固定不可拖，仅中间点可拖
        const isEnd = idx === 0 || idx === points.length - 1;
        setSelectedIdx(idx);
        if (!isEnd) dragRef.current = idx;
        canvas.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const idx = dragRef.current;
        if (idx === null) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const point = toCanvasPoint(canvas, e.clientX, e.clientY);
        const nx = clamp(xToIn(point.x), -0.9, 0.9);
        const ny = clamp(yToOut(point.y), -1, 1);
        onChange(points.map((p, i) => (i === idx ? { x: nx, y: ny } : p)));
    };

    const onPointerUp = () => {
        dragRef.current = null;
    };

    const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const hit = hitIndex(toCanvasPoint(canvas, e.clientX, e.clientY));
        if (hit === null) return;
        if (hit === 0 || hit === points.length - 1) return; // 端点不可删
        onChange(points.filter((_, i) => i !== hit));
        setSelectedIdx(null);
    };

    return (
        <div className="shaper-graph">
            <canvas
                ref={canvasRef}
                style={{ width: '100%', height: 'auto', display: 'block', cursor: 'crosshair', touchAction: 'none' }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onDoubleClick={onDoubleClick}
            />
            <p className="eq-hint">拖动曲线点塑形 · 点击空白加点 · 双击删除（首尾端点固定）</p>
        </div>
    );
};
