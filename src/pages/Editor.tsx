import { useState, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, FileAudio, FolderOpen, X, Sparkles, Wrench, Music4 } from 'lucide-react';
import { FileBrowser } from '../components/FileBrowser';
import { AudioInspector } from '../components/AudioInspector';
import { AutoMaster } from '../components/AutoMaster';
import { Mixer } from '../components/Mixer';
import { EffectLibrary } from '../components/EffectLibrary';
import { ProgressionLab } from '../components/ProgressionLab';
import { WaveBackground } from '../components/effects/WaveBackground';
import { useMixer } from '../hooks/useMixer';
import { useIsMobile } from '../hooks/useIsMobile';
import './Editor.css';

const StemSeparator = lazy(() => import('../components/StemSeparator'));

type ToolId = 'inspector' | 'separator' | 'master' | 'generator' | null;

const TOOLS = [
    { id: 'inspector' as const, label: '音频检测', icon: <Search className="w-4 h-4 flex-shrink-0" /> },
    { id: 'separator' as const, label: 'AI 音轨分离', icon: <FileAudio className="w-4 h-4 flex-shrink-0" /> },
    { id: 'master' as const, label: 'AI 自动母带', icon: <Sparkles className="w-4 h-4 flex-shrink-0" /> },
    { id: 'generator' as const, label: 'MIDI 生成', icon: <Music4 className="w-4 h-4 flex-shrink-0" /> },
];

const TOOL_TITLES: Record<Exclude<ToolId, null>, string> = {
    inspector: '🔍 音频检测工具',
    separator: '🎛️ AI 音轨分离',
    master: '✨ AI 自动母带',
    generator: '🎼 MIDI 生成',
};

/** 工具面板：可见内容宽 400，另有 28px 压在侧边栏下方做交叠；藏起来要退到侧边栏右侧以内 */
const PANEL_WIDTH = 400;
const PANEL_OVERLAP = 28;
const PANEL_HIDDEN = -PANEL_WIDTH - 16;

interface EditorProps {
    /** 从首页功能卡片进入时，直接打开对应工具面板 */
    initialTool?: Exclude<ToolId, null>;
}

