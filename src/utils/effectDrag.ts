import type { PointerEvent as ReactPointerEvent } from 'react';
import type { EffectType } from '../types/audio';

/**
 * 效果器卡片的指针拖拽（不使用 HTML5 dataTransfer）。
 *
 * 原因：效果器库面板是 hover 展开、鼠标离开即收起的 motion 面板，原生 drag
 * 在源节点被 transform/裁剪时会被浏览器取消；自定义 MIME 在部分内核里也会被
 * dragover 过滤。改用 pointerdown → 全局 pointermove/pointerup + 跟随指针的
 * 浮层 + elementFromPoint 命中检测，稳定且不受面板动画影响。
 */
interface Payload {
    type: EffectType;
    name: string;
    color: string;
}

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

export const startEffectDrag = (
    e: ReactPointerEvent,
    payload: Payload,
    onDrop: (type: EffectType) => void,
): void => {
    if (e.button !== 0 || dragging) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    let ghost: HTMLDivElement | null = null;
    let zone: HTMLElement | null = null;

    const findZone = (x: number, y: number): HTMLElement | null => {
        const el = document.elementFromPoint(x, y) as HTMLElement | null;
        return (el?.closest('[data-effect-dropzone]') as HTMLElement | null) ?? null;
    };

    const setZone = (next: HTMLElement | null) => {
        if (zone === next) return;
        zone?.classList.remove('drop-active');
        next?.classList.add('drop-active');
        zone = next;
    };

    const clear = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        window.removeEventListener('blur', clear);
        ghost?.remove();
        ghost = null;
        setZone(null);
        dragging = false;
        document.body.classList.remove('effect-dragging');
        // 指针通常已离开库面板，mouseleave 不会再触发，主动通知面板收起
        window.dispatchEvent(new Event('effectdragend'));
    };

    const onMove = (ev: PointerEvent) => {
        if (!moved) {
            if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
            moved = true;
            ghost = document.createElement('div');
            ghost.className = 'effect-drag-ghost';
            ghost.textContent = payload.name;
            ghost.style.background = payload.color;
            ghost.style.color = isLight(payload.color) ? '#15161d' : '#ffffff';
            document.body.appendChild(ghost);
            document.body.classList.add('effect-dragging');
            // 立刻收起库面板，避免展开的面板盖住效果器链这个投放目标
            window.dispatchEvent(new Event('effectdragstart'));
        }
        if (ghost) ghost.style.transform = `translate(${ev.clientX + 14}px, ${ev.clientY + 12}px)`;
        setZone(findZone(ev.clientX, ev.clientY));
    };

    const onUp = (ev: PointerEvent) => {
        const hit = moved ? findZone(ev.clientX, ev.clientY) : null;
        clear();
        if (moved) {
            suppressClickUntil = performance.now() + 250;
            if (hit) onDrop(payload.type);
        }
    };

    dragging = true;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', clear);
};
