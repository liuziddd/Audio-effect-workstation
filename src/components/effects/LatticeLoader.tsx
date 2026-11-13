import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import './LatticeLoader.css';

/** AI 音轨分离进度动效：3×3 圆点环形跑马灯 + 完成标记 + 计时 */
const ORBIT = [0, 1, 2, 7, null, 3, 6, 5, 4];
const DONE_MARK = [2, 3, 5, 7];

const fmt = (ds: number) =>
    ds < 600 ? `${(ds / 10).toFixed(1)}s` : `${Math.floor(ds / 600)}m ${((ds % 600) / 10).toFixed(1)}s`;

interface LatticeLoaderProps {
    status: 'working' | 'done';
    label: string;
    doneLabel: string;
    color: string;
    doneColor: string;
}

export default function LatticeLoader({ status, label, doneLabel, color, doneColor }: LatticeLoaderProps) {
    const timerRef = useRef<HTMLSpanElement>(null);
    const dsRef = useRef(0);

    const paint = (ds: number) => {
        dsRef.current = ds;
        if (timerRef.current) timerRef.current.textContent = fmt(ds);
    };

    useLayoutEffect(() => {
        if (status !== 'working') return;
        const startedAt = performance.now();
        paint(0);
        const id = setInterval(() => paint(Math.floor((performance.now() - startedAt) / 100)), 100);
        return () => clearInterval(id);
    }, [status]);

    const [announce, setAnnounce] = useState(`${label}, in progress`);
    useEffect(() => {
        setAnnounce(status === 'working' ? `${label}, in progress` : `${doneLabel} ${fmt(dsRef.current)}`);
    }, [status, label, doneLabel]);

    const style = {
        '--ll-color': color,
        '--ll-mark': doneColor,
        '--ll-glow': color,
        '--ll-mark-glow': doneColor,
    } as React.CSSProperties;

    return (
        <span className="lattice-loader" data-status={status} style={style}>
            <span className="lattice-loader__grid" aria-hidden="true">
                <span className="lattice-loader__layer lattice-loader__run">
                    {ORBIT.map((unit, i) => (
                        <span
                            key={i}
                            className="lattice-loader__cell"
                            data-hole={unit == null ? '' : undefined}
                            style={unit == null ? undefined : { animationDelay: `${unit * 90}ms` }}
                        />
                    ))}
                </span>
                <span className="lattice-loader__layer lattice-loader__mark">
                    {ORBIT.map((_, i) => (
                        <span key={i} className="lattice-loader__cell" data-on={DONE_MARK.includes(i) ? '' : undefined} />
                    ))}
                </span>
            </span>
            <span className="lattice-loader__label" aria-hidden="true">
                <span className="lattice-loader__text" data-active={status === 'working' ? '' : undefined}>{label}</span>
                <span className="lattice-loader__text" data-active={status === 'done' ? '' : undefined}>{doneLabel}</span>
            </span>
            <span ref={timerRef} className="lattice-loader__timer" aria-hidden="true">0.0s</span>
            <span className="lattice-loader__sr">{announce}</span>
        </span>
    );
}
