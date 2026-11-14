import React, { useRef, useEffect, useCallback, useState } from 'react';
import { EqBandData, EqBandType } from '../../types/audio';
import { computeEqResponse } from '../../utils/eqResponse';
import { createEqBand } from '../../utils/audioUtils';
import { themeColor, useThemeTokens, type ThemeTokens } from '../../utils/theme';

interface EqGraphProps {
    bands: EqBandData[];
    onChange: (bands: EqBandData[]) => void;
}

const BAND_TYPES: { value: EqBandType; label: string }[] = [
    { value: 'lowpass', label: '低通' },
    { value: 'highpass', label: '高通' },
    { value: 'bandpass', label: '带通' },
    { value: 'notch', label: '陷波' },
    { value: 'peaking', label: '峰值' },
    { value: 'lowshelf', label: '低架' },
    { value: 'highshelf', label: '高架' },
];

/** 增益有效的滤波器类型 */
const hasGain = (type: EqBandType) => type === 'peaking' || type === 'lowshelf' || type === 'highshelf';

const FREQ_MIN = 20;
const FREQ_MAX = 20000;
const GAIN_MIN = -24;
const GAIN_MAX = 24;
const SAMPLE_RATE = 44100;
const WIDTH = 520;
const HEIGHT = 200;
const PAD = 26;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const freqToX = (freq: number) => PAD + (Math.log(freq / FREQ_MIN) / Math.log(FREQ_MAX / FREQ_MIN)) * (WIDTH - 2 * PAD);
const xToFreq = (x: number) => FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, (x - PAD) / (WIDTH - 2 * PAD));
const gainToY = (gain: number) => PAD + (1 - (gain - GAIN_MIN) / (GAIN_MAX - GAIN_MIN)) * (HEIGHT - 2 * PAD);
const yToGain = (y: number) => GAIN_MIN + (1 - (y - PAD) / (HEIGHT - 2 * PAD)) * (GAIN_MAX - GAIN_MIN);

const formatFreq = (freq: number) => (freq >= 1000 ? `${(freq / 1000).toFixed(freq % 1000 ? 1 : 0)}k` : `${Math.round(freq)}`) + 'Hz';

