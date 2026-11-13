/** 编辑页等高线背景的纯计算层：标量场 → 分位等值线 → marching squares 轮廓 → 平滑 */

export type Pt = [number, number];
export interface Chain { pts: Pt[]; closed: boolean }

export const CELL = 12;

interface Peak {
    x: number; y: number; r: number; a: number;
    sx: number; sy: number; p: number;
}

/** 交错六边形网格布点：圈均匀铺满全屏（含边缘），不会在中心互相叠加成隆起 */
const PEAKS: Peak[] = (() => {
    let seed = 20261113;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const cols = 6;
    const rows = 4;
    const out: Peak[] = [];
    for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
            out.push({
                x: (i + 0.5 + (j % 2) * 0.5 + (rnd() - 0.5) * 0.3) / cols,
                y: (j + 0.5 + (rnd() - 0.5) * 0.3) / rows,
                r: 0.26 + rnd() * 0.06,
                a: 0.42 + rnd() * 0.16,
                sx: 0.7 + rnd() * 0.9,
                sy: 0.7 + rnd() * 0.9,
                p: rnd() * Math.PI * 2,
            });
        }
    }
    return out;
})();

/** 紧支撑四次核：峰只在自身半径内贡献，长尾不会全屏累加；再叠一条贯穿画面的低频长波 */
const sampleField = (nx: number, ny: number, t: number, aspect: number) => {
    let v = 0.46 * Math.sin(ny * 8.6 + nx * 3.4 + t * 0.50)
        + 0.22 * Math.sin(ny * 15.1 - nx * 5.7 - t * 0.36)
        + 0.13 * Math.cos((nx + ny) * 7.2 + t * 0.25);
    for (let i = 0; i < PEAKS.length; i++) {
        const b = PEAKS[i];
        const cx = b.x + 0.035 * Math.sin(t * b.sx + b.p);
        const cy = b.y + 0.055 * Math.cos(t * b.sy + b.p * 1.3);
        const dx = ((nx - cx) * aspect) / b.r;
        const dy = (ny - cy) / b.r;
        const q = dx * dx + dy * dy;
        if (q < 1) {
            const f = 1 - q;
            v += b.a * f * f;
        }
    }
    return v;
};

let scratch = new Float32Array(0);

/** 采样后对标量场做两次可分离 1-2-1 平滑，抹平峰间鞍部的尖角（等值线本身就圆润） */
export const fillGrid = (grid: Float32Array, cols: number, rows: number, w: number, h: number, t: number) => {
    const aspect = w / h;
    for (let j = 0; j < rows; j++) {
        const ny = (j * CELL) / h;
        for (let i = 0; i < cols; i++) {
            grid[j * cols + i] = sampleField((i * CELL) / w, ny, t, aspect);
        }
    }
    if (scratch.length < grid.length) scratch = new Float32Array(grid.length);
    for (let pass = 0; pass < 2; pass++) {
        for (let j = 0; j < rows; j++) {
            for (let i = 0; i < cols; i++) {
                const p = grid[j * cols + Math.max(0, i - 1)];
                const q = grid[j * cols + Math.min(cols - 1, i + 1)];
                scratch[j * cols + i] = (p + 2 * grid[j * cols + i] + q) / 4;
            }
        }
        for (let j = 0; j < rows; j++) {
            const upRow = Math.max(0, j - 1) * cols;
            const downRow = Math.min(rows - 1, j + 1) * cols;
            for (let i = 0; i < cols; i++) {
                grid[j * cols + i] = (scratch[upRow + i] + 2 * scratch[j * cols + i] + scratch[downRow + i]) / 4;
            }
        }
    }
};

