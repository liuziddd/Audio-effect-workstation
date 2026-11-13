import { useEffect, useRef, useState } from 'react';
import { animate, motion, useMotionValue, useReducedMotion, useSpring, useTransform, useVelocity } from 'framer-motion';
import './ThemeToggle.css';

interface ThemeToggleProps {
    /** true = 亮色，false = 暗色 */
    checked: boolean;
    onChange: (checked: boolean) => void;
    ariaLabel?: string;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const FLOW_SPRING = { stiffness: 320, damping: 40, mass: 0.6 };
const SWELL_SPRING = { stiffness: 520, damping: 34, mass: 0.6 };
const MAX_STRETCH = 0.4;
const STRETCH_SPEED = 600;
const TAP_SLOP = { fine: 4, coarse: 8 };

interface Grip {
    id: number;
    grab: number | null;
    moved: boolean;
    startX: number;
    onAtPress: boolean;
    slop: number;
}

/** 弹性主题切换开关：捏压拉伸 + 弹簧回弹 */
export const ThemeToggle = ({ checked, onChange, ariaLabel = '切换主题' }: ThemeToggleProps) => {
    const reduce = useReducedMotion();
    const width = 76;
    const height = 38;
    const radius = 19;
    const inset = Math.max(3, Math.round(height * 0.11));
    const thumb = height - inset * 2;
    const min = inset;
    const max = width - inset - thumb;
    const mid = (min + max) / 2;
    const trackRadius = Math.min(radius, height / 2);
    const thumbRadius = Math.max(2, trackRadius - inset);

    const on = checked;
    const [dragging, setDragging] = useState(false);
    const trackRef = useRef<HTMLButtonElement>(null);
    const grip = useRef<Grip | null>(null);
    const onRef = useRef(on);
    onRef.current = on;
    const skipClick = useRef(false);

    const x = useMotionValue(on ? max : min);
    const flow = useSpring(useVelocity(x), FLOW_SPRING);
    const swell = useSpring(1, SWELL_SPRING);
    const gain = reduce ? 0 : 0.36; // stretch ≈ 36
    const stretchOf = (v: number) => 1 + Math.min(MAX_STRETCH, Math.abs(v) / STRETCH_SPEED) * gain;
    const scaleX = useTransform([flow, swell], (latest: number[]) => stretchOf(latest[0]) * latest[1]);
    const scaleY = useTransform([flow, swell], (latest: number[]) => latest[1] / stretchOf(latest[0]));

    const commit = (next: boolean) => {
        if (next === onRef.current) return;
        onRef.current = next;
        onChange(next);
    };

    useEffect(() => {
        if (dragging) return;
        const target = on ? max : min;
        if (reduce) {
            x.jump(target);
            return;
        }
        const controls = animate(x, target, {
            type: 'spring',
            stiffness: 170,
            damping: 21.5,
            mass: 0.9,
            restDelta: 0.001,
            restSpeed: 0.01,
        });
        return () => controls.stop();
    }, [on, dragging, min, max, reduce, x]);

    const localX = (clientX: number) => {
        const el = trackRef.current;
        if (!el) return 0;
        return clientX - el.getBoundingClientRect().left;
    };

    const down = (e: React.PointerEvent) => {
        if (grip.current || e.button !== 0) return;
        grip.current = {
            id: e.pointerId,
            grab: null,
            moved: false,
            startX: e.clientX,
            onAtPress: onRef.current,
            slop: e.pointerType === 'touch' ? TAP_SLOP.coarse : TAP_SLOP.fine,
        };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setDragging(true);
    };

    const move = (e: React.PointerEvent) => {
        const g = grip.current;
        if (!g || g.id !== e.pointerId) return;
        const lx = localX(e.clientX);
        if (g.grab === null) {
            g.grab = lx - x.get();
            return;
        }
        if (!g.moved && Math.abs(e.clientX - g.startX) > g.slop) g.moved = true;
        if (!g.moved) return;
        const nx = clamp(lx - g.grab, min, max);
        x.set(nx);
        commit(nx > mid);
    };

    const up = (e: React.PointerEvent, cancelled: boolean) => {
        const g = grip.current;
        if (!g || g.id !== e.pointerId) return;
        grip.current = null;
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        if (cancelled) commit(g.onAtPress);
        else if (!g.moved) commit(!onRef.current);
        skipClick.current = true;
        setTimeout(() => {
            skipClick.current = false;
        }, 0);
        setDragging(false);
    };

    const click = () => {
        if (skipClick.current) {
            skipClick.current = false;
            return;
        }
        commit(!onRef.current);
    };

    return (
        <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={ariaLabel}
            className="theme-toggle"
            data-on={on ? '' : undefined}
            data-held={dragging ? '' : undefined}
            style={
                {
                    '--ss-w': `${width}px`,
                    '--ss-h': `${height}px`,
                    '--ss-inset': `${inset}px`,
                    '--ss-thumb': `${thumb}px`,
                    '--ss-r': `${trackRadius}px`,
                    '--ss-thumb-r': `${thumbRadius}px`,
                } as React.CSSProperties
            }
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={(e) => up(e, false)}
            onPointerCancel={(e) => up(e, true)}
            onPointerEnter={(e) => {
                if (e.pointerType === 'mouse') swell.set(1.035);
            }}
            onPointerLeave={() => swell.set(1)}
            onClick={click}
        >
            <span ref={trackRef as React.RefObject<HTMLButtonElement>} className="theme-toggle__track">
                <motion.span className="theme-toggle__thumb" aria-hidden="true" style={{ x, scaleX, scaleY }} />
            </span>
        </button>
    );
};
