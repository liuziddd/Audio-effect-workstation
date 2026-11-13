import React, { useRef, useEffect } from 'react';
import { useThemeTokens, type ThemeTokens } from '../../utils/theme';

interface DynamicsGraphProps {
    /** 阈值 dB */
    threshold: number;
    /** 压缩比 :1 */
    ratio: number;
    /** 拐点宽度 dB */
    knee: number;
    color?: string;
}

const WIDTH = 520;
const HEIGHT = 200;
const PAD = 28;
const DB_MIN = -60;
const DB_MAX = 0;

const dbToX = (db: number) => PAD + ((db - DB_MIN) / (DB_MAX - DB_MIN)) * (WIDTH - 2 * PAD);
const dbToY = (db: number) => PAD + ((DB_MAX - db) / (DB_MAX - DB_MIN)) * (HEIGHT - 2 * PAD);

/** 压缩静态响应：输入 dB → 输出 dB（含软拐点） */
const response = (input: number, threshold: number, ratio: number, knee: number) => {
    if (knee <= 0) {
        return input < threshold ? input : threshold + (input - threshold) / ratio;
    }
    const half = knee / 2;
    if (input < threshold - half) return input;
    if (input > threshold + half) return threshold + (input - threshold) / ratio;
    const x = input - threshold;
    return input + (1 / ratio - 1) * ((x + half) * (x + half)) / (2 * knee);
};

const draw = (
    ctx: CanvasRenderingContext2D,
    threshold: number,
    ratio: number,
    knee: number,
    color: string,
    t: ThemeTokens
) => {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = t.canvas;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.font = '10px monospace';
    ctx.lineWidth = 1;
    // 网格
    for (let db = DB_MIN; db <= DB_MAX; db += 10) {
        ctx.strokeStyle = db === 0 ? t.grid : t.gridSoft;
        ctx.beginPath();
        ctx.moveTo(PAD, dbToY(db));
        ctx.lineTo(WIDTH - PAD, dbToY(db));
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(dbToX(db), PAD);
        ctx.lineTo(dbToX(db), HEIGHT - PAD);
        ctx.stroke();
        ctx.fillStyle = t.tick;
        ctx.textAlign = 'right';
        ctx.fillText(`${db}`, PAD - 4, dbToY(db) + 3);
        ctx.textAlign = 'center';
        ctx.fillText(`${db}`, dbToX(db), HEIGHT - 6);
    }

    // 对角线（无压缩参考）
    ctx.strokeStyle = t.grid;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(dbToX(DB_MIN), dbToY(DB_MIN));
    ctx.lineTo(dbToX(DB_MAX), dbToY(DB_MAX));
    ctx.stroke();
    ctx.setLineDash([]);

    // 压缩响应曲线
    const N = 200;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
        const input = DB_MIN + ((DB_MAX - DB_MIN) * i) / N;
        const output = response(input, threshold, ratio, knee);
        const x = dbToX(input);
        const y = dbToY(Math.max(output, DB_MIN));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    // 阈值标记线
    const tx = dbToX(threshold);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(tx, PAD);
    ctx.lineTo(tx, HEIGHT - PAD);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
};

/** 压缩/限制曲线可视化（输入 dB → 输出 dB，含软拐点） */
export const DynamicsGraph: React.FC<DynamicsGraphProps> = ({ threshold, ratio, knee, color = '#9CA3AF' }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
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
        draw(ctx, threshold, ratio, knee, color, tokens);
    }, [threshold, ratio, knee, color, tokens]);

    return (
        <div className="dynamics-graph">
            <canvas
                ref={canvasRef}
                style={{ width: '100%', height: 'auto', display: 'block' }}
            />
        </div>
    );
};
