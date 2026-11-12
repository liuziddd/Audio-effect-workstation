import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as Tone from 'tone';
import { useAudioWithEffects } from '../hooks/useAudioWithEffects';
import { AudioUpload } from '../components/AudioUpload';
import { EffectLibrary } from '../components/EffectLibrary';
import { EffectChain } from '../components/EffectChain';
import { SimpleAudioPlayer } from '../components/SimpleAudioPlayer';
import { AudioExport } from '../components/AudioExport';
import { AudioFile } from '../types/audio';

const StemSeparator = lazy(() => import('../components/StemSeparator'));

export const Editor = () => {
    const [audioFile, setAudioFile] = useState<AudioFile | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [hasAudioBuffer, setHasAudioBuffer] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
    const [showStemSeparator, setShowStemSeparator] = useState(false);
    const [isDraggingAudio, setIsDraggingAudio] = useState(false);
    const dragDepthRef = useRef(0);

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
        isPlaying,
        isLoaded,
        currentTime,
        duration,
        volume,
        play,
        pause,
        stop,
        beginSeek,
        previewSeek,
        seek,
        setVolume,
        exportAudio,
    };

    const loadAudioFile = (file: File) => {
        if (!file) return;
        setAudioFile({
            file,
            name: file.name,
            size: file.size,
            url: URL.createObjectURL(file),
            duration: 0,
        });
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

    const isAudioFile = (file: File) =>
        file.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac|webm|mp4)$/i.test(file.name);

    const hasAudioFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

    const handleDragEnter = (e: React.DragEvent) => {
        if (!hasAudioFiles(e)) return;
        e.preventDefault();
        dragDepthRef.current += 1;
        setIsDraggingAudio(true);
    };

    const handleDragOver = (e: React.DragEvent) => {
        if (hasAudioFiles(e)) e.preventDefault();
    };

    const handleDragLeave = (e: React.DragEvent) => {
        if (!hasAudioFiles(e)) return;
        dragDepthRef.current -= 1;
        if (dragDepthRef.current <= 0) {
            dragDepthRef.current = 0;
            setIsDraggingAudio(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        if (!hasAudioFiles(e)) return;
        e.preventDefault();
        dragDepthRef.current = 0;
        setIsDraggingAudio(false);
        const file = Array.from(e.dataTransfer.files).find(isAudioFile);
        if (file) replaceAudio(file);
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

    return (
        <div
            className="min-h-screen bg-[#0a0a0a] text-white font-sans overflow-x-hidden"
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {/* 拖拽音频文件时的全屏提示遮罩 */}
            {isDraggingAudio && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm pointer-events-none">
                    <div className="text-center">
                        <div className="text-6xl mb-4">🎵</div>
                        <p className="text-2xl font-bold text-white">松开以加载音频</p>
                        <p className="text-neon-blue mt-2">支持 MP3 / WAV / OGG / M4A / AAC / FLAC / WebM</p>
                    </div>
                </div>
            )}

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

            {/* 固定侧边栏 - 效果器库（右侧） */}
            <div
                className={`fixed right-0 top-0 h-full z-20 transition-all duration-300 ${sidebarCollapsed ? 'w-16' : 'w-80'}`}
                onMouseEnter={() => setSidebarCollapsed(false)}
                onMouseLeave={() => setSidebarCollapsed(true)}
            >
                {sidebarCollapsed && (
                    <div className="w-16 h-full bg-gradient-to-b from-gray-900 to-gray-800 border-l border-gray-700 flex flex-col items-center justify-center gap-3 py-4">
                        <motion.div
                            className="text-neon-blue text-xl cursor-pointer"
                            animate={{ x: [0, -3, 0] }}
                            transition={{ duration: 2, repeat: Infinity }}
                        >
                            🎛️
                        </motion.div>
                        <div className="text-neon-blue text-xs font-medium">
                            <div className="flex flex-col items-center gap-1">
                                <span>效</span>
                                <span>果</span>
                                <span>器</span>
                                <span>库</span>
                            </div>
                        </div>
                    </div>
                )}

                <AnimatePresence>
                    {!sidebarCollapsed && (
                        <motion.div
                            initial={{ x: 300, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            exit={{ x: 300, opacity: 0 }}
                            transition={{ duration: 0.3 }}
                            className="w-80 h-full bg-gradient-to-b from-gray-900 to-gray-800 border-l border-gray-700 shadow-2xl overflow-y-auto"
                        >
                            <div className="p-4">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-lg font-bold bg-gradient-to-r from-neon-blue to-neon-purple bg-clip-text text-transparent">
                                        🎛️ 效果器库
                                    </h3>
                                    <motion.button
                                        onClick={() => setSidebarCollapsed(true)}
                                        className="text-gray-400 hover:text-white p-1"
                                        whileHover={{ scale: 1.1 }}
                                        whileTap={{ scale: 0.9 }}
                                    >
                                        ▶
                                    </motion.button>
                                </div>
                                <EffectLibrary onAddEffect={addEffect} />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* 主容器 */}
            <div className={`relative z-10 transition-all duration-300 ${sidebarCollapsed ? 'mr-16' : 'mr-80'}`}>
                <div className="px-6 py-8 w-full">
                    <motion.header
                        className="text-center mb-8"
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6 }}
                    >
                        <h1 className="text-4xl md:text-6xl font-bold mb-4 flex items-center justify-center gap-3">
                            <span className="text-4xl md:text-6xl">🎛️</span>
                            <span className="bg-gradient-to-r from-neon-blue via-neon-purple to-neon-green bg-clip-text text-transparent">
                                音频效果工作站
                            </span>
                        </h1>
                        <p className="text-gray-400 text-lg max-w-2xl mx-auto mb-2">
                            专业的 Web 音频处理平台，支持拖拽排序的实时效果器链和高质量音频处理
                        </p>
                        <p className="text-gray-500 text-sm max-w-xl mx-auto mb-6">
                            💡 悬停右侧边栏查看效果器库
                        </p>

                        <motion.div
                            className="flex justify-center gap-4 mb-6 px-4"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.6, delay: 0.3 }}
                        >
                            <motion.a
                                href="/audio-inspector.html"
                                target="_blank"
                                className="inline-flex items-center justify-center gap-2 px-4 sm:px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-medium rounded-xl shadow-lg transition-all duration-300 transform hover:-translate-y-1 text-sm sm:text-base"
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                            >
                                <span className="text-lg">🔍</span>
                                <span className="whitespace-nowrap">音频检测工具</span>
                            </motion.a>
                            <motion.button
                                onClick={() => setShowStemSeparator((v) => !v)}
                                className={`inline-flex items-center justify-center gap-2 px-4 sm:px-6 py-3 font-medium rounded-xl shadow-lg transition-all duration-300 transform hover:-translate-y-1 text-sm sm:text-base ${
                                    showStemSeparator
                                        ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500'
                                        : 'bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500'
                                } text-white`}
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                            >
                                <span className="text-lg">🎛️</span>
                                <span className="whitespace-nowrap">AI 音轨分离</span>
                            </motion.button>
                        </motion.div>

                        <AnimatePresence>
                            {showStemSeparator && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={{ duration: 0.3 }}
                                    className="mb-6 overflow-hidden"
                                >
                                    <Suspense fallback={<div className="text-center p-8 text-gray-400">正在加载分离引擎…</div>}>
                                        <StemSeparator />
                                    </Suspense>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </motion.header>

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
                                    <div className="bg-gradient-to-br from-gray-900 to-gray-800 border border-gray-700 rounded-xl p-6 shadow-2xl h-fit">
                                        <div className="flex items-center justify-between mb-4">
                                            <h3 className="text-lg font-bold bg-gradient-to-r from-neon-blue to-neon-purple bg-clip-text text-transparent">
                                                🔗 效果器链
                                            </h3>
                                            <div className="text-sm text-gray-400">{effects.length} 个效果器</div>
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
                                        onSelectNewFile={() => {
                                            const input = document.createElement('input');
                                            input.type = 'file';
                                            input.accept = 'audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/mp4,audio/aac,audio/webm,audio/flac,.mp3,.wav,.ogg,.m4a,.aac,.webm,.flac';
                                            input.onchange = (e) => {
                                                const file = (e.target as HTMLInputElement).files?.[0];
                                                if (file) replaceAudio(file);
                                            };
                                            input.click();
                                        }}
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
                        <p className="text-gray-500 text-sm">
                            🎵 专业音频处理工作站 | 基于 Tone.js 构建
                        </p>
                    </motion.footer>
                </div>
            </div>
        </div>
    );
};
