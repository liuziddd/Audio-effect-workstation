import { Fragment, useRef, useState, useEffect, useCallback, useLayoutEffect, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { Download, Layers, Pause, Pin, Play, Plus, Repeat, Square } from 'lucide-react';
import { MixerApi, MixerChannel } from '../../hooks/useMixer';
import { startSweep } from '../../utils/sweepSelect';
import { CHANNEL_COLORS, ChannelStrip } from './ChannelStrip';
import { EffectRack } from './EffectRack';
import './styles.css';

const MIN_FADER_HEIGHT = 100;
const MAX_FADER_HEIGHT = 400;
/** 推子区初始高度：比没有路由窗时低 20%，让出空间给路由输入窗 */
const DEFAULT_FADER_HEIGHT = 192;
/**
 * 路由线的最小 / 最大下垂量，越远的通道垂得越深。
 * 弧底会落到卡片下沿之外，这是刻意的：线从机箱底部垂出来
 */
const ROUTE_DROP_MIN = 48;
const ROUTE_DROP_MAX = 112;

/** 路由点上连点两下（间隔小于这个毫秒）才断开该通道的全部出线 */
const DOUBLE_TAP_MS = 360;

/** 通道之间的水平间距（与 .mixer-strips 的 gap 一致），拖动让位按它算跨度 */
const SLOT_GAP = 8;

/**
 * 滚轮横移的弹簧参数：临界阻尼就取 2√k。
 * 和「每帧按比例追目标」的区别是**速度是连续的**——连续滚时不会一次一次地
 * 加速再刹停，读起来才是丝滑的一段；单格的行程约 200ms 停稳。
 */
const GLIDE_STIFFNESS = 480;
const GLIDE_DAMPING = 44;
/** 目标再远也不让它飞起来 */
const GLIDE_MAX_SPEED = 4200;

/** 卡片外面的快捷键说明：纯文字，之间用一条细竖线分开 */
const SHORTCUTS = [
    { key: 'Ctrl', label: '拖动通道' },
    { key: 'Shift', label: '按住扫选多选' },
    { key: 'G', label: '分组上色' },
    { key: 'T', label: '固定到左侧' },
    { key: '双击数值', label: '直接输入' },
    { key: '滚轮', label: '横向滚动' },
];

type Anchor = { x: number; y: number };

interface RouteTrail {
    id: string;
    /** 线色 = 源通道颜色；未上色时走主题色（暗白亮黑） */
    color?: string;
    lane: number;
    from: string;
    to: string;
    /** 固定在左侧的通道不随横向滚动走，画线时不能再减滚动量 */
    fromPinned: boolean;
    toPinned: boolean;
}

/** 三点式下垂弧：两个控制点都在下方并向外摊开，得到一条又长又垂的线 */
const routePath = (from: Anchor, to: Anchor, lane = 0) => {
    const dx = to.x - from.x;
    // 同一对通道的双向路由各占一条泳道，深度错开才看得出是两条
    const drop = Math.min(ROUTE_DROP_MAX, ROUTE_DROP_MIN + Math.abs(dx) * 0.24) + lane * 24;
    return `M ${from.x} ${from.y} C ${from.x + dx * 0.3} ${from.y + drop}, ${to.x - dx * 0.3} ${to.y + drop}, ${to.x} ${to.y}`;
};

const formatTime = (seconds: number) => {
    const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    const minutes = Math.floor(safe / 60);
    const rest = safe % 60;
    return `${String(minutes).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
};

export const Mixer = ({ mixer }: { mixer: MixerApi }) => {
    const {
        channels, routes, isPlaying, loop, currentTime, duration,
        play, pause, stop, toggleLoop, beginSeek, previewSeek, seek,
        updateChannel, updateChannels, loadChannelAudio, clearChannel, addChannel, moveChannels, removeChannel,
        resetChannelLabel,
        insertEffectCopies, removeEffects, setEffectsEnabled, updateEffect,
        updateEffectEqBands, updateEffectShaperPoints, reorderEffects,
        getAnalyser, exportMix, hasAudio, addRoute, removeRoutesFrom, removeRoute,
        setActiveChannelId, setChannelColor, groupChannels, ungroupChannels, pinnedIds, togglePin,
    } = mixer;

    const wrapRef = useRef<HTMLDivElement>(null);
    const stripsRef = useRef<HTMLDivElement>(null);
    const pinnedRef = useRef<HTMLDivElement>(null);
    const stripRefs = useRef(new Map<string, HTMLDivElement>());
    /** 槽位（通道条 + 它右边展开的效果器面板）：排序拖动时整体位移的单位 */
    const slotRefs = useRef(new Map<string, HTMLDivElement>());
    const scrubRef = useRef<HTMLDivElement>(null);
    const tempLineRef = useRef<SVGLineElement>(null);
    /** 拖路由的起点：Shift 多选时一次带出整组 */
    const dragFromRef = useRef<string[]>([]);
    const dragStartRef = useRef({ x: 0, y: 0 });
    /** 上一次「原地点击路由点」的通道与时间，用来判定双击 */
    const tapRef = useRef({ from: '', at: 0 });
    /** 通道区当前横向滚动量：画路由线时要减掉 */
    const scrollRef = useRef(0);
    const pathsRef = useRef(new Map<string, SVGPathElement>());
    /** 每条线的两端通道：锚点是活的，放这里让画线不必等 React 渲染 */
    const trailsRef = useRef<RouteTrail[]>([]);
    /** 各通道路由点的最新位置（通道区内容坐标）；由 follow() 每帧重取 */
    const anchorsRef = useRef(new Map<string, Anchor>());
    const followRafRef = useRef(0);
    const followUntilRef = useRef(0);
    const scrollbarRef = useRef(-1);
    /** 落位滑行的编号：新的拖动开始后，旧的回调不再清抬升态 */
    const settleRef = useRef(0);

    const [faderHeight, setFaderHeight] = useState(DEFAULT_FADER_HEIGHT);
    /** 同时展开的效果器侧栏：每条通道独立，可以一起开着 */
    const [expandedIds, setExpandedIds] = useState<string[]>([]);
    /** 刚开始展开、还在播宽度动画的侧栏 */
    const [openingIds, setOpeningIds] = useState<string[]>([]);
    const [exporting, setExporting] = useState(false);
    /** 导出文件名：留空就用默认的 mixdown_时间戳 */
    const [exportName, setExportName] = useState('');
    /** 正在拉线的源通道：Shift 多选时是整组 */
    const [routeFromIds, setRouteFromIds] = useState<string[]>([]);
    const routeFrom = routeFromIds[0] ?? null;
    const [dragId, setDragId] = useState<string | null>(null);
    const [tempStart, setTempStart] = useState<Anchor | null>(null);
    /** 选中的通道：批量分组 / 固定 / 拖动都以它为准 */
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [ctrlDown, setCtrlDown] = useState(false);
    /** 按住了 Shift：通道参数锁定，只做整体选中 */
    const [shiftDown, setShiftDown] = useState(false);
    const [groupOpen, setGroupOpen] = useState(false);
    /** 固定图层宽度：滚动区要按它让出左侧空间 */
    const [pinnedWidth, setPinnedWidth] = useState(0);

    const selectedRef = useRef(selectedIds);
    selectedRef.current = selectedIds;
    const pinnedSetRef = useRef(new Set(pinnedIds));
    pinnedSetRef.current = new Set(pinnedIds);

    const expandedKey = expandedIds.join('|');
    const pinnedKey = pinnedIds.join('|');
    const anySolo = channels.some((channel) => channel.solo);
    const progress = duration ? Math.min(1, currentTime / duration) : 0;

    const pinnedChannels = useMemo(() => channels.filter((channel) => pinnedSetRef.current.has(channel.id)), [channels, pinnedKey]);
    const scrollChannels = useMemo(() => channels.filter((channel) => !pinnedSetRef.current.has(channel.id)), [channels, pinnedKey]);

    // 导出：文件名留空时由 useMixer 生成默认名
    const runExport = async () => {
        if (!hasAudio || exporting) return;
        setExporting(true);
        try {
            await exportMix(exportName);
        } finally {
            setExporting(false);
        }
    };

    /** 画一条路由线：固定在左侧的端点用屏幕坐标，其余端点减掉横向滚动量 */
    const writePath = useCallback((trail: RouteTrail, scroll: number) => {
        const path = pathsRef.current.get(trail.id);
        const from = anchorsRef.current.get(trail.from);
        const to = anchorsRef.current.get(trail.to);
        if (!path || !from || !to) return;
        path.setAttribute('d', routePath(
            { x: from.x - (trail.fromPinned ? 0 : scroll), y: from.y },
            { x: to.x - (trail.toPinned ? 0 : scroll), y: to.y },
            trail.lane,
        ));
    }, []);

    /** 按当前的锚点与滚动量把每条线重画一遍：不动 React，也不读布局 */
    const syncPaths = useCallback(() => {
        for (const trail of trailsRef.current) writePath(trail, scrollRef.current);
    }, [writePath]);

    // 路由锚点：取每条通道条底部圆点的实际位置。普通通道换算成「通道区内容坐标」
    // （含横向滚动量），固定通道不滚动，用屏幕坐标即可
    const measure = useCallback(() => {
        const wrap = wrapRef.current;
        const strips = stripsRef.current;
        if (!wrap || !strips) return;
        const base = wrap.getBoundingClientRect();
        const scroll = strips.scrollLeft;
        scrollRef.current = scroll;
        // 滚动条实际占的高度：固定图层的底边按它对齐（经典滚动条 8px，overlay 滚动条 0）
        const scrollbar = strips.offsetHeight - strips.clientHeight;
        if (scrollbar !== scrollbarRef.current) {
            scrollbarRef.current = scrollbar;
            wrap.style.setProperty('--mixer-scrollbar', `${scrollbar}px`);
        }
        for (const [id, el] of stripRefs.current) {
            const dot = el.querySelector('.strip-route-dot') ?? el;
            const box = dot.getBoundingClientRect();
            anchorsRef.current.set(id, {
                x: box.left - base.left + box.width / 2 + (pinnedSetRef.current.has(id) ? 0 : scroll),
                y: box.top - base.top + box.height / 2,
            });
        }
        syncPaths();
    }, [syncPaths]);

    /**
     * 让锚点跟着通道条再跑一段时间：拖动让位、落下回弹、面板展开这三段都有 0.2s 左右的
     * 位移过程，逐帧重量才不会出现「线头停在半路」。
     */
    const follow = useCallback((ms: number) => {
        followUntilRef.current = Math.max(followUntilRef.current, performance.now() + ms);
        if (followRafRef.current) return;
        const tick = () => {
            measure();
            if (performance.now() < followUntilRef.current) {
                followRafRef.current = requestAnimationFrame(tick);
            } else {
                followRafRef.current = 0;
            }
        };
        followRafRef.current = requestAnimationFrame(tick);
    }, [measure]);

    useEffect(() => () => cancelAnimationFrame(followRafRef.current), []);

    /** 滚动时只重写 path 的 d，不重算锚点、不触发 React 渲染 */
    const handleScroll = useCallback(() => {
        const strips = stripsRef.current;
        if (!strips) return;
        if (Math.abs(scrollRef.current - strips.scrollLeft) < 0.5) return;
        scrollRef.current = strips.scrollLeft;
        syncPaths();
    }, [syncPaths]);

    const trails = useMemo<RouteTrail[]>(() => routes.map((route, index) => ({
        id: route.id,
        color: channels.find((channel) => channel.id === route.from)?.color,
        // 同一对通道的双向路由各占一条泳道，深度错开才看得出是两条
        lane: routes
            .slice(0, index)
            .filter((item) => (item.from === route.from && item.to === route.to)
                || (item.from === route.to && item.to === route.from))
            .length,
        from: route.from,
        to: route.to,
        fromPinned: pinnedSetRef.current.has(route.from),
        toPinned: pinnedSetRef.current.has(route.to),
    })), [routes, pinnedKey, channels]);
    trailsRef.current = trails;

    /** 初始「波形 : 推子区」= 3 : 7：推子是主角，波形够看就行 */
    const sizedRef = useRef(false);
    useLayoutEffect(() => {
        if (sizedRef.current) return;
        const strip = stripsRef.current?.querySelector('.mixer-strip');
        const wave = strip?.querySelector('.strip-wave');
        const fader = strip?.querySelector('.strip-fader-area') as HTMLElement | null | undefined;
        if (!wave || !fader) return;
        sizedRef.current = true;
        const total = wave.clientHeight + fader.clientHeight;
        if (total > 0) setFaderHeight(Math.round(total * 0.7));
    }, []);

    // 通道被移除时收起它的侧栏、从选中列表里摘掉
    useEffect(() => {
        const alive = new Set(channels.map((channel) => channel.id));
        setExpandedIds((previous) => {
            const next = previous.filter((id) => alive.has(id));
            return next.length === previous.length ? previous : next;
        });
        setSelectedIds((previous) => {
            const next = previous.filter((id) => alive.has(id));
            return next.length === previous.length ? previous : next;
        });
        setRouteFromIds((previous) => {
            const next = previous.filter((id) => alive.has(id));
            return next.length === previous.length ? previous : next;
        });
    }, [channels]);

    useLayoutEffect(() => {
        measure();
    }, [channels, expandedKey, faderHeight, pinnedWidth, measure]);

    // 固定图层的实际宽度：滚动区靠它让位
    useEffect(() => {
        const el = pinnedRef.current;
        if (!el) {
            setPinnedWidth(0);
            return;
        }
        setPinnedWidth(el.offsetWidth);
        const observer = new ResizeObserver(() => setPinnedWidth(el.offsetWidth));
        observer.observe(el);
        return () => observer.disconnect();
    }, [pinnedKey, expandedKey]);

    // 通道装不下时，滚轮上下改成左右移动，不用去够下面的滚动条
    useEffect(() => {
        const el = stripsRef.current;
        if (!el) return;

        /** 缓动目标；空闲时与真实位置保持一致 */
        let target = el.scrollLeft;
        /** 自己维护的浮点位置：scrollLeft 是整数像素，直接累加会被舍入抹掉 */
        let current = el.scrollLeft;
        let speed = 0;
        let frame = 0;
        let last = 0;

        const stop = () => {
            frame = 0;
            target = el.scrollLeft;
            current = el.scrollLeft;
            speed = 0;
        };

        const glide = (now: number) => {
            // 期间被拖了滚动条或 scrollIntoView 挪过，从这个新位置接着走
            if (Math.abs(el.scrollLeft - current) > 2) {
                current = el.scrollLeft;
                speed = 0;
            }
            const limit = el.scrollWidth - el.clientWidth;
            // 掉帧时按 8ms 一小步积分，弹簧才不会因为步长过大而发散
            let remaining = Math.min(48, now - last);
            last = now;
            while (remaining > 0) {
                const dt = Math.min(8, remaining) / 1000;
                remaining -= dt * 1000;
                speed = Math.max(-GLIDE_MAX_SPEED, Math.min(
                    GLIDE_MAX_SPEED,
                    speed + (GLIDE_STIFFNESS * (target - current) - GLIDE_DAMPING * speed) * dt,
                ));
                current += speed * dt;
                if (current <= 0) {
                    current = 0;
                    if (speed < 0) speed = 0;
                } else if (current >= limit) {
                    current = limit;
                    if (speed > 0) speed = 0;
                }
            }
            if (Math.abs(target - current) < 0.4 && Math.abs(speed) < 12) {
                el.scrollLeft = target;
                handleScroll();
                stop();
                return;
            }
            el.scrollLeft = current;
            handleScroll();
            frame = requestAnimationFrame(glide);
        };

        const onWheel = (event: WheelEvent) => {
            // 触控板横向滑动、Ctrl + 滚轮缩放，都交回浏览器
            if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
            const max = el.scrollWidth - el.clientWidth;
            if (max <= 0) return;
            // 通道里自己的纵向列表（效果器链、路由列表）还能滚时，把滚轮留给它
            for (let node = event.target as HTMLElement | null; node && node !== el; node = node.parentElement) {
                if (node.scrollHeight <= node.clientHeight) continue;
                const atStart = node.scrollTop <= 0;
                const atEnd = node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
                if (event.deltaY < 0 ? !atStart : !atEnd) return;
            }
            const step = event.deltaMode === WheelEvent.DOM_DELTA_LINE
                ? event.deltaY * 16
                : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
                    ? event.deltaY * el.clientHeight
                    : event.deltaY;
            if (!frame) {
                target = el.scrollLeft;
                current = el.scrollLeft;
                speed = 0;
                last = performance.now();
            }
            target = Math.max(0, Math.min(max, target + step));
            if (!frame) frame = requestAnimationFrame(glide);
            event.preventDefault();
        };

        el.addEventListener('wheel', onWheel, { passive: false });
        return () => {
            el.removeEventListener('wheel', onWheel);
            cancelAnimationFrame(frame);
        };
    }, [handleScroll, pinnedWidth]);

    /** 侧栏展开/收起有 300ms 宽度动画，期间让锚点一直跟着走 */
    useEffect(() => {
        if (!expandedKey) return;
        follow(620);
    }, [expandedKey, follow]);

    /** 新加一条线时锚点还是上一次的，先把这条线画出来再说 */
    useLayoutEffect(() => {
        syncPaths();
    }, [trails, syncPaths]);

    useEffect(() => {
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, [measure]);

    /** 键盘：G 分组、T 固定、Ctrl 按住时整条通道可拖 */
    useEffect(() => {
        const typing = (target: EventTarget | null) =>
            Boolean((target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]'));

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Control' || event.key === 'Meta') {
                setCtrlDown(true);
                return;
            }
            if (event.key === 'Shift') {
                setShiftDown(true);
                return;
            }
            if (typing(event.target) || !selectedRef.current.length) return;
            const key = event.key.toLowerCase();
            if (key === 'g') {
                event.preventDefault();
                setGroupOpen((open) => !open);
            } else if (key === 't') {
                event.preventDefault();
                togglePin(selectedRef.current);
            } else if (event.key === 'Escape') {
                setGroupOpen(false);
            }
        };
        const onKeyUp = (event: KeyboardEvent) => {
            if (event.key === 'Control' || event.key === 'Meta') setCtrlDown(false);
            if (event.key === 'Shift') setShiftDown(false);
        };
        // 切窗口回来时按键状态已经失效，别让它卡在多选 / 可拖拽
        const onBlur = () => {
            setCtrlDown(false);
            setShiftDown(false);
        };
        // 每次按下都按这次事件自己的修饰键校正一遍：万一某次 keyup 丢了，
        // 也不会让之后的点击永远走「多选 / 拖动」分支
        const onPointer = (event: PointerEvent) => {
            if (!event.shiftKey) setShiftDown(false);
            if (!event.ctrlKey && !event.metaKey) setCtrlDown(false);
        };

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        window.addEventListener('blur', onBlur);
        window.addEventListener('pointerdown', onPointer);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('blur', onBlur);
            window.removeEventListener('pointerdown', onPointer);
        };
    }, [togglePin]);

    // 分组颜色盘：点面板外面就收起
    useEffect(() => {
        if (!groupOpen) return;
        const close = (event: PointerEvent) => {
            if ((event.target as HTMLElement).closest('.mixer-palette, .mixer-btn.compact')) return;
            setGroupOpen(false);
        };
        window.addEventListener('pointerdown', close);
        return () => window.removeEventListener('pointerdown', close);
    }, [groupOpen]);

    /**
     * 单击：收敛成只选这一条；它本来就是唯一选中时，再点一下就是取消（变成什么都不选）。
     * Shift 单击是同一级的另一条路——按下那条当场切换、扫过哪条切哪条，见 handleChannelSelect。
     */
    const selectChannel = (channelId: string) => {
        setActiveChannelId(channelId);
        setSelectedIds((previous) => (previous.length === 1 && previous[0] === channelId ? [] : [channelId]));
    };

    /**
     * 按下一条通道。判定一律用**这次事件自己的修饰键**（`event.shiftKey` / `event.ctrlKey`），
     * 不用全局按键状态——状态万一没收到 keyup，也不会让点击永远走错分支。
     * - Ctrl：整条通道（含展开的面板）就是一个拖动把手；先什么都不改，只按一下没拖才把它摘掉；
     * - Shift：参数已锁定，只换选中；按住拖动会扫过整排通道，每条按自己的状态切换
     *   （没选中→选上，已选中→取消），和单击同一级；
     * - 普通单击：收敛成只选这一条，它本来就是唯一选中时再点一下就是取消。
     */
    const handleChannelSelect = (channelId: string) => (event: React.PointerEvent) => {
        const additive = event.shiftKey || event.metaKey;
        if (event.ctrlKey || event.metaKey) {
            if (selectedRef.current.includes(channelId)) {
                // 按下即可能开始整段拖动：拖了就不动选中，只是点一下才取消它
                const startX = event.clientX;
                const startY = event.clientY;
                let dragged = false;
                const stop = () => {
                    window.removeEventListener('pointermove', move);
                    window.removeEventListener('pointerup', up);
                    window.removeEventListener('pointercancel', up);
                };
                const move = (moveEvent: PointerEvent) => {
                    if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 5) {
                        dragged = true;
                        stop();
                    }
                };
                const up = () => {
                    stop();
                    if (!dragged) setSelectedIds((previous) => previous.filter((id) => id !== channelId));
                };
                window.addEventListener('pointermove', move);
                window.addEventListener('pointerup', up);
                window.addEventListener('pointercancel', up);
            } else {
                selectChannel(channelId);
            }
            return;
        }
        if (!additive) {
            selectChannel(channelId);
            return;
        }
        // Shift：整条通道只是一个选项。按下那条当场切换，之后扫过哪条就切哪条——
        // 没选中的被选上、已选中的被取消，和单击同一套语义
        const working = new Set(selectedRef.current);
        startSweep(
            channelId,
            (x, y) => (document.elementFromPoint(x, y)
                ?.closest('[data-channel-id]') as HTMLElement | null)?.dataset.channelId ?? null,
            (id) => {
                if (working.delete(id)) {
                    setSelectedIds([...working]);
                    return;
                }
                working.add(id);
                setActiveChannelId(id);
                setSelectedIds([...working]);
            },
        );
    };

    /** 通道参数：选中多条时按比例联动到整组，只有自己时照常改 */
    const updateParamsOf = (channelId: string) => (patch: Partial<MixerChannel>) => {
        const group = selectedRef.current;
        if (group.length > 1 && group.includes(channelId)) {
            updateChannels([channelId, ...group.filter((id) => id !== channelId)], patch);
            return;
        }
        updateChannel(channelId, patch);
    };

    const toggleRack = (channelId: string) => {
        setActiveChannelId(channelId);
        const willOpen = !expandedIds.includes(channelId);
        setExpandedIds((previous) => (
            previous.includes(channelId)
                ? previous.filter((id) => id !== channelId)
                : [...previous, channelId]
        ));
        if (!willOpen) return;
        // 拉开的那一下才有宽度动画，动画结束就摘掉，免得拖动排序时被重播
        setOpeningIds((previous) => [...previous, channelId]);
        window.setTimeout(() => {
            setOpeningIds((previous) => previous.filter((id) => id !== channelId));
        }, 340);
        // 新开的面板滚进视野，否则窄窗口里它可能落在卡片外
        requestAnimationFrame(() => stripRefs.current.get(channelId)?.scrollIntoView({
            behavior: 'smooth',
            inline: 'nearest',
            block: 'nearest',
        }));
    };

    const startSplitDrag = (event: React.PointerEvent) => {
        event.preventDefault();
        const startY = event.clientY;
        const startHeight = faderHeight;
        const onMove = (moveEvent: PointerEvent) => {
            const next = startHeight - (moveEvent.clientY - startY);
            setFaderHeight(Math.min(MAX_FADER_HEIGHT, Math.max(MIN_FADER_HEIGHT, next)));
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    };

    /**
     * 按住 Ctrl 拖动排序：被拖的通道（多选时整段）滑进目标空位，其它通道按实测矩形让位；
     * 拖动过程不改 React 顺序，松手才提交——所以不会因为 DOM 重排而跳，
     * 展开着效果器面板的宽槽位也能算准。
     */
    const startChannelDrag = (channelId: string) => (event: React.PointerEvent) => {
        if (event.button !== 0 || !(event.ctrlKey || event.metaKey)) return;
        const ids = selectedRef.current.includes(channelId) ? [...selectedRef.current] : [channelId];
        const idSet = new Set(ids);
        // 只在同一层里排：固定通道与滚动通道互不干扰
        const layer = (pinnedSetRef.current.has(channelId) ? pinnedChannels : scrollChannels)
            .map((channel) => channel.id);

        const els = new Map<string, HTMLElement>();
        const originLeft = new Map<string, number>();
        const widths = new Map<string, number>();
        const others: string[] = [];
        let layerLeft = 0;
        /** 拖动块之前有几条「其它」通道 */
        let before = 0;
        let seenBlock = false;
        /** 拖动块的整体宽度与最左边界：块是刚体，跟着指针整体走 */
        let blockWidth = 0;
        let blockLeft = Infinity;
        for (const id of layer) {
            const el = slotRefs.current.get(id);
            if (!el) continue;
            const rect = el.getBoundingClientRect();
            els.set(id, el);
            originLeft.set(id, rect.left);
            widths.set(id, rect.width);
            if (!layerLeft) layerLeft = rect.left;
            if (idSet.has(id)) {
                seenBlock = true;
                blockWidth += rect.width + SLOT_GAP;
                blockLeft = Math.min(blockLeft, rect.left);
            } else {
                others.push(id);
                if (!seenBlock) before += 1;
            }
        }
        if (ids.some((id) => !els.has(id))) return;
        blockWidth -= SLOT_GAP;
        const dragged = ids.map((id) => els.get(id)!);
        /** 把拖动块插到 at 位置时，整层每条通道该去的左边偏移（宽度不一也能算准） */
        const offsetsAt = (at: number) => {
            const sequence = [...others.slice(0, at), ...ids, ...others.slice(at)];
            const offsets = new Map<string, number>();
            let x = layerLeft;
            for (const id of sequence) {
                offsets.set(id, x - (originLeft.get(id) ?? x));
                x += (widths.get(id) ?? 0) + SLOT_GAP;
            }
            return offsets;
        };

        /** 邻居让位：只挪「其它」通道，被拖的那一块自己跟着指针走 */
        const shiftOthers = (at: number) => {
            const offsets = offsetsAt(at);
            for (const id of others) {
                const offset = offsets.get(id) ?? 0;
                els.get(id)!.style.transform = offset ? `translate3d(${offset}px, 0, 0)` : '';
            }
        };

        const startX = event.clientX;
        const startY = event.clientY;
        let active = false;
        let insertAt = before;
        let dx = 0;

        const move = (moveEvent: PointerEvent) => {
            if (!active) {
                if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5) return;
                active = true;
                setDragId(channelId);
                document.body.classList.add('channel-dragging');
                for (const el of dragged) {
                    // 跟手的那一块不能带缓动，否则会拖在指针后面；同时浮在邻居上面
                    el.style.transition = 'none';
                    el.style.zIndex = '20';
                }
            }
            // 整块按指针位移平移（块内间距、内部面板一起走，像被手拎起来一样）
            dx = moveEvent.clientX - startX;
            for (const el of dragged) el.style.transform = dx ? `translate3d(${dx}px, 0, 0)` : '';
            // 邻居在滑，路由线要跟着滑，不然会停在原地（滑行有 0.2s，跟足一整段）
            follow(260);
            // 块的视觉中心越过某条通道的中心，就插到它前面；全过了就落队尾
            const center = blockLeft + dx + blockWidth / 2;
            let next = others.length;
            for (let index = 0; index < others.length; index += 1) {
                const id = others[index];
                if (center < originLeft.get(id)! + (widths.get(id) ?? 0) / 2) {
                    next = index;
                    break;
                }
            }
            if (next === insertAt) return;
            insertAt = next;
            shiftOthers(insertAt);
        };

        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', up);
            document.body.classList.remove('channel-dragging');
            if (!active) {
                setDragId(null);
                return;
            }
            const offsets = offsetsAt(insertAt);
            // 邻居：冻结过渡再清位移——位移量正好等于新旧布局的差，清掉的瞬间新布局还没生效，
            // 两者叠加刚好停在原地，这一帧不做动画就不会抽搐
            for (const id of others) {
                const el = els.get(id)!;
                el.style.transition = 'none';
                el.style.transform = '';
            }
            // 被拖的块：先站到「新布局 + 当前视觉位置」上，换完布局再还原 transform，
            // 它就会自己滑进槽位——和效果器卡片松手后的落位是同一个观感
            for (const id of ids) {
                const rest = dx - (offsets.get(id) ?? 0);
                els.get(id)!.style.transform = rest ? `translate3d(${rest}px, 0, 0)` : '';
            }
            if (insertAt !== before) {
                // 同步提交新顺序：换布局与坐标补偿必须在同一帧里完成，否则会看到倒着抽一下
                flushSync(() => moveChannels(ids, insertAt >= others.length ? null : others[insertAt]));
            }
            // 落位滑行 0.2s + 通道条放大回弹 0.18s，期间继续跟锚点
            follow(460);
            requestAnimationFrame(() => {
                for (const id of ids) {
                    const el = els.get(id)!;
                    el.style.transition = '';
                    el.style.transform = '';
                }
                for (const id of others) els.get(id)!.style.transition = '';
            });
            // 滑进槽位之前一直压着邻居，滑完才收掉抬升态
            settleRef.current += 1;
            const token = settleRef.current;
            window.setTimeout(() => {
                if (settleRef.current !== token) return;
                setDragId(null);
                for (const el of dragged) el.style.zIndex = '';
            }, 240);
        };

        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
    };

    const startRouteDrag = (channelId: string) => (event: React.PointerEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const wrap = wrapRef.current;
        const dot = stripRefs.current.get(channelId)?.querySelector('.strip-route-dot');
        if (!wrap || !dot) return;
        // Shift 多选时一次带出整组，落点会同时给它们各建一条线
        const ids = selectedRef.current.length > 1 && selectedRef.current.includes(channelId)
            ? selectedRef.current
            : [channelId];
        const base = wrap.getBoundingClientRect();
        const box = dot.getBoundingClientRect();
        dragFromRef.current = ids;
        dragStartRef.current = { x: event.clientX, y: event.clientY };
        // 临时线画在不滚动的叠层里，直接用屏幕坐标
        setTempStart({ x: box.left - base.left + box.width / 2, y: box.top - base.top + box.height / 2 });
        setRouteFromIds(ids);
    };

    // 路由拖拽：移动只改 SVG 属性，不走 React 渲染
    useEffect(() => {
        if (!routeFrom) return;
        const move = (event: PointerEvent) => {
            const wrap = wrapRef.current;
            const line = tempLineRef.current;
            if (!wrap || !line) return;
            const base = wrap.getBoundingClientRect();
            line.setAttribute('x2', String(event.clientX - base.left));
            line.setAttribute('y2', String(event.clientY - base.top));
        };
        const up = (event: PointerEvent) => {
            const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-channel-id]') as HTMLElement | null;
            const to = target?.dataset.channelId;
            const fromIds = dragFromRef.current;
            const moved = Math.hypot(event.clientX - dragStartRef.current.x, event.clientY - dragStartRef.current.y);
            // 拖到别的通道建立路由；原地连点两下才断开这组通道的所有出线（单击不动，避免一下清光）
            if (fromIds.length && to && !fromIds.includes(to)) {
                fromIds.forEach((from) => addRoute(from, to));
            } else if (fromIds.length && moved < 6) {
                const now = performance.now();
                const last = tapRef.current;
                const signature = fromIds.join('|');
                if (last.from === signature && now - last.at < DOUBLE_TAP_MS) {
                    fromIds.forEach(removeRoutesFrom);
                    tapRef.current = { from: '', at: 0 };
                } else {
                    tapRef.current = { from: signature, at: now };
                }
            }
            dragFromRef.current = [];
            setRouteFromIds([]);
            setTempStart(null);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        return () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
        };
    }, [routeFrom, addRoute, removeRoutesFrom]);

    const seekToClientX = (clientX: number, commit: boolean) => {
        const rect = scrubRef.current?.getBoundingClientRect();
        if (!rect || !duration) return;
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        if (commit) seek(ratio * duration);
        else previewSeek(ratio * duration);
    };

    /** 线色 = 源通道自己的颜色；没上色就交给 CSS 用主题色（暗白亮黑） */
    const colorOf = (channelId: string) => channels.find((channel) => channel.id === channelId)?.color;
    /** 进本通道的来源：源通道显示名 + 线色，供路由输入窗列出 */
    const incomingOf = (channelId: string) => routes
        .filter((route) => route.to === channelId)
        .map((route) => ({
            id: route.id,
            from: route.from,
            color: colorOf(route.from),
            label: channels.find((item) => item.id === route.from)?.label ?? '—',
        }));
    const isRouteTarget = (channelId: string) => Boolean(
        routeFrom
        && routeFrom !== channelId
        && !routes.some((route) => route.from === channelId && route.to === routeFrom)
    );

    const applyGroup = (color: string) => {
        groupChannels(selectedIds, color);
        setGroupOpen(false);
    };

    /** 正在拉线时的临时线色：跟着源通道颜色，没上色就交给 CSS */
    const routeTint = routeFrom ? colorOf(routeFrom) : undefined;

    const renderSlot = (channel: MixerChannel) => (
        <div
            className="mixer-slot"
            key={channel.id}
            data-channel-id={channel.id}
            onPointerDown={(event) => {
                if (!ctrlDown && !shiftDown) return;
                const target = event.target as HTMLElement;
                // 通道条自己那一层已经在处理了
                if (target.closest('.mixer-strip')) return;
                // Ctrl：整条槽位（含展开的面板与里面的卡片）都是一个拖动把手
                if (ctrlDown) {
                    handleChannelSelect(channel.id)(event);
                    startChannelDrag(channel.id)(event);
                    return;
                }
                // Shift：面板的标题栏、留白、卡片间隙算通道本体；卡片本身归卡片（整卡多选）
                if (target.closest('.effect-item')) return;
                handleChannelSelect(channel.id)(event);
            }}
            ref={(node) => {
                if (node) slotRefs.current.set(channel.id, node);
                else slotRefs.current.delete(channel.id);
            }}
        >
            <ChannelStrip
                stripRef={(node) => {
                    if (node) stripRefs.current.set(channel.id, node);
                    else stripRefs.current.delete(channel.id);
                }}
                channel={channel}
                playing={isPlaying}
                analyser={getAnalyser(channel.id)}
                dimmed={channel.muted || (anySolo && !channel.solo)}
                rackOpen={expandedIds.includes(channel.id)}
                canRemove={channels.length > 1}
                faderHeight={faderHeight}
                routeColor={colorOf(channel.id)}
                routeTarget={isRouteTarget(channel.id)}
                dragging={dragId !== null && (dragId === channel.id || selectedIds.includes(channel.id))}
                selected={selectedIds.includes(channel.id)}
                ctrlReady={ctrlDown}
                selectMode={shiftDown}
                pinned={pinnedSetRef.current.has(channel.id)}
                incoming={incomingOf(channel.id)}
                onSelect={handleChannelSelect(channel.id)}
                onDragStart={startChannelDrag(channel.id)}
                onToggleRack={() => toggleRack(channel.id)}
                onUpdate={updateParamsOf(channel.id)}
                onRename={(label) => (label
                    ? updateChannel(channel.id, { label, customLabel: true })
                    : resetChannelLabel(channel.id))}
                onColor={(color) => setChannelColor(channel.id, color)}
                onLoad={(file) => loadChannelAudio(channel.id, file)}
                onClear={() => clearChannel(channel.id)}
                onRemove={() => removeChannel(channel.id)}
                onSplitDragStart={startSplitDrag}
                onRouteDragStart={startRouteDrag(channel.id)}
                onRemoveRoute={(from) => removeRoute(from, channel.id)}
            />
            {expandedIds.includes(channel.id) && (
                <div className={`mixer-rack-shell ${openingIds.includes(channel.id) ? 'is-opening' : ''} ${ctrlDown ? 'ctrl-ready' : ''} ${shiftDown ? 'select-mode' : ''}`}>
                    <EffectRack
                        channel={channel}
                        onClose={() => setExpandedIds((previous) => previous.filter((id) => id !== channel.id))}
                        onReorderEffects={(effects) => reorderEffects(channel.id, effects)}
                        onRemoveEffects={(effectIds) => removeEffects(channel.id, effectIds)}
                        onSetEffectsEnabled={(effectIds, enabled) => setEffectsEnabled(channel.id, effectIds, enabled)}
                        onUpdateEffect={(effectId, parameters) => updateEffect(channel.id, effectId, parameters)}
                        onUpdateEffectEqBands={(effectId, bands) => updateEffectEqBands(channel.id, effectId, bands)}
                        onUpdateEffectShaperPoints={(effectId, points) => updateEffectShaperPoints(channel.id, effectId, points)}
                        onCopyEffects={(effects, targetChannel, targetIndex) => insertEffectCopies(targetChannel, effects, targetIndex)}
                        selectMode={shiftDown}
                        onFocus={() => setActiveChannelId(channel.id)}
                    />
                </div>
            )}
        </div>
    );

    return (
        <div className="mixer-shell">
            <div className="mixer-card">
                <div className="mixer-toolbar">
                    <div className="mixer-title">
                        混音台
                        <span className="mixer-count">{channels.length} 通道</span>
                    </div>

                    <div className="mixer-transport">
                        <button
                            className="mixer-btn primary"
                            onClick={() => (isPlaying ? pause() : play())}
                            disabled={!hasAudio}
                            title={isPlaying ? '暂停' : '播放'}
                        >
                            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                            {isPlaying ? '暂停' : '播放'}
                        </button>
                        <button className="mixer-btn" onClick={stop} disabled={!hasAudio} title="停止并回到开头">
                            <Square className="w-3.5 h-3.5" />
                        </button>
                        <button
                            className={`mixer-btn ${loop ? 'on' : ''}`}
                            onClick={toggleLoop}
                            title={loop ? '关闭循环播放' : '循环播放'}
                        >
                            <Repeat className="w-3.5 h-3.5" />
                        </button>

                        {/* 分组 / 固定：作用于当前选中的通道 */}
                        <button
                            className={`mixer-btn compact ${groupOpen ? 'on' : ''}`}
                            onClick={() => setGroupOpen((open) => !open)}
                            disabled={!selectedIds.length}
                            title="把选中的通道并成一个分组（G）"
                        >
                            <Layers className="w-3.5 h-3.5" />
                        </button>
                        <button
                            className={`mixer-btn compact ${selectedIds.length && selectedIds.every((id) => pinnedSetRef.current.has(id)) ? 'on' : ''}`}
                            onClick={() => togglePin(selectedIds)}
                            disabled={!selectedIds.length}
                            title="把选中的通道固定在左侧（T）"
                        >
                            <Pin className="w-3.5 h-3.5" />
                        </button>

                        {groupOpen && (
                            <div className="mixer-palette">
                                <span className="mixer-palette-head">分组颜色</span>
                                <div className="mixer-palette-grid">
                                    {CHANNEL_COLORS.map((color) => (
                                        <button
                                            key={color}
                                            className="mixer-palette-dot"
                                            style={{ background: color }}
                                            onClick={() => applyGroup(color)}
                                        />
                                    ))}
                                </div>
                                {selectedIds.some((id) => channels.find((channel) => channel.id === id)?.groupId) && (
                                    <button
                                        className="mixer-palette-reset"
                                        onClick={() => {
                                            ungroupChannels(selectedIds);
                                            setGroupOpen(false);
                                        }}
                                    >
                                        取消分组
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="mixer-time">
                        {formatTime(currentTime)} <span>/ {formatTime(duration)}</span>
                    </div>

                    <div
                        className="mixer-scrub"
                        ref={scrubRef}
                        onPointerDown={(event) => {
                            if (!hasAudio) return;
                            event.currentTarget.setPointerCapture(event.pointerId);
                            beginSeek();
                            seekToClientX(event.clientX, false);
                        }}
                        onPointerMove={(event) => {
                            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                                seekToClientX(event.clientX, false);
                            }
                        }}
                        onPointerUp={(event) => {
                            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                                seekToClientX(event.clientX, true);
                            }
                        }}
                    >
                        <div className="mixer-scrub-track">
                            <div className="mixer-scrub-fill" style={{ width: `${progress * 100}%` }} />
                        </div>
                    </div>

                    {/* 文件名输入与导出按钮连成一体：左半是输入框，右半是按钮 */}
                    <div className="mixer-export">
                        <input
                            className="mixer-export-name"
                            value={exportName}
                            onChange={(event) => setExportName(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') void runExport();
                                if (event.key === 'Escape') setExportName('');
                            }}
                            placeholder="文件名"
                            aria-label="导出文件名"
                            spellCheck={false}
                        />
                        <button
                            className="mixer-btn mixer-export-btn"
                            disabled={!hasAudio || exporting}
                            onClick={runExport}
                            title="导出全部通道的混音"
                        >
                            <Download className="w-3.5 h-3.5" />
                            {exporting ? '导出中…' : '导出 WAV'}
                        </button>
                    </div>
                </div>

                <div className="mixer-strips-wrap" ref={wrapRef}>
                    {/* 固定图层：盖在滚动区左侧，像一块独立的板 */}
                    {pinnedChannels.length > 0 && (
                        <div className="mixer-pinned" ref={pinnedRef}>
                            {pinnedChannels.map(renderSlot)}
                        </div>
                    )}

                    <div
                        className="mixer-strips"
                        ref={stripsRef}
                        onScroll={handleScroll}
                        onPointerDown={(event) => {
                            // 点通道之间的空白也算「点走」：和单击组件同一级的退出方式
                            if (event.target === event.currentTarget) setSelectedIds([]);
                        }}
                        style={pinnedChannels.length ? { paddingLeft: pinnedWidth + 8 } : undefined}
                    >
                        {scrollChannels.map(renderSlot)}

                        <button className="mixer-add" onClick={addChannel} title="新增通道">
                            <Plus className="w-4 h-4" />
                            通道
                        </button>
                    </div>

                    {/* 路由线画在不位移的叠层里：端点直接取通道条的真实位置，滚动 / 拖动时逐帧重画 */}
                    <svg className="mixer-routes">
                        {trails.map((trail) => (
                            <path
                                key={trail.id}
                                ref={(node) => {
                                    if (node) pathsRef.current.set(trail.id, node);
                                    else pathsRef.current.delete(trail.id);
                                }}
                                {...(trail.color ? { stroke: trail.color } : {})}
                                className={`mixer-route-line ${trail.color ? '' : 'is-default'}`}
                            />
                        ))}
                        {routeFrom && tempStart && (
                            <line
                                ref={tempLineRef}
                                x1={tempStart.x}
                                y1={tempStart.y}
                                x2={tempStart.x}
                                y2={tempStart.y}
                                {...(routeTint ? { stroke: routeTint } : {})}
                                className={`mixer-route-temp ${routeTint ? '' : 'is-default'}`}
                            />
                        )}
                    </svg>
                </div>
            </div>

            <div className="mixer-hints">
                {SHORTCUTS.map((item, index) => (
                    <Fragment key={item.key}>
                        {index > 0 && <span className="mixer-hint-sep" />}
                        <span className="mixer-hint">
                            <b>{item.key}</b>
                            {item.label}
                        </span>
                    </Fragment>
                ))}
            </div>
        </div>
    );
};
