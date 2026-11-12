import { useState, useEffect, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as Tone from 'tone';
import { Search, FileAudio, FolderOpen, X, SlidersHorizontal } from 'lucide-react';
import { useAudioWithEffects } from '../hooks/useAudioWithEffects';
import { AudioUpload } from '../components/AudioUpload';
import { EffectLibrary } from '../components/EffectLibrary';
import { EffectChain } from '../components/EffectChain';
import { SimpleAudioPlayer } from '../components/SimpleAudioPlayer';
import { AudioExport } from '../components/AudioExport';
import { FileBrowser } from '../components/FileBrowser';
import { AudioInspector } from '../components/AudioInspector';
import { AudioFile } from '../types/audio';

const StemSeparator = lazy(() => import('../components/StemSeparator'));

type ToolId = 'inspector' | 'separator' | null;

// 效果器库收纳条宽度（收纳态占位）+ 展开面板宽度
const LIBRARY_BAR_WIDTH = 40;
const LIBRARY_PANEL_WIDTH = 280;

// 侧边栏配色（取自参考壁纸）：绿色渐变（图1）/ 蓝青渐变（图2）
const GREEN_GRADIENT =
    'linear-gradient(180deg, rgba(13,30,60,0.97) 0%, rgba(15,90,107,0.94) 52%, rgba(23,160,94,0.9) 100%)';
const BLUE_GRADIENT =
    'linear-gradient(180deg, rgba(26,58,168,0.95) 0%, rgba(24,115,216,0.92) 45%, rgba(42,168,184,0.88) 100%)';

export const Editor = () => {
    const [audioFile, setAudioFile] = useState<AudioFile | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [hasAudioBuffer, setHasAudioBuffer] = useState(false);
    const [error, setError] = useState<string | null>(null);
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
        setIsLoading(true);
        setError(null);
        setHasAudioBuffer(false);
    };

    const clearAudioFile = () => {
        if (audioFile?.url) URL.revokeObjectURL(audioFile.url);
        setAudioFile(null);
        setError(null);
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

    useEffect(() => {
        if (audioFile && !hasAudioBuffer) {
            const convertToAudioBuffer = async () => {
                try {
                    if (Tone.context.state !== 'running') await Tone.start();
                    const buffer = await Tone.ToneAudioBuffer.fromUrl(audioFile.url);
                    const audioBuffer = buffer.get();
                    if (!audioBuffer) throw new Error('无法获取 AudioBuffer');
                    setAudioFile((prev) => (prev ? { ...prev, duration: audioBuffer.duration } : null));
                    loadAudio(audioBuffer, audioBuffer.duration);
                    setHasAudioBuffer(true);
                } catch (err) {
                    console.error('音频转换失败:', err);
                    setError(`音频文件加载失败: ${err instanceof Error ? err.message : '未知错误'}`);
                } finally {
                    setIsLoading(false);
                }
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

    const toolTitle = activeTool === 'inspector' ? '🔍 音频检测工具' : '🎛️ AI 音轨分离';

    return (
        <div
            className="min-h-screen bg-[#0a0a0a] text-white font-sans overflow-x-hidden"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => e.preventDefault()}
        >
            {/* 背景装饰 */}
            <div className="fixed inset-0 pointer-events-none overflow-hidden">
                <div
                    className="absolute inset-0 opacity-20"
                    style={{
                        backgroundImage:
                            'linear-gradient(rgba(79,172,254,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(79,172,254,0.1) 1px, transparent 1px)',
                        backgroundSize: '50px 50px',
                    }}
                />
                <motion.div
                    className="absolute -top-40 -right-40 w-80 h-80 bg-neon-blue opacity-10 rounded-full blur-3xl"
                    animate={{ scale: [1, 1.2, 1], rotate: [0, 180, 360] }}
                    transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
                />
                <motion.div
                    className="absolute -bottom-40 -left-40 w-80 h-80 bg-neon-purple opacity-10 rounded-full blur-3xl"
                    animate={{ scale: [1.2, 1, 1.2], rotate: [360, 180, 0] }}
                    transition={{ duration: 25, repeat: Infinity, ease: 'linear' }}
                />
            </div>

            {/* 左侧固定侧边栏（非收纳、可调宽），无圆角，上中下三段 */}
            <div
                className="fixed left-0 top-0 h-full z-40 border-r border-white/10 backdrop-blur-md flex flex-col overflow-hidden"
                style={{ width: leftWidth, background: GREEN_GRADIENT }}
            >
                {/* 上段：Logo 占位 + 标题（标题在侧边栏内，窄时折叠消失） */}
                <div className="h-[68px] flex-shrink-0 border-b border-white/10 flex items-center px-4">
                    <div className="w-11 h-11 flex-shrink-0" />
                    <span
                        className={`ml-3 text-sm font-semibold tracking-wide whitespace-nowrap overflow-hidden text-white transition-all duration-200 ${
                            collapsed ? 'max-w-0 opacity-0' : 'max-w-[160px] opacity-100'
                        }`}
                    >
                        音频效果工作站
                    </span>
                </div>

                {/* 中段：本地文件浏览器（类 FL 资源管理器） */}
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
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
                        <FileBrowser onLoadFile={replaceAudio} />
                    </div>
                </div>

                {/* 下段：工具按钮（音频检测 / AI 音轨分离） */}
                <div className="p-3 border-t border-white/10 flex flex-col gap-2 flex-shrink-0">
                    <button
                        onClick={() => toggleTool('inspector')}
                        className={`inline-flex items-center justify-center rounded-xl text-white font-medium text-sm transition-all duration-200 px-2 py-2.5 ${
                            collapsed ? 'gap-0' : 'gap-2'
                        } ${
                            activeTool === 'inspector'
                                ? 'bg-gradient-to-r from-blue-500 to-purple-500 shadow-lg'
                                : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500'
                        }`}
                    >
                        <Search className="w-4 h-4 flex-shrink-0" />
                        <span className={`whitespace-nowrap overflow-hidden transition-all duration-200 ${collapsed ? 'max-w-0 opacity-0' : 'max-w-full opacity-100'}`}>
                            音频检测
                        </span>
                    </button>
                    <button
                        onClick={() => toggleTool('separator')}
                        className={`inline-flex items-center justify-center rounded-xl text-white font-medium text-sm transition-all duration-200 px-2 py-2.5 ${
                            collapsed ? 'gap-0' : 'gap-2'
                        } ${
                            activeTool === 'separator'
                                ? 'bg-gradient-to-r from-pink-500 to-rose-500 shadow-lg'
                                : 'bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500'
                        }`}
                    >
                        <FileAudio className="w-4 h-4 flex-shrink-0" />
                        <span className={`whitespace-nowrap overflow-hidden transition-all duration-200 ${collapsed ? 'max-w-0 opacity-0' : 'max-w-full opacity-100'}`}>
                            AI 音轨分离
                        </span>
                    </button>
                </div>

                {/* 拖拽调宽手柄 */}
                <div
                    className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-neon-blue/50 transition-colors"
                    onMouseDown={startResize}
                />
            </div>

            {/* 效果器库收纳栏：透明玻璃竖条在最右，hover 时面板从左侧栏旁抽出 */}
            <div
                className="fixed top-0 h-full z-40 flex items-stretch"
                style={{ left: leftWidth }}
                onMouseEnter={() => setLibraryOpen(true)}
                onMouseLeave={() => setLibraryOpen(false)}
            >
                <AnimatePresence>
                    {libraryOpen && (
                        <motion.div
                            className="h-full overflow-hidden border-r border-white/10"
                            style={{ background: BLUE_GRADIENT, backdropFilter: 'blur(12px)' }}
                            initial={{ width: 0, opacity: 0 }}
                            animate={{ width: LIBRARY_PANEL_WIDTH, opacity: 1 }}
                            exit={{ width: 0, opacity: 0 }}
                            transition={{ type: 'spring', stiffness: 300, damping: 34 }}
                        >
                            <div style={{ width: LIBRARY_PANEL_WIDTH }} className="h-full flex flex-col">
                                <div className="px-4 py-3 border-b border-white/10">
                                    <h3 className="text-sm font-semibold text-white">🎛️ 效果器库</h3>
                                </div>
                                <div className="flex-1 overflow-y-auto p-3">
                                    <EffectLibrary onAddEffect={addEffect} />
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* 透明玻璃竖条（触发区，恒显，位于面板最右） */}
                <div
                    className="h-full shrink-0 flex flex-col items-center justify-center gap-3 cursor-pointer select-none"
                    style={{
                        width: LIBRARY_BAR_WIDTH,
                        background: 'rgba(255,255,255,0.05)',
                        backdropFilter: 'blur(14px)',
                        borderLeft: '1px solid rgba(255,255,255,0.12)',
                        borderRight: '1px solid rgba(255,255,255,0.06)',
                    }}
                >
                    <SlidersHorizontal className="w-4 h-4 text-white/80" />
                    <span className="text-white/80 text-xs font-medium tracking-widest" style={{ writingMode: 'vertical-rl' }}>
                        效果器库
                    </span>
                </div>
            </div>

            {/* 工具面板（紧贴左侧栏弹出，overlay 不挤压中间） */}
            <AnimatePresence>
                {activeTool && (
                    <motion.div
                        className="fixed top-0 h-full z-50 border-r border-white/10 backdrop-blur-md shadow-2xl overflow-hidden"
                        style={{ left: leftWidth, width: 400, background: GREEN_GRADIENT }}
                        initial={{ x: -400, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: -400, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 32 }}
                    >
                        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                            <h3 className="text-sm font-semibold text-white">{toolTitle}</h3>
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
                    {error && (
                        <motion.div
                            className="mb-6 p-4 bg-red-900 bg-opacity-20 border border-red-500 rounded-lg text-red-300"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                        >
                            <h3 className="font-bold mb-2">❌ 加载失败</h3>
                            <p>{error}</p>
                        </motion.div>
                    )}

                    <div className="space-y-6">
                        {!audioFile && !isLoading && (
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.6, delay: 0.1 }}
                            >
                                <AudioUpload onFileLoad={loadAudioFile} className="mb-6" />
                            </motion.div>
                        )}

                        {isLoading && (
                            <motion.div className="text-center p-8" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                                <div className="w-16 h-16 border-4 border-neon-blue border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                                <p className="text-neon-blue">正在加载音频文件...</p>
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
                                        className="border border-white/10 rounded-xl p-6 shadow-2xl h-fit"
                                        style={{ background: 'linear-gradient(160deg, rgba(18,34,72,0.9) 0%, rgba(18,88,110,0.84) 100%)' }}
                                    >
                                        <div className="flex items-center justify-between mb-4">
                                            <h3 className="text-lg font-bold text-white">
                                                🔗 效果器链
                                            </h3>
                                            <div className="text-sm text-white/60">{effects.length} 个效果器</div>
                                        </div>
                                        <EffectChain
                                            effects={effects}
                                            onAddEffect={addEffect}
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
