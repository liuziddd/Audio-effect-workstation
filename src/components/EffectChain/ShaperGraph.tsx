import React, { useRef, useEffect, useCallback, useState } from 'react';
import { ShaperPoint } from '../../types/audio';
import { useThemeTokens, type ThemeTokens } from '../../utils/theme';

interface ShaperGraphProps {
    points: ShaperPoint[];
    onChange: (points: ShaperPoint[]) => void;
}

const WIDTH = 520;
const HEIGHT = 260;
const PAD_LEFT = 42;   // 左侧留白放输出电平刻度
const PAD_RIGHT = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 30;  // 底部留白放输入电平刻度

// 横轴：输入电平 -1~+1；纵轴：输出电平 -1~+1（均为线性）
const IN_MIN = -1;
const IN_MAX = 1;
const OUT_MIN = -1;
const OUT_MAX = 1;

const TICKS = [-1, -0.5, 0, 0.5, 1];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const plotW = () => WIDTH - PAD_LEFT - PAD_RIGHT;
const plotH = () => HEIGHT - PAD_TOP - PAD_BOTTOM;

const inToX = (v: number) => PAD_LEFT + ((v - IN_MIN) / (IN_MAX - IN_MIN)) * plotW();
const xToIn = (x: number) => IN_MIN + ((x - PAD_LEFT) / plotW()) * (IN_MAX - IN_MIN);
const outToY = (v: number) => PAD_TOP + ((OUT_MAX - v) / (OUT_MAX - OUT_MIN)) * plotH();
const yToOut = (y: number) => OUT_MAX - ((y - PAD_TOP) / plotH()) * (OUT_MAX - OUT_MIN);

const fmt = (v: number) => (Math.abs(v) < 1e-9 ? '0' : v > 0 ? `+${v}` : `${v}`);

/** 线性分段采样（与音频层 buildShaperCurve 一致），横轴输入电平、纵轴输出电平 */
const sampleCurve = (points: ShaperPoint[]): { x: number; y: number }[] => {
    const pts = [...points].sort((a, b) => a.x - b.x);
    const n = pts.length;
    if (n === 0) return [];
    const result: { x: number; y: number }[] = [];
    const SEG = 200;
    for (let i = 0; i <= SEG; i++) {
        const x = IN_MIN + ((IN_MAX - IN_MIN) * i) / SEG;
        let y: number;
        if (x <= pts[0].x) {
            y = pts[0].y;
        } else if (x >= pts[n - 1].x) {
            y = pts[n - 1].y;
        } else {
            let seg = 0;
            while (seg < n - 2 && x > pts[seg + 1].x) seg++;
            const x0 = pts[seg].x;
            const y0 = pts[seg].y;
            const x1 = pts[seg + 1].x;
            const y1 = pts[seg + 1].y;
            const t = (x - x0) / (x1 - x0);
            y = y0 + t * (y1 - y0);
        }
        result.push({ x: inToX(x), y: outToY(clamp(y, OUT_MIN, OUT_MAX)) });
    }
    return result;
};

const draw = (ctx: CanvasRenderingContext2D, points: ShaperPoint[], selectedIdx: number | null, t: ThemeTokens) => {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = t.canvas;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.lineWidth = 1;

    // 网格 + 刻度（横轴输入电平、纵轴输出电平）
    TICKS.forEach((v) => {
        const x = inToX(v);
        ctx.strokeStyle = v === 0 ? t.grid : t.gridSoft;
        ctx.beginPath();
        ctx.moveTo(x, PAD_TOP);
        ctx.lineTo(x, HEIGHT - PAD_BOTTOM);
        ctx.stroke();
        ctx.fillStyle = t.tick;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(fmt(v), x, HEIGHT - PAD_BOTTOM + 14);

        const y = outToY(v);
        ctx.strokeStyle = v === 0 ? t.grid : t.gridSoft;
        ctx.beginPath();
        ctx.moveTo(PAD_LEFT, y);
        ctx.lineTo(WIDTH - PAD_RIGHT, y);
        ctx.stroke();
        ctx.fillStyle = t.tick;
        ctx.textAlign = 'right';
        ctx.fillText(fmt(v), PAD_LEFT - 6, y + 3);
    });

    // 对角线 y=x（线性、无失真参考）
    ctx.strokeStyle = t.grid;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(inToX(IN_MIN), outToY(OUT_MIN));
    ctx.lineTo(inToX(IN_MAX), outToY(OUT_MAX));
    ctx.stroke();
    ctx.setLineDash([]);

    // 轴标签
    ctx.fillStyle = t.tick;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('输出', PAD_LEFT - 6, PAD_TOP + 8);
    ctx.textAlign = 'left';
    ctx.fillText('输入', WIDTH - PAD_RIGHT - 4, HEIGHT - PAD_BOTTOM + 14);

    // 整形曲线
    const curve = sampleCurve(points);
    if (curve.length > 1) {
        ctx.beginPath();
        curve.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.strokeStyle = t.danger;
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // 控制点：首尾点固定输入电平(-1/+1)可拖输出，中间点输入+输出都可拖
    points.forEach((p, i) => {
        const selected = i === selectedIdx;
        const isEnd = i === 0 || i === points.length - 1;
        const x = inToX(p.x);
        const y = outToY(p.y);
        ctx.beginPath();
        ctx.arc(x, y, selected ? 7 : 5, 0, Math.PI * 2);
        ctx.fillStyle = isEnd ? t.tick : selected ? t.pointFill : t.danger;
        ctx.fill();
        ctx.strokeStyle = t.pointStroke;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        if (selected) {
            ctx.beginPath();
            ctx.arc(x, y, 11, 0, Math.PI * 2);
            ctx.strokeStyle = t.danger;
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

/** 失真波形整形曲线编辑器：横轴输入电平(-1~+1)，纵轴输出电平(-1~+1)，对角线为无失真参考，偏离对角线即产生削波失真 */
export const ShaperGraph: React.FC<ShaperGraphProps> = ({ points, onChange }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const dragRef = useRef<number | null>(null);
    const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
    const tokens = useThemeTokens();

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = WIDTH * dpr;
        canvas.height = HEIGHT * dpr;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.scale(dpr, dpr);
        draw(ctx, points, selectedIdx, tokens);
    }, [points, selectedIdx, tokens]);

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
            // 点击空白：插入新控制点（按输入电平排序）
            const nx = clamp(xToIn(point.x), IN_MIN, IN_MAX);
            const ny = clamp(yToOut(point.y), OUT_MIN, OUT_MAX);
            const next = [...points, { x: nx, y: ny }].sort((a, b) => a.x - b.x);
            idx = next.findIndex((p) => p.x === nx && p.y === ny);
            onChange(next);
        }
        setSelectedIdx(idx);
        dragRef.current = idx; // 首尾点也进入拖动（但只改输出电平），中间点改输入+输出
        canvas.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const idx = dragRef.current;
        if (idx === null) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const point = toCanvasPoint(canvas, e.clientX, e.clientY);
        const isEnd = idx === 0 || idx === points.length - 1;
        const ny = clamp(yToOut(point.y), OUT_MIN, OUT_MAX);
        // 首尾点固定输入电平(-1/+1)，中间点输入电平可拖
        const nx = isEnd ? points[idx].x : clamp(xToIn(point.x), IN_MIN, IN_MAX);
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
        if (hit === 0 || hit === points.length - 1) return; // 首尾端点不可删
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
            <p className="eq-hint">横轴输入电平 / 纵轴输出电平 · 曲线偏离对角线即失真 · 点击加点 · 双击删除中间点</p>
        </div>
    );
};