/** 按当前帧场值的 2%~98% 分位取等级，等值线不会全挤在中心高值区 */
export const levelValues = (grid: Float32Array, levels: number) => {
    const BINS = 1024;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < grid.length; i++) {
        const v = grid[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
    }
    const span = hi - lo || 1;
    const hist = new Uint32Array(BINS);
    for (let i = 0; i < grid.length; i++) {
        hist[Math.min(BINS - 1, ((grid[i] - lo) / span * BINS) | 0)]++;
    }
    const quantile = (q: number) => {
        const target = q * grid.length;
        let acc = 0;
        for (let b = 0; b < BINS; b++) {
            const next = acc + hist[b];
            if (next >= target) return lo + ((b + (target - acc) / (hist[b] || 1)) / BINS) * span;
            acc = next;
        }
        return hi;
    };
    const a = quantile(0.02);
    const z = quantile(0.98);
    const out: number[] = [];
    for (let k = 0; k < levels; k++) out.push(a + (z - a) * (k + 0.5) / levels);
    return out;
};

/** 端点量化成整数 key，用于把离散线段串成连续轮廓 */
const keyOf = (x: number, y: number) => Math.round(x * 64) * 100000 + Math.round(y * 64);

let segs: number[] = [];
const ends = new Map<number, number[]>();

export const traceLevel = (grid: Float32Array, cols: number, rows: number, L: number): Chain[] => {
    segs.length = 0;
    ends.clear();
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

    const used = new Uint8Array(segs.length / 4);
    const walk = (startKey: number): Pt[] => {
        const chain: Pt[] = [];
        let cur = startKey;
        for (;;) {
            const candidates = ends.get(cur);
            if (!candidates) break;
            let next = -1;
            for (let k = 0; k < candidates.length; k++) {
                const idx = candidates[k];
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

    const chains: Chain[] = [];
    for (let s = 0; s < used.length; s++) {
        if (used[s]) continue;
        used[s] = 1;
        const a: Pt = [segs[s * 4], segs[s * 4 + 1]];
        const b: Pt = [segs[s * 4 + 2], segs[s * 4 + 3]];
        const head = walk(keyOf(a[0], a[1])).reverse();
        const tail = walk(keyOf(b[0], b[1]));
        const merged = [...head, a, b, ...tail];
        const closed = merged.length > 3
            && keyOf(merged[0][0], merged[0][1]) === keyOf(merged[merged.length - 1][0], merged[merged.length - 1][1]);
        const body = closed ? merged.slice(0, -1) : merged;

        // 去掉共点/过近点，避免 Catmull-Rom 在极短边上过冲打结
        const pts: Pt[] = [body[0]];
        for (let i = 1; i < body.length; i++) {
            const p = body[i];
            const q = pts[pts.length - 1];
            if ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 < 4) continue;
            pts.push(p);
        }
        if (closed && pts.length > 3) {
            const first = pts[0];
            const last = pts[pts.length - 1];
            if ((first[0] - last[0]) ** 2 + (first[1] - last[1]) ** 2 < 4) pts.pop();
        }
        if (pts.length > 1) chains.push({ pts, closed });
    }
    return chains;
};

/** 两次加权平滑：常规段用 1-2-1 抹掉格子阶梯，急转弯额外切角，消除鞍部的尖锐楔形 */
export const relaxChain = (chain: Chain): Chain => {
    let cur = chain.pts;
    for (let k = 0; k < 2; k++) {
        const n = cur.length;
        if (n < 3) break;
        const next: Pt[] = new Array(n);
        for (let i = 0; i < n; i++) {
            if (!chain.closed && (i === 0 || i === n - 1)) { next[i] = cur[i]; continue; }
            const p = cur[chain.closed ? (i - 1 + n) % n : i - 1];
            const c = cur[i];
            const q = cur[chain.closed ? (i + 1) % n : i + 1];
            const v1x = c[0] - p[0];
            const v1y = c[1] - p[1];
            const v2x = q[0] - c[0];
            const v2y = q[1] - c[1];
            const l1 = Math.hypot(v1x, v1y);
            const l2 = Math.hypot(v2x, v2y);
            const cos = l1 > 0.01 && l2 > 0.01 ? (v1x * v2x + v1y * v2y) / (l1 * l2) : 1;
            const keep = 0.5 * Math.min(1, Math.max(0, (cos + 0.2) / 0.7));
            next[i] = [
                keep * c[0] + (1 - keep) * (p[0] + q[0]) / 2,
                keep * c[1] + (1 - keep) * (p[1] + q[1]) / 2,
            ];
        }
        cur = next;
    }
    return { pts: cur, closed: chain.closed };
};
