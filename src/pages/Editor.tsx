import { useState, useEffect, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as Tone from 'tone';
import { Search, FileAudio, FolderOpen, X, SlidersHorizontal, Sparkles, Wrench } from 'lucide-react';
import { useAudioWithEffects } from '../hooks/useAudioWithEffects';
import { AudioUpload } from '../components/AudioUpload';
import { EffectLibrary } from '../components/EffectLibrary';
import { EffectChain } from '../components/EffectChain';
import { SimpleAudioPlayer } from '../components/SimpleAudioPlayer';
import { AudioExport } from '../components/AudioExport';
import { FileBrowser } from '../components/FileBrowser';
import { AudioInspector } from '../components/AudioInspector';
import { AutoMaster } from '../components/AutoMaster';
import { AudioFile } from '../types/audio';
import { WaveBackground } from '../components/effects/WaveBackground';

const StemSeparator = lazy(() => import('../components/StemSeparator'));

type ToolId = 'inspector' | 'separator' | 'master' | null;

// 效果器库：漏出的玻璃手柄宽度 + 完整面板宽度
const LIBRARY_BAR_WIDTH = 36;
const LIBRARY_PANEL_WIDTH = 236;

// 银灰玻璃面板：半透明低饱和深灰 + 强模糊（配合银灰黑背景）
const GLASS_BG = 'var(--glass)';
const GLASS_BLUR = 'blur(30px) saturate(140%)';

const TOOLS = [
    { id: 'inspector' as const, label: '音频检测', icon: <Search className="w-4 h-4 flex-shrink-0" /> },
    { id: 'separator' as const, label: 'AI 音轨分离', icon: <FileAudio className="w-4 h-4 flex-shrink-0" /> },
    { id: 'master' as const, label: 'AI 自动母带', icon: <Sparkles className="w-4 h-4 flex-shrink-0" /> },
];

const TOOL_TITLES: Record<Exclude<ToolId, null>, string> = {
    inspector: '🔍 音频检测工具',
    separator: '🎛️ AI 音轨分离',
    master: '✨ AI 自动母带',
};

export const Editor = () => {
    const [audioFile, setAudioFile] = useState<AudioFile | null>(null);
    const [hasAudioBuffer, setHasAudioBuffer] = useState(false);
    const [activeTool, setActiveTool] = useState<ToolId>(null);
    const [libraryOpen, setLibraryOpen] = useState(false);
    // 左侧固定侧边栏默认宽度（px）。要改默认宽度，改这里的 240 即可。
    const [leftWidth, setLeftWidth] = useState(240);

    // 侧边栏窄于该阈值时，文字折叠消失、只保留图标
    const collapsed = leftWidth < 140;

    const {
        isPlaying,
        isLoaded,
        currentTime,
        duration,
        volume,
        effects,
        play,
        pause,
        stop,
        beginSeek,
        previewSeek,
        seek,
        setVolume,
        loadAudio,
        clearAudio,
        addEffect,
        removeEffect,
        toggleEffect,
        updateEffect,
        updateEffectEqBands,
        updateEffectShaperPoints,
        reorderEffects,
        exportAudio,
    } = useAudioWithEffects();

    const playerControls = {
        isPlaying, isLoaded, currentTime, duration, volume,
        play, pause, stop, beginSeek, previewSeek, seek, setVolume, exportAudio,
    };

    const loadAudioFile = (file: File) => {
        if (!file) return;
        setAudioFile({ file, name: file.name, size: file.size, url: URL.createObjectURL(file), duration: 0 });
        setHasAudioBuffer(false);
    };

    const clearAudioFile = () => {
        if (audioFile?.url) URL.revokeObjectURL(audioFile.url);
        setAudioFile(null);
    };

    const replaceAudio = (file: File) => {
        clearAudio();
        clearAudioFile();
        setHasAudioBuffer(false);
        loadAudioFile(file);
    };

    const handleClearAudio = () => {
        clearAudio();
        clearAudioFile();
        setHasAudioBuffer(false);
    };

    // 拖拽效果器时收起库面板：展开的面板会盖住效果器链这个投放目标
    useEffect(() => {
        const close = () => setLibraryOpen(false);
        window.addEventListener('effectdragstart', close);
        window.addEventListener('effectdragend', close);
        return () => {
            window.removeEventListener('effectdragstart', close);
            window.removeEventListener('effectdragend', close);
        };
    }, []);

    useEffect(() => {
        if (audioFile && !hasAudioBuffer) {
            const convertToAudioBuffer = async () => {
                if (Tone.context.state !== 'running') await Tone.start();
                const buffer = await Tone.ToneAudioBuffer.fromUrl(audioFile.url);
                const audioBuffer = buffer.get()!;
                setAudioFile((prev) => (prev ? { ...prev, duration: audioBuffer.duration } : null));
                loadAudio(audioBuffer, audioBuffer.duration);
                setHasAudioBuffer(true);
            };
            convertToAudioBuffer();
        }
    }, [audioFile, hasAudioBuffer, loadAudio]);

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

    return (
        <div
            className="editor-scope min-h-screen font-sans overflow-x-hidden"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => e.preventDefault()}
        >
            {/* 背景：实时波动的拓扑等高线 */}
            <WaveBackground />

            {/* 左侧固定侧边栏（非收纳、可调宽），上中下三段 */}
            <div
                className="fixed left-0 top-0 h-full z-40 border-r border-white/10 flex flex-col overflow-hidden rounded-tr-2xl"
                style={{ width: leftWidth, background: GLASS_BG, backdropFilter: GLASS_BLUR, WebkitBackdropFilter: GLASS_BLUR, boxShadow: '14px 0 42px rgba(0,0,0,0.45)' }}
            >
                {/* 上段：页面切换按钮 + 主题开关（全局浮层），标题在图标下方；分割线随之下移 */}
                <div className="flex-shrink-0 border-b border-white/10 px-4 pt-4 pb-3 flex flex-col gap-2">
                    <div className="h-11" />
                    <span
                        className={`text-sm font-semibold tracking-wide whitespace-nowrap overflow-hidden text-white transition-all duration-200 ${
                            collapsed ? 'max-w-0 opacity-0' : 'opacity-100'
                        }`}
                    >
                        音频效果工作站
                    </span>
                </div>

                {/* 中段：本地文件浏览器（高度受限，让下方工具栏上移） */}
                <div className="flex-shrink-0 flex flex-col overflow-hidden" style={{ height: 'min(38vh, 320px)' }}>
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

                {/* 下段：实用工具栏（带标题），紧跟文件区，剩余空间留在底部 */}
                <div className="px-3 pt-3 pb-3 border-t border-white/10 flex-shrink-0">
                    <div className={`flex items-center gap-1.5 mb-2 ${collapsed ? 'justify-center' : ''}`}>
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
                                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                                    collapsed ? 'justify-center px-0' : ''
                                } ${
                                    activeTool === tool.id
                                        ? 'bg-[#5B7BFF] text-white'
                                        : 'text-white/60 hover:bg-[var(--border)]'
                                }`}
                            >
                                {tool.icon}
                                {!collapsed && <span className="whitespace-nowrap">{tool.label}</span>}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex-1 min-h-0" />

                {/* 拖拽调宽手柄 */}
                <div
                    className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-neon-blue/50 transition-colors"
                    onMouseDown={startResize}
                />
            </div>

            {/* 效果器库：藏在侧栏后（景深遮罩），右缘漏出一小条手柄，hover 抽出 */}
            <motion.div
                className="fixed top-0 h-full z-30 flex items-stretch overflow-hidden rounded-tr-2xl"
                style={{
                    left: leftWidth,
                    width: LIBRARY_PANEL_WIDTH,
                    background: 'var(--glass-frost)',
                    backdropFilter: 'blur(24px) saturate(140%)',
                    WebkitBackdropFilter: 'blur(24px) saturate(140%)',
                }}
                initial={false}
                animate={{ x: libraryOpen ? 0 : -(LIBRARY_PANEL_WIDTH - LIBRARY_BAR_WIDTH) }}
                transition={{ type: 'spring', stiffness: 300, damping: 26 }}
                onMouseEnter={() => setLibraryOpen(true)}
                onMouseLeave={() => setLibraryOpen(false)}
            >
                {/* 面板主体（卡片区，藏在侧栏后） */}
                <div className="h-full flex-1 flex flex-col overflow-hidden">
                    <div className="px-4 py-3 border-b border-white/10">
                        <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>🎛️ 效果器库</h3>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3">
                        <EffectLibrary onAddEffect={addEffect} />
                    </div>
                </div>

                {/* 右侧手柄（漏出的触发区）：与面板主体同底色，无缝一体 */}
                <div
                    className="h-full shrink-0 flex flex-col items-center justify-center gap-3 cursor-pointer select-none"
                    style={{
                        width: LIBRARY_BAR_WIDTH,
                        background: 'var(--glass-frost)',
                        backdropFilter: 'blur(24px) saturate(140%)',
                        WebkitBackdropFilter: 'blur(24px) saturate(140%)',
                    }}
                >
                    <SlidersHorizontal className="w-4 h-4" style={{ color: 'var(--text)' }} />
                    <span className="text-xs font-medium tracking-widest" style={{ writingMode: 'vertical-rl', color: 'var(--text)' }}>
                        效果器库
                    </span>
                </div>
            </motion.div>

            {/* 工具面板（紧贴左侧栏弹出，overlay 不挤压中间） */}
            <AnimatePresence>
                {activeTool && (
                    <motion.div
                        className="fixed top-0 h-full z-50 border-r border-white/10 shadow-2xl overflow-hidden rounded-tr-2xl"
                        style={{ left: leftWidth, width: 400, background: GLASS_BG, backdropFilter: GLASS_BLUR, WebkitBackdropFilter: GLASS_BLUR }}
                        initial={{ x: -400, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: -400, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 32 }}
                    >
                        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                            <h3 className="text-sm font-semibold text-white">{TOOL_TITLES[activeTool]}</h3>
                            <button
                                onClick={() => setActiveTool(null)}
                                className="text-white/70 hover:text-white p-1"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="p-4 overflow-y-auto" style={{ height: 'calc(100% - 49px)' }}>
                            {activeTool === 'inspector' ? (
                                <AudioInspector />
                            ) : activeTool === 'master' ? (
                                <AutoMaster audioFile={audioFile} />
                            ) : (
                                <Suspense fallback={<div className="text-center p-8 text-white/60">正在加载分离引擎…</div>}>
                                    <StemSeparator />
                                </Suspense>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* 中间主工作区 */}
            <div
                className="relative z-10 min-h-screen transition-[margin-left] duration-200"
                style={{ marginLeft: leftWidth + LIBRARY_BAR_WIDTH }}
            >
                <div className="px-6 py-8 w-full">
                    <div className="space-y-6">
                        {!audioFile && (
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.6, delay: 0.1 }}
                            >
                                <AudioUpload onFileLoad={loadAudioFile} className="mb-6" />
                            </motion.div>
                        )}

                        {audioFile && (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <motion.div
                                    className="lg:col-span-1"
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ duration: 0.6, delay: 0.3 }}
                                >
                                    <div
                                        className="border border-white/10 rounded-2xl p-6 shadow-2xl h-fit"
                                        data-effect-dropzone
                                        style={{ background: 'var(--glass-strong)', backdropFilter: 'blur(24px) saturate(150%)', WebkitBackdropFilter: 'blur(24px) saturate(150%)' }}
                                    >
                                        <div className="flex items-center justify-between mb-4">
                                            <h3 className="text-lg font-bold text-white">
                                                🔗 效果器链
                                            </h3>
                                            <div className="text-sm text-white/60">{effects.length} 个效果器</div>
                                        </div>
                                        <EffectChain
                                            effects={effects}
                                            onReorderEffects={reorderEffects}
                                            onRemoveEffect={removeEffect}
                                            onToggleEffect={toggleEffect}
                                            onUpdateEffect={updateEffect}
                                            onUpdateEffectEqBands={updateEffectEqBands}
                                            onUpdateEffectShaperPoints={updateEffectShaperPoints}
                                        />
                                    </div>
                                </motion.div>

                                <motion.div
                                    className="lg:col-span-1 space-y-6"
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.6, delay: 0.4 }}
                                >
                                    <SimpleAudioPlayer
                                        audioFile={audioFile}
                                        controls={playerControls}
                                        onClearAudio={handleClearAudio}
                                        onReplaceFile={replaceAudio}
                                    />

                                    {hasAudioBuffer && (
                                        <motion.div
                                            initial={{ opacity: 0, y: 20 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ duration: 0.6, delay: 0.6 }}
                                        >
                                            <AudioExport onExport={exportAudio} isEnabled={isLoaded} />
                                        </motion.div>
                                    )}
                                </motion.div>
                            </div>
                        )}
                    </div>

                    <motion.footer
                        className="text-center mt-12 pt-8 border-t border-gray-700"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 1 }}
                    >
                        <p className="text-gray-500 text-sm">🎵 专业音频处理工作站 | 基于 Tone.js 构建</p>
                    </motion.footer>
                </div>
            </div>
        </div>
    );
};
