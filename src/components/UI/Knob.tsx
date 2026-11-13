import React, { useCallback, useEffect, useRef } from 'react';

interface KnobProps {
    value: number;
    min: number;
    max: number;
    step?: number;
    defaultValue?: number;
    onChange: (value: number) => void;
    label?: string;
    unit?: string;
    color?: string;
    size?: number;
}

const START = -135;
const END = 135;
const SPAN = END - START;

const polar = (cx: number, cy: number, r: number, deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
};

const arc = (cx: number, cy: number, r: number, start: number, end: number) => {
    const s = polar(cx, cy, r, end);
    const e = polar(cx, cy, r, start);
    const large = end - start <= 180 ? 0 : 1;
    return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 0 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const format = (val: number, step: number) => {
    if (Math.abs(val) >= 1000) return (val / 1000).toFixed(1) + 'k';
    if (step >= 1) return Math.round(val).toString();
    if (step >= 0.1) return val.toFixed(1);
    return step >= 0.01 ? val.toFixed(2) : val.toFixed(3);
};

/** 可视化旋钮：外围弧形光柱显示当前值，箭标指向光柱，支持拖拽/滚轮/双击重置 */
export const Knob: React.FC<KnobProps> = ({
    value,
    min,
    max,
    step = 0.01,
    defaultValue,
    onChange,
    label,
    unit = '',
    color = '#2450FF',
    size = 44,
}) => {
    const drag = useRef<{ startY: number; startValue: number } | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);

    const stepRound = useCallback((v: number) => Math.round(v / step) * step, [step]);

    const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { startY: e.clientY, startValue: value };
    }, [value]);

    const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (!drag.current) return;
        const dy = drag.current.startY - e.clientY;
        const sensitivity = (max - min) / 200;
        onChange(clamp(stepRound(drag.current.startValue + dy * sensitivity), min, max));
    }, [max, min, onChange, stepRound]);

    const onPointerUp = useCallback(() => {
        drag.current = null;
    }, []);

    useEffect(() => {
        const el = rootRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const amount = (max - min) * 0.01 * (e.shiftKey ? 0.1 : 1);
            onChange(clamp(stepRound(value + (e.deltaY < 0 ? amount : -amount)), min, max));
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [value, min, max, onChange, stepRound]);

    const normalized = (value - min) / (max - min);
    const angle = START + normalized * SPAN;
    const cx = 50;
    const cy = 50;
    const arcR = 42;
    const knobR = 27;

    return (
        <div
            ref={rootRef}
            className="knob"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue)}
        >
            <svg viewBox="0 0 100 100" width={size} height={size}>
                {/* 外围光柱底环 */}
                <path d={arc(cx, cy, arcR, START, END)} stroke="var(--surface-3)" strokeWidth={6} fill="none" strokeLinecap="round" />
                {/* 当前值光柱 */}
                {value > min && (
                    <path
                        d={arc(cx, cy, arcR, START, angle)}
                        stroke={color}
                        strokeWidth={6}
                        fill="none"
                        strokeLinecap="round"
                        style={{ filter: `drop-shadow(0 0 5px ${color})` }}
                    />
                )}
                {/* 旋钮盘 */}
                <circle cx={cx} cy={cy} r={knobR} fill="var(--surface-2)" stroke="var(--surface-2)" strokeWidth={1.5} />
                <circle cx={cx} cy={cy} r={knobR * 0.68} fill="var(--surface-2)" stroke="var(--surface-3)" strokeWidth={1} />
                {/* 箭标 */}
                <g transform={`rotate(${angle} ${cx} ${cy})`}>
                    <line x1={cx} y1={cy - knobR * 0.55} x2={cx} y2={cy - knobR + 3} stroke={color} strokeWidth={2.5} strokeLinecap="round" />
                </g>
            </svg>
            {label && <span className="knob-label">{label}</span>}
            <span className="knob-value">{format(value, step)}{unit}</span>
        </div>
    );
};
