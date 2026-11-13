import { useEffect, useRef } from 'react';

interface WaveBackgroundProps {
    /** 等值线条数 */
    levels?: number;
    /** 波动速度 */
    speed?: number;
}

/** 缓慢漂移的标量场「峰」，用有理核叠加产生密集的嵌套闭合等高线 */
const BLOBS = [
    { x: 0.10, y: 0.12, r: 0.13, a: 1.20, sx: 0.11, sy: 0.08, p: 0.0 },
    { x: 0.30, y: 0.10, r: 0.11, a: 1.00, sx: 0.09, sy: 0.12, p: 1.7 },
    { x: 0.50, y: 0.16, r: 0.14, a: 1.30, sx: 0.07, sy: 0.09, p: 3.1 },
    { x: 0.72, y: 0.11, r: 0.12, a: 1.15, sx: 0.08, sy: 0.06, p: 4.6 },
    { x: 0.90, y: 0.22, r: 0.15, a: 1.35, sx: 0.12, sy: 0.07, p: 2.3 },
    { x: 0.18, y: 0.36, r: 0.16, a: 1.40, sx: 0.06, sy: 0.10, p: 5.4 },
    { x: 0.40, y: 0.34, r: 0.09, a: 0.95, sx: 0.10, sy: 0.08, p: 0.9 },
    { x: 0.62, y: 0.38, r: 0.13, a: 1.25, sx: 0.09, sy: 0.11, p: 3.8 },
    { x: 0.85, y: 0.44, r: 0.11, a: 1.10, sx: 0.14, sy: 0.13, p: 2.9 },
    { x: 0.08, y: 0.60, r: 0.13, a: 1.20, sx: 0.13, sy: 0.09, p: 4.2 },
    { x: 0.28, y: 0.62, r: 0.15, a: 1.35, sx: 0.11, sy: 0.08, p: 1.2 },
    { x: 0.52, y: 0.60, r: 0.10, a: 1.00, sx: 0.09, sy: 0.12, p: 5.0 },
    { x: 0.74, y: 0.66, r: 0.14, a: 1.30, sx: 0.07, sy: 0.09, p: 2.1 },
    { x: 0.93, y: 0.72, r: 0.12, a: 1.15, sx: 0.08, sy: 0.06, p: 3.5 },
    { x: 0.16, y: 0.86, r: 0.14, a: 1.25, sx: 0.12, sy: 0.07, p: 0.5 },
    { x: 0.40, y: 0.86, r: 0.11, a: 1.05, sx: 0.06, sy: 0.10, p: 4.9 },
    { x: 0.62, y: 0.88, r: 0.15, a: 1.35, sx: 0.10, sy: 0.08, p: 2.7 },
    { x: 0.84, y: 0.92, r: 0.12, a: 1.15, sx: 0.09, sy: 0.11, p: 1.4 },
];

const CELL = 16;
const FRAME_MS = 40; // 25fps
type Pt = [number, number];

/** 端点量化成整数 key，用于把离散线段串成连续轮廓 */
const keyOf = (x: number, y: number) => Math.round(x * 64) * 100000 + Math.round(y * 64);

