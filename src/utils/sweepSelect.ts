/**
 * 按住 Shift 的一次刷选：按下那条立即切换，之后指针扫过哪条就切换哪条。
 *
 * 切换是**按每条自己的状态**决定的——没选中的被选上，已选中的被取消，
 * 与不按 Shift 单击是同一套语义，所以「点一下」和「扫过去」没有两种规则。
 * 同一趟手势里每条只切一次：指针来回抖动不会把同一条反复翻转。
 */
export const startSweep = (
    id: string,
    /** 屏幕坐标 → 指针下的组件 id（只返回本次允许操作的组件） */
    hitTest: (x: number, y: number) => string | null,
    toggle: (id: string) => void,
) => {
    toggle(id);
    const visited = new Set<string>([id]);
    const move = (event: PointerEvent) => {
        const next = hitTest(event.clientX, event.clientY);
        if (!next || visited.has(next)) return;
        visited.add(next);
        toggle(next);
    };
    const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
};
