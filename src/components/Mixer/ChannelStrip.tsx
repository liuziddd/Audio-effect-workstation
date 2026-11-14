import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import * as Tone from 'tone';
import { Pin, SlidersHorizontal, X } from 'lucide-react';
import { DEFAULT_CHANNEL_VOLUME, faderToGain, gainToFader, MixerChannel } from '../../hooks/useMixer';
import { dragBridge } from '../../utils/dragBridge';
import { ValueEdit } from '../UI/ValueEdit';
import { Waveform } from './Waveform';

/** 通道颜色盘：6 × 5 共 30 色，按色相分行、同行明度递减，就近弹出 */
export const CHANNEL_COLORS = [
    '#E2FFA0', '#C6FF4D', '#A6FF00', '#7ACC00', '#4F8A00', '#2C4F00',
    '#B8FBF0', '#7BE8DC', '#3FD2C4', '#12A99E', '#0A7A72', '#064A46',
    '#C9DBFF', '#93B7FF', '#5B7BFF', '#3A55D6', '#27379B', '#161F5C',
    '#E5C9FF', '#C79BFF', '#A46BFF', '#FF7AB6', '#E0457F', '#8B1F4A',
    '#FFE2A8', '#FFC53D', '#FF9F45', '#FF6B61', '#D63B32', '#7A1C17',
];

/** #RRGGBB → "r, g, b"，通道整条底色的透明度由 CSS 控制 */
const rgbOf = (hex: string) => {
    const value = parseInt(hex.replace('#', ''), 16);
    return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
};

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
    /** 按住了 Ctrl：整条通道可拖拽 */
    ctrlReady: boolean;
    /** 按住了 Shift：通道参数锁定，只做整体选中 */
    selectMode: boolean;
    /** 已固定在左侧独立图层 */
    pinned: boolean;
    stripRef: (node: HTMLDivElement | null) => void;
    /** 碰一下通道条：选中它，并把侧栏效果器库的投放目标切到本通道 */
    onSelect: (event: React.PointerEvent) => void;
    /** 按住 Ctrl 在通道条任意位置按下 → 开始拖动排序 */
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
    ctrlReady,
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
            className={`mixer-strip ${dragOver ? 'drag-over' : ''} ${dimmed ? 'dimmed' : ''} ${routeTarget ? 'route-target' : ''} ${dragging ? 'dragging' : ''} ${selected ? 'selected' : ''} ${ctrlReady ? 'ctrl-ready' : ''} ${selectMode ? 'select-mode' : ''} ${channel.color ? 'tinted' : ''} ${pinned ? 'pinned' : ''}`}
            style={channel.color ? ({ '--strip-tint-rgb': rgbOf(channel.color) } as CSSProperties) : undefined}
            onPointerDown={(event) => {
                // 按住 Ctrl / Shift：整条通道就是一个判定区，子控件的指针事件由 CSS 全部关掉，
                // 这里只管「整体选中 / 整体拖动」
                if (selectMode || ctrlReady) {
                    onSelect(event);
                    if (ctrlReady) onDragStart(event);
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
