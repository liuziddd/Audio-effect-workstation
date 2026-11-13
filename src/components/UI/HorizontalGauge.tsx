import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import './HorizontalGauge.css';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const H = 1 / 120;
const DT_MAX = 0.05;
const TILT_GAIN = 0.07;
const TILT_MAX = 30;
const REST_POS = 0.05;
const REST_VEL = 2;

interface HorizontalGaugeProps {
    /** 液位 0~100（受控） */
    value?: number;
    defaultValue?: number;
    onChange?: (value: number) => void;
    liquidColor?: string;
    glassColor?: string;
    width?: number;
    height?: number;
    radius?: number;
    viscosity?: number;
    tilt?: number;
    splash?: number;
    ariaLabel?: string;
}

interface Grip {
    id: number;
    grab: number | null;
    sent: number;
}

/** 横版液体 gauge：液体从左到右填充，液面（右缘）随速度倾斜，带弹簧-阻尼回弹 */
export const HorizontalGauge = ({
    value,
    defaultValue = 50,
    onChange,
    liquidColor = '#2450FF',
    glassColor = 'rgba(255, 255, 255, 0.06)',
    width = 200,
    height = 16,
    radius = 8,
    viscosity = 0.15,
    tilt = 0.45,
    splash = 0.42,
    ariaLabel = '音量',
}: HorizontalGaugeProps) => {
    const root = useRef<HTMLDivElement>(null);
    const liquid = useRef<HTMLDivElement>(null);
    const marker = useRef<HTMLDivElement>(null);
    const start = clamp(value ?? defaultValue, 0, 100);
    const sim = useRef({ x: start, v: 0, L: start, raf: 0, last: 0 });
    const grip = useRef<Grip | null>(null);
    const reduce = useRef(false);
    const [held, setHeld] = useState(false);
    const live = useRef({ viscosity, tilt, splash, value, onChange, width, height });
    live.current = { viscosity, tilt, splash, value, onChange, width, height };

    const paint = () => {
        const { x, v } = sim.current;
        const { tilt: t, width: W } = live.current;
        const th = reduce.current ? 0 : clamp(t * v * TILT_GAIN, -TILT_MAX, TILT_MAX);
        const lean = (Math.tan((th * Math.PI) / 180) * W) / 2;
        if (liquid.current) {
            liquid.current.style.clipPath = `polygon(0 0, calc(${x}% + ${lean}px) 0, calc(${x}% - ${lean}px) 100%, 0 100%)`;
        }
        if (marker.current) marker.current.style.transform = `translateX(${(sim.current.L * W) / 100}px)`;
    };

    const tick = (now: number) => {
        const s = sim.current;
        const { viscosity: vis, splash: give } = live.current;
        const dt = s.last ? Math.min((now - s.last) / 1000, DT_MAX) : H;
        s.last = now;
        if (vis <= 0) {
            s.x = s.L;
            s.v = 0;
        } else {
            const k = 1224 - 1044 * vis;
            const zeta = reduce.current ? 1 : 0.26 - 0.17 * vis;
            const c = 2 * zeta * Math.sqrt(k);
            const rest = reduce.current ? 0 : give;
            for (let n = Math.ceil(dt / H), h = dt / n; n > 0; n -= 1) {
                s.v = s.v * Math.exp(-c * h) + k * (s.L - s.x) * h;
                s.x += s.v * h;
                if (s.x > 100) {
                    s.x = 100;
                    s.v = -s.v * rest;
                } else if (s.x < 0) {
                    s.x = 0;
                    s.v = -s.v * rest;
                }
            }
            if (!grip.current && Math.abs(s.L - s.x) < REST_POS && Math.abs(s.v) < REST_VEL) {
                s.x = s.L;
                s.v = 0;
            }
        }
        paint();
        const parked = !grip.current && s.x === s.L && s.v === 0;
        if (parked) {
            s.raf = 0;
            s.last = 0;
        } else {
            s.raf = requestAnimationFrame(tick);
        }
    };

    const wake = () => {
        if (!sim.current.raf) sim.current.raf = requestAnimationFrame(tick);
    };

    const setLevel = (L: number, instant?: boolean) => {
        const s = sim.current;
        s.L = clamp(L, 0, 100);
        if (instant) {
            s.x = s.L;
            s.v = 0;
        }
        wake();
    };

    useLayoutEffect(() => {
        if (value === undefined) return;
        if (grip.current && Math.round(sim.current.L) === value) return;
        setLevel(value, false);
    }, [value]);

    useLayoutEffect(() => {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        const sync = () => {
            reduce.current = mq.matches;
        };
        sync();
        mq.addEventListener('change', sync);
        paint();
        const s = sim.current;
        return () => {
            mq.removeEventListener('change', sync);
            cancelAnimationFrame(s.raf);
            s.raf = 0;
            s.last = 0;
        };
    }, []);

    useEffect(() => {
        paint();
    }, [width, height, tilt]);

    const levelAt = (clientX: number) => {
        const el = root.current;
        if (!el) return 0;
        const rect = el.getBoundingClientRect();
        return ((clientX - rect.left) / rect.width) * 100;
    };

    const report = () => {
        const g = grip.current;
        const n = Math.round(sim.current.L);
        if (g && n !== g.sent) {
            g.sent = n;
            live.current.onChange?.(n);
        }
    };

    const down = (e: React.PointerEvent) => {
        if (grip.current || e.button !== 0) return;
        grip.current = { id: e.pointerId, grab: null, sent: NaN };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setHeld(true);
        setLevel(levelAt(e.clientX));
        report();
    };

    const move = (e: React.PointerEvent) => {
        const g = grip.current;
        if (!g || g.id !== e.pointerId) return;
        const at = levelAt(e.clientX);
        if (g.grab === null) {
            g.grab = sim.current.L - at;
            return;
        }
        setLevel(at + (g.grab ?? 0));
        report();
    };

    const up = (e: React.PointerEvent) => {
        const g = grip.current;
        if (!g || g.id !== e.pointerId) return;
        grip.current = null;
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        setHeld(false);
        wake();
    };

    const r = Math.min(radius, width / 2, height / 2);

    return (
        <div
            ref={root}
            className="horizontal-gauge"
            role="slider"
            tabIndex={0}
            aria-label={ariaLabel}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(start)}
            aria-orientation="horizontal"
            data-held={held ? 'true' : 'false'}
            style={
                {
                    '--hg-w': `${width}px`,
                    '--hg-h': `${height}px`,
                    '--hg-r': `${r}px`,
                    '--hg-glass': glassColor,
                    '--hg-liquid': liquidColor,
                } as React.CSSProperties
            }
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onKeyDown={(e) => {
                const d = e.shiftKey ? 10 : 2;
                const next: number | undefined = ({
                    ArrowUp: sim.current.L + d,
                    ArrowRight: sim.current.L + d,
                    ArrowDown: sim.current.L - d,
                    ArrowLeft: sim.current.L - d,
                    Home: 0,
                    End: 100,
                } as Record<string, number>)[e.key];
                if (next === undefined) return;
                e.preventDefault();
                setLevel(next, true);
                live.current.onChange?.(Math.round(sim.current.L));
            }}
        >
            <div ref={liquid} className="horizontal-gauge__liquid" aria-hidden="true" />
            <div ref={marker} className="horizontal-gauge__marker" aria-hidden="true" />
        </div>
    );
};