/** 编辑页背景：实时波动的拓扑等高线（marching squares + 轮廓串接 + 中点二次贝塞尔平滑） */
export const WaveBackground = ({ levels = 22, speed = 0.19 }: WaveBackgroundProps) => {
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

        const field = (nx: number, ny: number, t: number) => {
            let v = 0;
            for (let i = 0; i < BLOBS.length; i++) {
                const b = BLOBS[i];
                const cx = b.x + 0.11 * Math.sin(t * b.sx + b.p);
                const cy = b.y + 0.11 * Math.cos(t * b.sy + b.p * 1.3);
                const dx = (nx - cx) / b.r;
                const dy = (ny - cy) / (b.r * 0.82);
                v += b.a / (1 + dx * dx + dy * dy);
            }
            // 低频鞍形扰动让环彼此挤压、拉伸，形成流线而非规整圆形
            v += 0.34 * Math.sin(nx * 7.5 + t * 0.55) * Math.cos(ny * 6.2 - t * 0.42);
            v += 0.18 * Math.sin((nx + ny) * 10.5 - t * 0.31);
            return v;
        };

        /** 中点二次贝塞尔：每个折点当控制点，落点取相邻两点中点，折角被抹成圆滑过渡 */
        const strokeChain = (pts: Pt[]) => {
            const n = pts.length;
            if (n < 2) return;
            const closed = keyOf(pts[0][0], pts[0][1]) === keyOf(pts[n - 1][0], pts[n - 1][1]);
            if (closed && n > 3) {
                const loop = pts.slice(0, -1);
                const m = loop.length;
                ctx.moveTo((loop[m - 1][0] + loop[0][0]) / 2, (loop[m - 1][1] + loop[0][1]) / 2);
                for (let i = 0; i < m; i++) {
                    const cur = loop[i];
                    const next = loop[(i + 1) % m];
                    ctx.quadraticCurveTo(cur[0], cur[1], (cur[0] + next[0]) / 2, (cur[1] + next[1]) / 2);
                }
            } else {
                ctx.moveTo(pts[0][0], pts[0][1]);
                for (let i = 1; i < n - 1; i++) {
                    ctx.quadraticCurveTo(
                        pts[i][0], pts[i][1],
                        (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2,
                    );
                }
                ctx.lineTo(pts[n - 1][0], pts[n - 1][1]);
            }
        };

        const draw = (now: number) => {
            raf = requestAnimationFrame(draw);
            if (now - lastFrame < FRAME_MS) return;
            lastFrame = now;
            const t = now * 0.001 * speed;

            for (let j = 0; j < rows; j++) {
                const ny = (j * CELL) / h;
                for (let i = 0; i < cols; i++) {
                    grid[j * cols + i] = field((i * CELL) / w, ny, t);
                }
            }

            ctx.clearRect(0, 0, w, h);
            const light = document.documentElement.classList.contains('light');
            ctx.strokeStyle = light ? 'rgba(72, 78, 90, 0.42)' : 'rgba(186, 192, 204, 0.48)';
            ctx.lineWidth = 1.2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();

            for (let l = 1; l <= levels; l++) {
                const L = 0.55 + l * 0.16;
                // 扁平存每段 [ax, ay, bx, by]
                const segs: number[] = [];
                const ends = new Map<number, number[]>();
                const addSeg = (p: Pt, q: Pt) => {
                    const idx = segs.length;
                    segs.push(p[0], p[1], q[0], q[1]);
                    const ka = keyOf(p[0], p[1]);
                    const kb = keyOf(q[0], q[1]);
                    const la = ends.get(ka);
                    if (la) la.push(idx); else ends.set(ka, [idx]);
                    const lb = ends.get(kb);
                    if (lb) lb.push(idx); else ends.set(kb, [idx]);
                };

                for (let j = 0; j < rows - 1; j++) {
                    for (let i = 0; i < cols - 1; i++) {
                        const a = grid[j * cols + i];
                        const b = grid[j * cols + i + 1];
                        const c = grid[(j + 1) * cols + i + 1];
                        const d = grid[(j + 1) * cols + i];
                        const code = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (c > L ? 2 : 0) | (d > L ? 1 : 0);
                        if (code === 0 || code === 15) continue;

                        const x = i * CELL;
                        const y = j * CELL;
                        const top: Pt = [x + ((L - a) / (b - a || 1)) * CELL, y];
                        const right: Pt = [x + CELL, y + ((L - b) / (c - b || 1)) * CELL];
                        const bottom: Pt = [x + ((L - d) / (c - d || 1)) * CELL, y + CELL];
                        const left: Pt = [x, y + ((L - a) / (d - a || 1)) * CELL];

                        switch (code) {
                            case 1: case 14: addSeg(left, bottom); break;
                            case 2: case 13: addSeg(bottom, right); break;
                            case 3: case 12: addSeg(left, right); break;
                            case 4: case 11: addSeg(top, right); break;
                            case 6: case 9: addSeg(top, bottom); break;
                            case 7: case 8: addSeg(top, left); break;
                            case 5: addSeg(top, right); addSeg(left, bottom); break;
                            case 10: addSeg(top, left); addSeg(bottom, right); break;
                        }
                    }
                }

                // 把离散线段沿共享端点串成连续轮廓，交给平滑绘制
                const used = new Uint8Array(segs.length / 4);
                const walk = (startKey: number): Pt[] => {
                    const chain: Pt[] = [];
                    let cur = startKey;
                    for (;;) {
                        const candidates = ends.get(cur);
                        if (!candidates) break;
                        let next = -1;
                        for (const idx of candidates) {
                            if (!used[idx / 4]) { next = idx; break; }
                        }
                        if (next < 0) break;
                        used[next / 4] = 1;
                        const p: Pt = [segs[next], segs[next + 1]];
                        const q: Pt = [segs[next + 2], segs[next + 3]];
                        const other = keyOf(p[0], p[1]) === cur ? q : p;
                        chain.push(other);
                        cur = keyOf(other[0], other[1]);
                    }
                    return chain;
                };

                for (let s = 0; s < used.length; s++) {
                    if (used[s]) continue;
                    used[s] = 1;
                    const a: Pt = [segs[s * 4], segs[s * 4 + 1]];
                    const b: Pt = [segs[s * 4 + 2], segs[s * 4 + 3]];
                    const head = walk(keyOf(a[0], a[1])).reverse();
                    const tail = walk(keyOf(b[0], b[1]));
                    strokeChain([...head, a, b, ...tail]);
                }
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