const draw = (ctx: CanvasRenderingContext2D, bands: EqBandData[], selectedId: string | null, t: ThemeTokens) => {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = t.canvas;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // 水平 dB 网格线
    ctx.font = '10px monospace';
    for (let g = GAIN_MIN; g <= GAIN_MAX; g += 6) {
        const y = gainToY(g);
        ctx.strokeStyle = g === 0 ? t.grid : t.gridSoft;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PAD, y);
        ctx.lineTo(WIDTH - PAD, y);
        ctx.stroke();
        ctx.fillStyle = t.tick;
        ctx.textAlign = 'right';
        ctx.fillText(`${g}`, PAD - 4, y + 3);
    }

    // 垂直频率网格线
    [30, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].forEach((f) => {
        const x = freqToX(f);
        ctx.strokeStyle = t.gridSoft;
        ctx.beginPath();
        ctx.moveTo(x, PAD);
        ctx.lineTo(x, HEIGHT - PAD);
        ctx.stroke();
        ctx.fillStyle = t.tick;
        ctx.textAlign = 'center';
        ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x, HEIGHT - 6);
    });

    // 频率响应曲线
    const N = 220;
    const freqs = Array.from({ length: N }, (_, i) => FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, i / (N - 1)));
    const response = computeEqResponse(bands, SAMPLE_RATE, freqs);

    ctx.beginPath();
    freqs.forEach((f, i) => {
        const x = freqToX(f);
        const y = gainToY(clamp(response[i], GAIN_MIN, GAIN_MAX));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = t.accent;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.lineTo(WIDTH - PAD, gainToY(0));
    ctx.lineTo(PAD, gainToY(0));
    ctx.closePath();
    ctx.fillStyle = themeColor('--accent-soft', 'rgba(166, 255, 0, 0.12)');
    ctx.fill();

    // 频段控制点（gain 无效类型固定在 0dB 线上）
    bands.forEach((band) => {
        const selected = band.id === selectedId;
        const y = hasGain(band.type) ? gainToY(band.gain) : gainToY(0);
        const x = freqToX(band.freq);
        ctx.beginPath();
        ctx.arc(x, y, selected ? 7 : 5, 0, Math.PI * 2);
        ctx.fillStyle = selected ? t.pointFill : t.accent;
        ctx.fill();
        ctx.strokeStyle = t.pointStroke;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        if (selected) {
            ctx.beginPath();
            ctx.arc(x, y, 11, 0, Math.PI * 2);
            ctx.strokeStyle = t.accent;
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

/** 图形化均衡器：点击空白创建频点，拖动调频率/增益，滚轮调 Q，选中后可改类型/删除 */
export const EqGraph: React.FC<EqGraphProps> = ({ bands, onChange }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const dragRef = useRef<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const tokens = useThemeTokens();

    const selected = bands.find((b) => b.id === selectedId) ?? null;

    const patchBand = useCallback(
        (id: string, patch: Partial<EqBandData>) => onChange(bands.map((b) => (b.id === id ? { ...b, ...patch } : b))),
        [bands, onChange]
    );

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = WIDTH * dpr;
        canvas.height = HEIGHT * dpr;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.scale(dpr, dpr);
        draw(ctx, bands, selectedId, tokens);
    }, [bands, selectedId, tokens]);

    const hitBand = useCallback(
        (point: { x: number; y: number }) => {
            let nearest = '';
            let minDist = 24;
            bands.forEach((band) => {
                const y = hasGain(band.type) ? gainToY(band.gain) : gainToY(0);
                const d = Math.hypot(freqToX(band.freq) - point.x, y - point.y);
                if (d < minDist) {
                    minDist = d;
                    nearest = band.id;
                }
            });
            return nearest || null;
        },
        [bands]
    );

    const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const point = toCanvasPoint(canvas, e.clientX, e.clientY);
        const hit = hitBand(point);

        let id = hit;
        if (!id) {
            // 点击空白处：创建新频点
            const freq = Math.round(clamp(xToFreq(point.x), FREQ_MIN, FREQ_MAX));
            const gain = Math.round(clamp(yToGain(point.y), GAIN_MIN, GAIN_MAX) * 2) / 2;
            const band = createEqBand(freq, gain);
            onChange([...bands, band]);
            id = band.id;
        }
        setSelectedId(id);
        dragRef.current = id;
        canvas.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const id = dragRef.current;
        if (!id) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const point = toCanvasPoint(canvas, e.clientX, e.clientY);
        const band = bands.find((b) => b.id === id);
        if (!band) return;
        const freq = Math.round(clamp(xToFreq(point.x), FREQ_MIN, FREQ_MAX));
        const patch: Partial<EqBandData> = { freq };
        if (hasGain(band.type)) patch.gain = Math.round(clamp(yToGain(point.y), GAIN_MIN, GAIN_MAX) * 2) / 2;
        patchBand(id, patch);
    };

    const onPointerUp = () => {
        dragRef.current = null;
    };

    const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const hit = hitBand(toCanvasPoint(canvas, e.clientX, e.clientY));
        if (hit) {
            onChange(bands.filter((b) => b.id !== hit));
            if (selectedId === hit) setSelectedId(null);
        }
    };

    const onWheel = useCallback(
        (e: WheelEvent) => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            const hit = hitBand(toCanvasPoint(canvas, e.clientX, e.clientY));
            if (!hit) return;
            const band = bands.find((b) => b.id === hit);
            if (!band) return;
            const q = clamp(Math.round((band.q + (e.deltaY < 0 ? 0.5 : -0.5)) * 10) / 10, 0.1, 40);
            patchBand(hit, { q });
        },
        [hitBand, bands, patchBand]
    );

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const handler = (e: WheelEvent) => {
            e.preventDefault();
            onWheel(e);
        };
        canvas.addEventListener('wheel', handler, { passive: false });
        return () => canvas.removeEventListener('wheel', handler);
    }, [onWheel]);

    return (
        <div className="eq-graph">
            <canvas
                ref={canvasRef}
                style={{ width: '100%', height: 'auto', display: 'block', cursor: 'crosshair', touchAction: 'none' }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onDoubleClick={onDoubleClick}
            />
            <p className="eq-hint">点击空白添加频点 · 拖动调频率/增益 · 滚轮调 Q · 双击删除</p>

            {selected && (
                <div className="eq-panel">
                    <select
                        className="eq-type"
                        value={selected.type}
                        onChange={(e) => patchBand(selected.id, { type: e.target.value as EqBandType })}
                    >
                        {BAND_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>
                                {t.label}
                            </option>
                        ))}
                    </select>

                    <label className="eq-field">
                        <span>频率 {formatFreq(selected.freq)}</span>
                        <input
                            type="range"
                            min={0}
                            max={1000}
                            value={(Math.log(selected.freq / FREQ_MIN) / Math.log(FREQ_MAX / FREQ_MIN)) * 1000}
                            onChange={(e) =>
                                patchBand(selected.id, {
                                    freq: Math.round(FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, Number(e.target.value) / 1000)),
                                })
                            }
                        />
                    </label>

                    {hasGain(selected.type) && (
                        <label className="eq-field">
                            <span>增益 {selected.gain}dB</span>
                            <input
                                type="range"
                                min={GAIN_MIN}
                                max={GAIN_MAX}
                                step={0.5}
                                value={selected.gain}
                                onChange={(e) => patchBand(selected.id, { gain: Number(e.target.value) })}
                            />
                        </label>
                    )}

                    <label className="eq-field">
                        <span>Q {selected.q.toFixed(1)}</span>
                        <input
                            type="range"
                            min={0.1}
                            max={40}
                            step={0.1}
                            value={selected.q}
                            onChange={(e) => patchBand(selected.id, { q: Number(e.target.value) })}
                        />
                    </label>

                    <button
                        className="eq-delete"
                        onClick={() => {
                            onChange(bands.filter((b) => b.id !== selected.id));
                            setSelectedId(null);
                        }}
                        title="删除该频点"
                    >
                        删除
                    </button>
                </div>
            )}
        </div>
    );
};
