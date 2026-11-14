import type { PointerEvent as ReactPointerEvent } from 'react';
import type { EffectConfig, EffectType } from '../types/audio';

/**
 * 效果器的指针拖拽（不使用 HTML5 dataTransfer）。
 *
 * 原因：拖拽起点可能在会动的面板里，原生 drag 在源节点被 transform/裁剪时会被
 * 浏览器取消；自定义 MIME 在部分内核里也会被 dragover 过滤。改用
 * pointerdown → 全局 pointermove/pointerup + 跟随指针的浮层 + elementFromPoint
 * 命中检测，稳定且不受面板动画影响。
 */

let dragging = false;
let suppressClickUntil = 0;

/** 拖拽结束后短时间内抑制一次 click，避免松开时又叠加一次点击添加 */
export const shouldSuppressEffectClick = () => {
    if (performance.now() >= suppressClickUntil) return false;
    suppressClickUntil = 0;
    return true;
};

/** 颜色亮度：浅色背景配深字，深色背景配白字 */
const isLight = (hex: string) => {
    const n = parseInt(hex.replace('#', ''), 16);
    if (Number.isNaN(n)) return false;
    return (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 150;
};

const createGhost = (label: string, color: string) => {
    const ghost = document.createElement('div');
    ghost.className = 'effect-drag-ghost';
    ghost.textContent = label;
    ghost.style.background = color;
    ghost.style.color = isLight(color) ? '#15161d' : '#ffffff';
    document.body.appendChild(ghost);
    document.body.classList.add('effect-dragging');
    return ghost;
};

const moveGhost = (ghost: HTMLDivElement, x: number, y: number) => {
    ghost.style.transform = `translate(${x + 14}px, ${y + 12}px)`;
};

interface DropZone {
    zone: HTMLElement;
    channelId: string;
    /** 插到第几个效果器之前；落在空白处就是末尾 */
    index: number;
}

/** 命中效果器链，并按指针纵向位置算出插入位置 */
const findDropZone = (x: number, y: number): DropZone | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const zone = el?.closest('[data-effect-dropzone]') as HTMLElement | null;
    if (!zone) return null;
    const items = Array.from(zone.querySelectorAll<HTMLElement>('.effect-item'));
    let index = items.length;
    for (let i = 0; i < items.length; i++) {
        const box = items[i].getBoundingClientRect();
        if (y < box.top + box.height / 2) {
            index = i;
            break;
        }
    }
    return { zone, channelId: zone.dataset.channelId ?? '', index };
};

const highlight = (() => {
    let current: HTMLElement | null = null;
    return (next: HTMLElement | null) => {
        if (current === next) return;
        current?.classList.remove('drop-active');
        next?.classList.add('drop-active');
        current = next;
    };
})();

interface LibraryPayload {
    type: EffectType;
    name: string;
    color: string;
}

/** 从效果器库拖一个类型出去，落到哪条通道的效果器链就追加到那条链的链尾 */
export const startEffectDrag = (
    e: ReactPointerEvent,
    payload: LibraryPayload,
    onDrop: (type: EffectType, channelId?: string) => void,
): void => {
    if (e.button !== 0 || dragging) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    let ghost: HTMLDivElement | null = null;

    const clear = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        window.removeEventListener('blur', clear);
        ghost?.remove();
        ghost = null;
        highlight(null);
        dragging = false;
        document.body.classList.remove('effect-dragging');
    };

    const onMove = (ev: PointerEvent) => {
        if (!moved) {
            if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
            moved = true;
            ghost = createGhost(payload.name, payload.color);
        }
        if (ghost) moveGhost(ghost, ev.clientX, ev.clientY);
        highlight(findDropZone(ev.clientX, ev.clientY)?.zone ?? null);
    };

    const onUp = (ev: PointerEvent) => {
        const hit = moved ? findDropZone(ev.clientX, ev.clientY) : null;
        clear();
        if (moved) {
            suppressClickUntil = performance.now() + 250;
            if (hit) onDrop(payload.type, hit.channelId);
        }
    };

    dragging = true;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', clear);
};

interface CopyPayload {
    /** 一次可以带多个（Shift 多选时整组复制），按链里的顺序投放 */
    effects: EffectConfig[];
    color: string;
    label: string;
}

/** 长按多久才开始复制拖拽：短按只是点了一下按钮，不会误拖 */
const HOLD_MS = 160;

/**
 * 长按效果器卡片上的复制按钮再拖动：把这些已经调好参数的效果器复制一份，
 * 落到任意通道的效果器链里（包括自己的），按落点决定插在第几位。
 */
export const startEffectCopyDrag = (
    e: ReactPointerEvent,
    payload: CopyPayload,
    onDrop: (channelId: string, index: number) => void,
): void => {
    if (e.button !== 0 || dragging) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let ghost: HTMLDivElement | null = null;
    let ready = false;
    /** 真的拖动过才允许投放：只是长按没动就松手，不应该凭空多出一个副本 */
    let moved = false;

    const arm = (x: number, y: number) => {
        if (ready) return;
        ready = true;
        ghost = createGhost(payload.label, payload.color);
        moveGhost(ghost, x, y);
        document.body.classList.add('effect-dragging');
    };

    // 按住不动也算开始拖：指针还没动时先把浮层挂在按钮旁边
    const holdTimer = window.setTimeout(() => arm(startX, startY), HOLD_MS);

    const clear = () => {
        window.clearTimeout(holdTimer);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        window.removeEventListener('blur', clear);
        ghost?.remove();
        ghost = null;
        highlight(null);
        dragging = false;
        document.body.classList.remove('effect-dragging');
    };

    const onMove = (ev: PointerEvent) => {
        if (!ready) {
            if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
            arm(ev.clientX, ev.clientY);
        }
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8) moved = true;
        moveGhost(ghost!, ev.clientX, ev.clientY);
        highlight(findDropZone(ev.clientX, ev.clientY)?.zone ?? null);
    };

    const onUp = (ev: PointerEvent) => {
        const hit = moved ? findDropZone(ev.clientX, ev.clientY) : null;
        clear();
        if (hit) {
            suppressClickUntil = performance.now() + 250;
            if (hit.channelId) onDrop(hit.channelId, hit.index);
        }
    };

    dragging = true;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', clear);
};