export const Editor = ({ initialTool }: EditorProps) => {
    const [activeTool, setActiveTool] = useState<ToolId>(initialTool ?? null);
    // 左侧固定侧边栏默认宽度（px）。要改默认宽度，改这里的 240 即可。
    const [leftWidth, setLeftWidth] = useState(240);
    // 「本地文件」区高度，可由中间分割线拖动，与下方工具栏此消彼长
    const [fileSectionHeight, setFileSectionHeight] = useState(() =>
        Math.min(window.innerHeight * 0.34, 320)
    );
    // 效果器库区高度，由它与工具栏之间的分割线拖动。
    // 默认把剩余空间全给它，上面「实用工具」保持刚好放得下四个按钮（约 228px）
    const [libraryHeight, setLibraryHeight] = useState(() =>
        Math.max(110, window.innerHeight - Math.min(window.innerHeight * 0.34, 320) - 345)
    );

    /** 手机上换成精简布局：只留实用工具入口，混音台与效果器库留给 PC */
    const isMobile = useIsMobile();

    /** 混音台的数据与操作放在页面层：侧栏的效果器库要往混音台里加效果器 */
    const mixer = useMixer(8);
    const libraryTarget = mixer.channels.find((channel) => channel.id === mixer.activeChannelId) ?? mixer.channels[0];

    // 侧边栏窄于该阈值时，文字折叠消失、只保留图标
    const collapsed = leftWidth < 140;

    const toggleTool = (id: Exclude<ToolId, null>) => {
        setActiveTool((prev) => (prev === id ? null : id));
    };

    const startResize = (e: React.MouseEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = leftWidth;
        const onMove = (ev: MouseEvent) => {
            // 左侧栏可调宽度范围：78 ~ 280px
            setLeftWidth(Math.min(280, Math.max(78, startWidth + (ev.clientX - startX))));
        };
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    const startSplitResize = (e: React.PointerEvent) => {
        e.preventDefault();
        const startY = e.clientY;
        const startHeight = fileSectionHeight;
        const onMove = (ev: PointerEvent) => {
            // 给下方工具栏至少留 190px，给文件区至少留 120px
            const max = window.innerHeight - 190;
            setFileSectionHeight(Math.min(max, Math.max(120, startHeight + (ev.clientY - startY))));
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
    };

    /** 效果器库与实用工具之间的分割线：往上拖库变高、往下拖库变矮 */
    const startLibraryResize = (e: React.PointerEvent) => {
        e.preventDefault();
        const startY = e.clientY;
        const startHeight = libraryHeight;
        const onMove = (ev: PointerEvent) => {
            const max = Math.max(160, window.innerHeight - fileSectionHeight - 250);
            setLibraryHeight(Math.min(max, Math.max(130, startHeight - (ev.clientY - startY))));
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
    };

    return (
        <div
            className={`editor-scope min-h-screen font-sans overflow-x-hidden ${isMobile ? 'is-mobile' : ''}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => e.preventDefault()}
        >
            {/* 背景：实时波动的拓扑等高线 */}
            <WaveBackground />

            {/* 手机端：只留四个实用工具入口，混音台与效果器库留给 PC */}
            <div className="editor-mobile" style={{ display: isMobile ? 'flex' : 'none' }}>
                <div className="editor-mobile-head">
                    <Wrench className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>实用工具</span>
                </div>
                <div className="editor-mobile-grid">
                    {TOOLS.map((tool) => (
                        <button
                            key={tool.id}
                            onClick={() => toggleTool(tool.id)}
                            className={`editor-mobile-tool ${activeTool === tool.id ? 'is-active' : ''}`}
                        >
                            <span className="rail-tool-tile">{tool.icon}</span>
                            <span>{tool.label}</span>
                        </button>
                    ))}
                </div>
                <p className="editor-mobile-note">完整功能请在 PC 查看</p>
            </div>

            {/* 左侧固定侧边栏（非收纳、可调宽），上中下三段 */}
            <div
                className="side-rail fixed left-0 top-0 h-full z-40 border-r border-white/10 flex-col overflow-hidden rounded-tr-3xl"
                style={{ width: leftWidth, display: isMobile ? 'none' : 'flex' }}
            >
                {/* 上段：页面切换按钮 + 主题开关（全局浮层），标题在图标下方；分割线随之下移 */}
                <div className="flex-shrink-0 border-b border-white/10 px-4 pt-4 pb-3 flex flex-col gap-2">
                    <div className="h-11" />
                    <span
                        className={`text-sm font-semibold tracking-[0.18em] whitespace-nowrap overflow-hidden text-white transition-all duration-200 ${
                            collapsed ? 'max-w-0 opacity-0' : 'opacity-100'
                        }`}
                    >
                        声屿
                    </span>
                </div>

                {/* 中段：本地文件浏览器，高度由下方分割线拖动控制 */}
                <div className="flex-shrink-0 flex flex-col overflow-hidden" style={{ height: fileSectionHeight }}>
                    <div className="px-3 pt-3 pb-2 flex items-center gap-1.5 flex-shrink-0">
                        <FolderOpen className="w-3.5 h-3.5 text-white/60 flex-shrink-0" />
                        <span
                            className={`text-xs font-semibold text-white/60 uppercase tracking-wider whitespace-nowrap overflow-hidden transition-all duration-200 ${
                                collapsed ? 'max-w-0 opacity-0' : 'opacity-100'
                            }`}
                        >
                            本地文件
                        </span>
                    </div>
                    <div className="flex-1 min-h-0 flex flex-col px-3 pb-3">
                        <FileBrowser />
                    </div>
                </div>

                {/* 可拖拽的水平分割线：调整「本地文件」与「实用工具」两块的分割高度 */}
                <div
                    className="h-2 flex-shrink-0 cursor-row-resize group relative"
                    onPointerDown={startSplitResize}
                    title="拖动调整上下两块高度"
                >
                    <span className="absolute inset-x-3 top-1/2 -translate-y-1/2 h-px bg-white/10 group-hover:bg-[var(--accent)] transition-colors" />
                </div>

                {/* 下段：实用工具栏（带标题），剩余空间留给效果器库 */}
                <div className="px-3 pt-2 pb-1 flex-1 min-h-0 flex flex-col overflow-y-auto">
                    <div className={`flex items-center gap-1.5 mb-2 flex-shrink-0 ${collapsed ? 'justify-center' : ''}`}>
                        <Wrench className="w-3.5 h-3.5 text-white/60 flex-shrink-0" />
                        <span className={`text-xs font-semibold text-white/60 uppercase tracking-wider whitespace-nowrap overflow-hidden ${collapsed ? 'max-w-0 opacity-0' : 'opacity-100'}`}>
                            实用工具
                        </span>
                    </div>
                    <div className="flex flex-col gap-2">
                        {TOOLS.map((tool) => (
                            <button
                                key={tool.id}
                                onClick={() => toggleTool(tool.id)}
                                title={tool.label}
                                className={`rail-tool ${collapsed ? 'is-collapsed' : ''} ${
                                    activeTool === tool.id ? 'is-active' : ''
                                }`}
                            >
                                <span className="rail-tool-tile">{tool.icon}</span>
                                {!collapsed && <span className="rail-tool-label">{tool.label}</span>}
                            </button>
                        ))}
                    </div>
                </div>

                {/* 效果器库：和「实用工具」之间用同样的分割线调高度 */}
                {!collapsed && (
                    <>
                        <div
                            className="rail-split flex-shrink-0"
                            onPointerDown={startLibraryResize}
                            title="拖动调整效果器库的高度"
                        >
                            <span />
                        </div>
                        <div className="rail-library" style={{ height: libraryHeight }}>
                            <div className="rail-library-head">
                                <span>效果器库</span>
                                <span className="rail-library-target">{libraryTarget.label}</span>
                            </div>
                            <div className="rail-library-body">
                                <EffectLibrary
                                    onAddEffect={(type, channelId) => mixer.addEffect(channelId ?? libraryTarget.id, type)}
                                />
                            </div>
                        </div>
                    </>
                )}

                {/* 拖拽调宽手柄 */}
                <div
                    className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-neon-green/60 transition-colors"
                    onMouseDown={startResize}
                />
            </div>

            {/* 工具面板：从左侧栏后方滑出，停在略微压住侧边栏的位置（z 比侧边栏低才会被它挡住） */}
            <AnimatePresence>
                {activeTool && (
                    <motion.div
                        className="tool-panel fixed top-0 h-full z-30 border-r border-white/10 overflow-hidden rounded-tr-3xl"
                        style={{
                            left: isMobile ? 0 : leftWidth - PANEL_OVERLAP,
                            width: isMobile ? '100vw' : PANEL_WIDTH + PANEL_OVERLAP,
                            paddingLeft: isMobile ? 0 : PANEL_OVERLAP,
                        }}
                        initial={isMobile ? { y: '100%' } : { x: PANEL_HIDDEN }}
                        animate={isMobile ? { y: 0 } : { x: 0 }}
                        exit={isMobile ? { y: '100%' } : { x: PANEL_HIDDEN }}
                        transition={{ type: 'spring', stiffness: 280, damping: 26, mass: 0.85 }}
                    >
                        <div className="tool-panel-head relative z-10 flex items-center justify-between px-4 py-3 border-b border-white/10">
                            <h3 className="text-sm font-semibold text-white">{TOOL_TITLES[activeTool]}</h3>
                            <button
                                onClick={() => setActiveTool(null)}
                                className="text-white/70 hover:text-white p-1"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="tool-panel-body relative z-10 p-4 overflow-y-auto" style={{ height: 'calc(100% - 49px)' }}>
                            {activeTool === 'inspector' ? (
                                <AudioInspector />
                            ) : activeTool === 'master' ? (
                                <AutoMaster />
                            ) : activeTool === 'generator' ? (
                                <ProgressionLab />
                            ) : (
                                <Suspense fallback={<div className="text-center p-8 text-white/60">正在加载分离引擎…</div>}>
                                    <StemSeparator />
                                </Suspense>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* 中间主工作区：混音台大卡片铺满 */}
            <div
                className="relative z-10 min-h-screen transition-[margin-left] duration-200"
                style={{ marginLeft: leftWidth, display: isMobile ? 'none' : 'block' }}
            >
                <div className="px-8 pt-8 pb-3">
                    <Mixer mixer={mixer} />
                </div>
            </div>
        </div>
    );
};
