import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import * as Tone from 'tone';
import { Pin, SlidersHorizontal, X } from 'lucide-react';
import { DEFAULT_CHANNEL_VOLUME, faderToGain, gainToFader, MixerChannel } from '../../hooks/useMixer';
import { dragBridge } from '../../utils/dragBridge';
import { ValueEdit } from '../UI/ValueEdit';
import { Waveform } from './Waveform';

/**
 * 通道颜色盘：6 × 5 共 30 色，按色相分行、同行明度递减，就近弹出。
 * 色相取自 iOS 系统色（蓝 #007AFF / 青 #30B0C7 / 绿 #34C759 / 靛 #5856D6 / 橙 #FF9500），
 * 明度由 92% 递减到 31%，饱和度浅档淡、中档最纯、深档略收——整条铺色时鲜亮但不刺眼。
 */
export const CHANNEL_COLORS = [
    '#D9E3EC', '#B2C9E1', '#7FABD7', '#468ACE', '#2A70B2', '#1F5384',
    '#CBDEE2', '#A4CDD5', '#74BCC8', '#40A8BA', '#2E8693', '#215F69',
    '#B6D8C3', '#8ECDA5', '#5BC281', '#36A65D', '#257E44', '#18532C',
    '#E2DDEE', '#C2B6E2', '#9B83D8', '#6D4ACF', '#502BB6', '#3A2088',
    '#F4EEE6', '#E9D6BE', '#E0B98A', '#D99B4E', '#CB7D25', '#9C601C',
];

/** #RRGGBB → 相对亮度：决定这块颜色上用深字还是浅字（WCAG 的换算） */
const luminanceOf = (hex: string) => {
    const value = parseInt(hex.replace('#', ''), 16);
    const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
        const unit = channel / 255;
        return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** 通道底色就是色板里那个颜色本身，字色按亮度取深 / 浅，两个主题下都不失真。
 *  分组名的小标签也复用同一套变量，保证「选什么色就是什么色」 */
/** 与 tintStyle 同一套判断：深色底上给浅墨、浅色底上给深墨 */
const inkHexOf = (color: string) => (luminanceOf(color) > 0.19 ? '#1F2418' : '#F7FAF0');

export const tintStyle = (color: string) => ({
    '--strip-tint': color,
    // 0.19 是「深字 / 浅字对比度相等」的分界（相对亮度），不是拍脑袋的阈值
    '--strip-ink-rgb': luminanceOf(color) > 0.19 ? '18, 21, 16' : '250, 252, 246',
} as CSSProperties);

interface ChannelStripProps {
    channel: MixerChannel;
    playing: boolean;
    analyser: Tone.Analyser | null;
    dimmed: boolean;
    rackOpen: boolean;
    canRemove: boolean;
    faderHeight: number;
    /** 该通道作为路由源时的线色，有出线才给 */
    routeColor?: string;
    /** 路由拖拽中且本通道可作为落点 */
    routeTarget: boolean;
    /** 被哪些通道路由进来（含源通道显示名与线色；未上色的通道没有色值，用主题色） */
    incoming: { id: string; from: string; label: string; color?: string }[];
    /** 正在被拖动排序 */
    dragging: boolean;
    /** 已选中（可批量操作） */
    selected: boolean;
    /** 按住了 Shift：整条通道可拖拽 */
    dragReady: boolean;
    /** 按住了 Ctrl：通道参数锁定，只做整体选中 */
    selectMode: boolean;
    /** 已固定在左侧独立图层 */
    pinned: boolean;
    stripRef: (node: HTMLDivElement | null) => void;
    /** 碰一下通道条：选中它，并把侧栏效果器库的投放目标切到本通道 */
    onSelect: (event: React.PointerEvent) => void;
    /** 按住 Shift 在通道条任意位置按下 → 开始拖动排序 */
    onDragStart: (event: React.PointerEvent) => void;
    onToggleRack: () => void;
    onUpdate: (patch: Partial<MixerChannel>) => void;
    onRename: (label: string) => void;
    onColor: (color: string | null) => void;
    onLoad: (file: File) => void;
    onClear: () => void;
    onRemove: () => void;
    onSplitDragStart: (event: React.PointerEvent) => void;
    onRouteDragStart: (event: React.PointerEvent) => void;
    onRemoveRoute: (from: string) => void;
}

const formatDb = (gain: number) => (gain <= 0 ? '-∞' : `${(20 * Math.log10(gain)).toFixed(1)}`);

/** 电平表量程下限：-60 dBFS 到底，0 dBFS 封顶 */
const METER_FLOOR_DB = -60;
/** 推子与读数共用的 dB 上下限 */
const FADER_MIN_DB = -60;
const FADER_MAX_DB = 12;

const parseDb = (text: string) => {
    const cleaned = text.replace(/db/gi, '').replace(/−/g, '-').trim();
    if (!cleaned || /^-?∞$/.test(cleaned) || /inf/i.test(cleaned)) return FADER_MIN_DB;
    const value = Number(cleaned);
    return Number.isFinite(value) ? Math.max(FADER_MIN_DB, Math.min(FADER_MAX_DB, value)) : null;
};

const parsePan = (text: string) => {
    const cleaned = text.trim().toUpperCase().replace('°', '');
    if (cleaned === 'C' || cleaned === 'CENTER') return 0;
    const sided = /^([LR])\s*(\d+(?:\.\d+)?)$/.exec(cleaned);
    if (sided) {
        const amount = Math.min(100, Number(sided[2])) / 100;
        return sided[1] === 'L' ? -amount : amount;
    }
    const value = Number(cleaned);
    return Number.isFinite(value) ? Math.max(-1, Math.min(1, value / 100)) : null;
};

export const ChannelStrip = ({
    channel,
    playing,
    analyser,
    dimmed,
    rackOpen,
    canRemove,
    faderHeight,
    routeColor,
    routeTarget,
    incoming,
    dragging,
    selected,
    dragReady,
    selectMode,
    pinned,
    stripRef,
    onSelect,
    onDragStart,
    onToggleRack,
    onUpdate,
    onRename,
    onColor,
    onLoad,
    onClear,
    onRemove,
    onSplitDragStart,
    onRouteDragStart,
    onRemoveRoute,
}: ChannelStripProps) => {
    const fileRef = useRef<HTMLInputElement>(null);
    const faderRef = useRef<HTMLDivElement>(null);
    const meterRef = useRef<HTMLDivElement>(null);
    const ledRef = useRef<HTMLSpanElement>(null);
    const panRef = useRef<HTMLDivElement>(null);
    const colorRef = useRef<HTMLDivElement>(null);
    const [dragOver, setDragOver] = useState(false);
    const [renaming, setRenaming] = useState(false);
    const [draft, setDraft] = useState(channel.label);
    const [colorOpen, setColorOpen] = useState(false);

    // 电平表：峰值 dBFS，-60 dB 到底、0 dBFS 封顶；超过 0 dB 时削波灯实时跟随
    useEffect(() => {
        const meter = meterRef.current;
        if (!meter) return;
        if (!playing || !analyser || dimmed) {
            meter.style.clipPath = 'inset(100% 0 0 0)';
            ledRef.current?.classList.remove('on');
            return;
        }
        let raf = 0;
        let smoothed = METER_FLOOR_DB;
        /** 削波灯保持到这一刻，避免逐帧闪烁 */
        let clipUntil = 0;
        const loop = () => {
            const data = analyser.getValue() as Float32Array;
            let peak = 0;
            for (let i = 0; i < data.length; i++) {
                const value = Math.abs(data[i]);
                if (value > peak) peak = value;
            }
            const db = 20 * Math.log10(Math.max(peak, 1e-5));
            const target = Math.max(METER_FLOOR_DB, Math.min(0, db));
            // 快起慢落：上升即时跟随，回落按比例收敛
            smoothed = target > smoothed ? target : smoothed + (target - smoothed) * 0.12;
            const ratio = (smoothed - METER_FLOOR_DB) / -METER_FLOOR_DB;
            meter.style.clipPath = `inset(${((1 - ratio) * 100).toFixed(2)}% 0 0 0)`;
            if (peak >= 1) clipUntil = performance.now() + 140;
            ledRef.current?.classList.toggle('on', performance.now() < clipUntil);
            raf = requestAnimationFrame(loop);
        };
        loop();
        return () => cancelAnimationFrame(raf);
    }, [analyser, playing, dimmed]);

    // 颜色盘：点别处就收起
    useEffect(() => {
        if (!colorOpen) return;
        const close = (event: PointerEvent) => {
            if (colorRef.current?.contains(event.target as Node)) return;
            setColorOpen(false);
        };
        window.addEventListener('pointerdown', close);
        return () => window.removeEventListener('pointerdown', close);
    }, [colorOpen]);

    const setVolumeFromClientY = (clientY: number) => {
        const rect = faderRef.current?.getBoundingClientRect();
        if (!rect) return;
        const ratio = 1 - (clientY - rect.top) / rect.height;
        onUpdate({ volume: faderToGain(ratio) });
    };

    const setPanFromClientX = (clientX: number) => {
        const rect = panRef.current?.getBoundingClientRect();
        if (!rect) return;
        const ratio = (clientX - rect.left) / rect.width;
        onUpdate({ pan: Math.max(-1, Math.min(1, ratio * 2 - 1)) });
    };

    const volumeRatio = gainToFader(channel.volume);
    const panRatio = (channel.pan + 1) / 2;
    const loaded = channel.duration > 0;
    const volumeDb = channel.volume <= 0 ? FADER_MIN_DB : Math.max(FADER_MIN_DB, 20 * Math.log10(channel.volume));

    return (
        <div
            ref={stripRef}
            data-channel-id={channel.id}
            className={`mixer-strip ${dragOver ? 'drag-over' : ''} ${dimmed ? 'dimmed' : ''} ${routeTarget ? 'route-target' : ''} ${dragging ? 'dragging' : ''} ${selected ? 'selected' : ''} ${dragReady ? 'drag-ready' : ''} ${selectMode ? 'select-mode' : ''} ${channel.color ? 'tinted' : ''} ${pinned ? 'pinned' : ''}`}
            style={channel.color ? tintStyle(channel.color) : undefined}
            onPointerDown={(event) => {
                // 按住 Shift / Ctrl：整条通道就是一个判定区，子控件的指针事件由 CSS 全部关掉，
                // 这里只管「整体选中 / 整体拖动」
                if (selectMode || dragReady) {
                    onSelect(event);
                    if (dragReady) onDragStart(event);
                    return;
                }
                // 各种按钮与轨道自己处理指针：只按通道本体才算选中 / 拖动
                const hit = (event.target as HTMLElement).closest('button, input, .strip-fader, .strip-pan-track, .strip-split, .strip-colors');
                if (hit) return;
                onSelect(event);
                onDragStart(event);
            }}
            onDragOver={(event) => {
                // 系统文件走 dataTransfer；左侧文件浏览器拖来的 File 只存在 dragBridge 里
                if (!event.dataTransfer.types.includes('Files') && !dragBridge.peek()) return;
                event.preventDefault();
                setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
                setDragOver(false);
                const bridged = dragBridge.peek();
                if (!event.dataTransfer.types.includes('Files') && !bridged) return;
                event.preventDefault();
                const file = event.dataTransfer.files?.[0] ?? bridged;
                if (file) onLoad(file);
            }}
        >
            <div className="strip-head">
                {!renaming && (
                    <button
                        className="strip-dot"
                        style={{ background: channel.color ?? 'transparent' }}
                        onClick={() => setColorOpen((open) => !open)}
                        title="通道颜色"
                    />
                )}
                {renaming ? (
                    <input
                        className="strip-rename"
                        autoFocus
                        value={draft}
                        spellCheck={false}
                        onChange={(event) => setDraft(event.target.value)}
                        onFocus={(event) => event.currentTarget.select()}
                        onPointerDown={(event) => event.stopPropagation()}
                        onBlur={() => {
                            setRenaming(false);
                            const name = draft.trim();
                            // 留空就交还给自动编号（CH n 跟着位置走）
                            if (name !== channel.label) onRename(name);
                        }}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') event.currentTarget.blur();
                            if (event.key === 'Escape') {
                                setDraft(channel.label);
                                setRenaming(false);
                            }
                        }}
                    />
                ) : (
                    <span
                        className={`strip-label ${channel.label.length > 9 ? 'is-long' : ''}`}
                        title={`${channel.label} · 单击改名`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => {
                            setDraft(channel.label);
                            setRenaming(true);
                        }}
                    >
                        {channel.label}
                    </span>
                )}
                {!renaming && pinned && <Pin className="strip-pin" />}
                {!renaming && canRemove && (
                    <button className="strip-kill" onClick={onRemove} title="移除通道">
                        <X className="w-3 h-3" />
                    </button>
                )}
            </div>

            {colorOpen && (
                <div className="strip-colors" ref={colorRef} onPointerDown={(event) => event.stopPropagation()}>
                    {CHANNEL_COLORS.map((color) => (
                        <button
                            key={color}
                            className={`strip-color-swatch ${channel.color === color ? 'on' : ''}`}
                            style={{ background: color }}
                            onClick={() => {
                                onColor(color);
                                setColorOpen(false);
                            }}
                        />
                    ))}
                    <button
                        className="strip-colors-reset"
                        onClick={() => {
                            onColor(null);
                            setColorOpen(false);
                        }}
                    >
                        默认
                    </button>
                </div>
            )}

            <div
                className={`strip-track ${loaded ? '' : 'empty'}`}
                title={channel.trackName}
            >
                {loaded ? channel.trackName : '未加载音频'}
            </div>

            <div
                className="strip-wave"
                onClick={() => fileRef.current?.click()}
                title={loaded ? '点击替换音频，或直接拖入文件' : '点击加载音频，或直接拖入文件'}
            >
                <Waveform
                    analyser={analyser}
                    playing={playing}
                    resetKey={`${channel.trackName}|${channel.duration}`}
                    inkColor={channel.color ? inkHexOf(channel.color) : undefined}
                />
                {!loaded && !playing && <span className="strip-wave-hint">点击或拖入音频</span>}
                {loaded && (
                    <button
                        className="strip-wave-clear"
                        onClick={(event) => {
                            event.stopPropagation();
                            onClear();
                        }}
                        title="清空该通道音频"
                    >
                        <X className="w-3 h-3" />
                    </button>
                )}
            </div>

            <div
                className="strip-split"
                onPointerDown={onSplitDragStart}
                title="拖动调整波形与推子的比例"
            >
                <span />
            </div>

            <div className="strip-fader-area" style={{ height: faderHeight }}>
                <div
                    className="strip-fader"
                    ref={faderRef}
                    onPointerDown={(event) => {
                        event.currentTarget.setPointerCapture(event.pointerId);
                        setVolumeFromClientY(event.clientY);
                    }}
                    onPointerMove={(event) => {
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                            setVolumeFromClientY(event.clientY);
                        }
                    }}
                    onDoubleClick={() => onUpdate({ volume: DEFAULT_CHANNEL_VOLUME })}
                    title="拖动调整音量，双击回到 0 dB"
                >
                    <span className="strip-fader-fill" style={{ height: `${volumeRatio * 100}%` }} />
                    <span className="strip-fader-cap" style={{ bottom: `${volumeRatio * 100}%` }} />
                </div>
                <div className="strip-meter-col">
                    <span className="strip-clip" ref={ledRef} title="削波指示（超过 0 dBFS 时亮）" />
                    <div className="strip-meter">
                        <div className="strip-meter-level" ref={meterRef} />
                    </div>
                </div>
            </div>

            <div className="strip-db">
                <ValueEdit
                    className="value-text"
                    display={`${formatDb(channel.volume)} dB`}
                    editText={volumeDb.toFixed(1)}
                    value={volumeDb}
                    min={FADER_MIN_DB}
                    max={FADER_MAX_DB}
                    step={0.5}
                    parse={parseDb}
                    onChange={(db) => onUpdate({ volume: db <= FADER_MIN_DB ? 0 : 10 ** (db / 20) })}
                    title="双击输入音量（dB）"
                    width={38}
                />
            </div>

            <div className="strip-pan">
                <div className="strip-pan-head">
                    <span>声像</span>
                    <ValueEdit
                        className="value-text"
                        display={channel.pan === 0 ? 'C' : `${channel.pan > 0 ? 'R' : 'L'}${Math.round(Math.abs(channel.pan) * 100)}`}
                        editText={String(Math.round(channel.pan * 100))}
                        value={channel.pan}
                        min={-1}
                        max={1}
                        step={0.01}
                        parse={parsePan}
                        onChange={(pan) => onUpdate({ pan })}
                        title="双击输入声像（-100 ~ 100，C 居中）"
                        width={34}
                    />
                </div>
                <div
                    className="strip-pan-track"
                    ref={panRef}
                    onPointerDown={(event) => {
                        event.currentTarget.setPointerCapture(event.pointerId);
                        setPanFromClientX(event.clientX);
                    }}
                    onPointerMove={(event) => {
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                            setPanFromClientX(event.clientX);
                        }
                    }}
                    onDoubleClick={() => onUpdate({ pan: 0 })}
                    title="拖动调整声像，双击回到居中"
                >
                    <span className="strip-pan-center" />
                    <span className="strip-pan-dot" style={{ left: `${panRatio * 100}%` }} />
                </div>
            </div>

            <div className="strip-buttons">
                <button
                    className={`strip-toggle ${channel.bypassed ? 'on-bypass' : ''}`}
                    onClick={() => onUpdate({ bypassed: !channel.bypassed })}
                    title="旁通该通道全部效果器"
                >
                    BYP
                </button>
                <button
                    className={`strip-toggle ${channel.muted ? 'on-mute' : ''}`}
                    onClick={() => onUpdate({ muted: !channel.muted })}
                    title="静音"
                >
                    M
                </button>
                <button
                    className={`strip-toggle ${channel.solo ? 'on-solo' : ''}`}
                    onClick={() => onUpdate({ solo: !channel.solo })}
                    title="独奏"
                >
                    S
                </button>
            </div>

            <button
                className={`strip-rack-btn ${rackOpen ? 'open' : ''}`}
                onClick={onToggleRack}
                title="展开效果器链"
            >
                <SlidersHorizontal className="w-4 h-4" />
                {channel.effects.length ? `效果器 · ${channel.effects.length}` : '效果器'}
            </button>

            <div className="strip-routes" title="路由进本通道的来源">
                <div className="strip-routes-head">
                    <span>输入</span>
                    <span>{incoming.length}</span>
                </div>
                <div className="strip-routes-list">
                    {incoming.length === 0 ? (
                        <span className="strip-routes-empty">无</span>
                    ) : (
                        incoming.map((route) => (
                            <div className="strip-route-item" key={route.id}>
                                <span className="strip-route-swatch" style={{ background: route.color ?? 'var(--text)' }} />
                                <span className="strip-route-from">{route.label}</span>
                                <button
                                    className="strip-route-kill"
                                    onClick={() => onRemoveRoute(route.from)}
                                    title={`断开 ${route.label} → 本通道`}
                                >
                                    <X className="w-2.5 h-2.5" />
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>

            <div className="strip-route">
                <button
                    className={`strip-route-dot ${routeColor ? 'linked' : ''}`}
                    style={routeColor ? { background: routeColor, boxShadow: `0 0 8px ${routeColor}` } : undefined}
                    onPointerDown={onRouteDragStart}
                    title="拖到其他通道建立路由；连点两下断开本通道全部出线"
                />
            </div>

            <input
                ref={fileRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onLoad(file);
                    event.target.value = '';
                }}
            />
        </div>
    );
};
