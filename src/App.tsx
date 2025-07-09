import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as Tone from 'tone';
import { useAudioWithEffects } from './hooks/useAudioWithEffects';
import { AudioUpload } from './components/AudioUpload';
import { EffectLibrary } from './components/EffectLibrary';
import { EffectChain } from './components/EffectChain';
import { SimpleAudioPlayer } from './components/SimpleAudioPlayer';
import { AudioExport } from './components/AudioExport';
import { AudioFile } from './types/audio';

function App() {
    const [audioFile, setAudioFile] = useState<AudioFile | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [hasAudioBuffer, setHasAudioBuffer] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(true);

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
        seek,
        setVolume,
        loadAudio,
        clearAudio,
        addEffect,
        removeEffect,
        toggleEffect,
        bypassEffect,
        updateEffect,
        reorderEffects,
        exportAudio,
    } = useAudioWithEffects();

    // 播放器控制
    const playerControls = {
        isPlaying,
        isLoaded,
        currentTime,
        duration,
        volume,
        play,
        pause,
        stop,
        seek,
        setVolume,
        exportAudio,
    };

    // 音频文件加载处理
    const loadAudioFile = (file: File) => {
        if (!file) return;

        setAudioFile({
            file: file,
            name: file.name,
            size: file.size,
            url: URL.createObjectURL(file),
            duration: 0,
        });

        setIsLoading(true);
        setError(null);
        setHasAudioBuffer(false);
    };

    // 当audioFile变化时，转换为AudioBuffer
    useEffect(() => {
        if (audioFile && !hasAudioBuffer) {
            const convertToAudioBuffer = async () => {
                try {
                    console.log('🔄 开始转换音频文件为AudioBuffer...', '原始时长:', audioFile.duration);

                    if (Tone.context.state !== 'running') {
                        await Tone.start();
                    }

                    const buffer = await Tone.ToneAudioBuffer.fromUrl(audioFile.url);
                    const audioBuffer = buffer.get();

                    if (audioBuffer) {
                        console.log('✅ AudioBuffer转换成功!', {
                            时长: audioBuffer.duration,
                            采样率: audioBuffer.sampleRate,
                            声道数: audioBuffer.numberOfChannels,
                            采样点: audioBuffer.length
                        });

                        // 更新audioFile的时长信息
                        setAudioFile(prev => prev ? {
                            ...prev,
                            duration: audioBuffer.duration
                        } : null);

                        loadAudio(audioBuffer, audioBuffer.duration);
                        setHasAudioBuffer(true);
                    } else {
                        throw new Error('无法获取AudioBuffer');
                    }
                } catch (error) {
                    console.error('❌ 音频转换失败:', error);
                    setError(`音频文件加载失败: ${error instanceof Error ? error.message : '未知错误'}`);
                } finally {
                    setIsLoading(false);
                }
            };

            convertToAudioBuffer();
        }
    }, [audioFile, hasAudioBuffer, loadAudio]);

    const handleClearAudio = () => {
        clearAudio();
        clearAudioFile();
        setHasAudioBuffer(false);
    };

    const clearAudioFile = () => {
        if (audioFile?.url) {
            URL.revokeObjectURL(audioFile.url);
        }
        setAudioFile(null);
        setError(null);
    };

    return (
        <div className="min-h-screen bg-dark text-white font-sans overflow-x-hidden">
            {/* 背景装饰 */}
            <div className="fixed inset-0 pointer-events-none overflow-hidden">
                {/* 网格背景 */}
                <div
                    className="absolute inset-0 opacity-20"
                    style={{
                        backgroundImage: `
                            linear-gradient(rgba(79, 172, 254, 0.1) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(79, 172, 254, 0.1) 1px, transparent 1px)
                        `,
                        backgroundSize: '50px 50px'
                    }}
                />

                {/* 发光装饰元素 */}
                <motion.div
                    className="absolute -top-40 -right-40 w-80 h-80 bg-neon-blue opacity-10 rounded-full blur-3xl"
                    animate={{
                        scale: [1, 1.2, 1],
                        rotate: [0, 180, 360],
                    }}
                    transition={{
                        duration: 20,
                        repeat: Infinity,
                        ease: "linear"
                    }}
                />
                <motion.div
                    className="absolute -bottom-40 -left-40 w-80 h-80 bg-neon-purple opacity-10 rounded-full blur-3xl"
                    animate={{
                        scale: [1.2, 1, 1.2],
                        rotate: [360, 180, 0],
                    }}
                    transition={{
                        duration: 25,
                        repeat: Infinity,
                        ease: "linear"
                    }}
                />
            </div>

            {/* 固定侧边栏 - 效果器库 */}
            <div
                className={`fixed left-0 top-0 h-full z-20 transition-all duration-300 ${sidebarCollapsed ? 'w-16' : 'w-80'
                    }`}
                onMouseEnter={() => setSidebarCollapsed(false)}
                onMouseLeave={() => setSidebarCollapsed(true)}
            >
                {/* 折叠时的触发条 */}
                {sidebarCollapsed && (
                    <div className="w-16 h-full bg-gradient-to-b from-gray-900 to-gray-800 border-r border-gray-700 flex flex-col items-center justify-center gap-3 py-4">
                        <motion.div
                            className="text-neon-blue text-xl cursor-pointer"
                            animate={{ x: [0, 3, 0] }}
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

                {/* 展开的侧边栏内容 */}
                <AnimatePresence>
                    {!sidebarCollapsed && (
                        <motion.div
                            initial={{ x: -300, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            exit={{ x: -300, opacity: 0 }}
                            transition={{ duration: 0.3 }}
                            className="w-80 h-full bg-gradient-to-b from-gray-900 to-gray-800 border-r border-gray-700 shadow-2xl overflow-y-auto"
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
                                        ◀
                                    </motion.button>
                                </div>
                                <EffectLibrary onAddEffect={addEffect} />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* 主容器 - 添加左边距以避免与侧边栏重叠 */}
            <div className={`relative z-10 transition-all duration-300 ${sidebarCollapsed ? 'ml-16' : 'ml-80'}`}>
                <div className="px-6 py-8 w-full">
                    {/* 头部 */}
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
                            专业的Web音频处理平台，支持拖拽排序的实时效果器链和高质量音频处理
                        </p>
                        <p className="text-gray-500 text-sm max-w-xl mx-auto mb-6">
                            💡 悬停左侧边栏查看效果器库，各个面板内可独立滚动
                        </p>

                        {/* 工具按钮区域 */}
                        <motion.div
                            className="flex flex-col sm:flex-row justify-center gap-3 sm:gap-4 mb-6 px-4"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.6, delay: 0.3 }}
                        >
                            <motion.a
                                href="/audio-analyzer.html"
                                target="_blank"
                                className="group relative inline-flex items-center justify-center gap-2 px-4 sm:px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white font-medium rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 text-sm sm:text-base"
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                            >
                                <span className="text-lg">🔍</span>
                                <span className="whitespace-nowrap">音频文件分析工具</span>
                                <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-blue-500 rounded-xl opacity-0 group-hover:opacity-20 transition-opacity duration-300"></div>
                            </motion.a>

                            <motion.a
                                href="/audio-test.html"
                                target="_blank"
                                className="group relative inline-flex items-center justify-center gap-2 px-4 sm:px-6 py-3 bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 text-white font-medium rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 text-sm sm:text-base"
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                            >
                                <span className="text-lg">🧪</span>
                                <span className="whitespace-nowrap">音频兼容性测试</span>
                                <div className="absolute inset-0 bg-gradient-to-r from-purple-400 to-purple-500 rounded-xl opacity-0 group-hover:opacity-20 transition-opacity duration-300"></div>
                            </motion.a>
                        </motion.div>
                    </motion.header>

                    {/* 错误提示 */}
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

                    {/* 主要内容区域 */}
                    <div className="space-y-6">
                        {/* 音频上传 */}
                        {!audioFile && !isLoading && (
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.6, delay: 0.1 }}
                            >
                                <AudioUpload
                                    onFileLoad={loadAudioFile}
                                    className="mb-6"
                                />
                            </motion.div>
                        )}

                        {/* 加载状态 */}
                        {isLoading && (
                            <motion.div
                                className="text-center p-8"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                            >
                                <div className="w-16 h-16 border-4 border-neon-blue border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                                <p className="text-neon-blue">正在加载音频文件...</p>
                            </motion.div>
                        )}

                        {/* 音频播放器和效果器链的水平布局 */}
                        {audioFile && (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {/* 效果器链 - 左侧 */}
                                <motion.div
                                    className="lg:col-span-1"
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ duration: 0.6, delay: 0.3 }}
                                >
                                    <div className="effect-chain-card bg-gradient-to-br from-gray-900 to-gray-800 border border-gray-700 rounded-xl p-6 shadow-2xl h-fit">
                                        <div className="flex items-center justify-between mb-4">
                                            <h3 className="text-lg font-bold bg-gradient-to-r from-neon-blue to-neon-purple bg-clip-text text-transparent">
                                                🔗 效果器链
                                            </h3>
                                            <div className="text-sm text-gray-400">
                                                {effects.length} 个效果器
                                            </div>
                                        </div>
                                        <EffectChain
                                            effects={effects}
                                            onReorderEffects={reorderEffects}
                                            onRemoveEffect={removeEffect}
                                            onToggleEffect={toggleEffect}
                                            onBypassEffect={bypassEffect}
                                            onUpdateEffect={updateEffect}
                                        />
                                    </div>
                                </motion.div>

                                {/* 音频播放器和导出 - 右侧 */}
                                <motion.div
                                    className="lg:col-span-1 space-y-6"
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.6, delay: 0.4 }}
                                >
                                    {/* 音频播放器 */}
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
                                                if (file) {
                                                    clearAudio();
                                                    clearAudioFile();
                                                    setHasAudioBuffer(false);
                                                    loadAudioFile(file);
                                                }
                                            };
                                            input.click();
                                        }}
                                    />

                                    {/* 音频导出 - 放在播放器下方 */}
                                    {hasAudioBuffer && (
                                        <motion.div
                                            initial={{ opacity: 0, y: 20 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ duration: 0.6, delay: 0.6 }}
                                        >
                                            <AudioExport
                                                onExport={exportAudio}
                                                isEnabled={isLoaded}
                                            />
                                        </motion.div>
                                    )}
                                </motion.div>
                            </div>
                        )}
                    </div>

                    {/* 页脚信息 */}
                    <motion.footer
                        className="text-center mt-12 pt-8 border-t border-gray-700"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 1 }}
                    >
                        <div className="text-gray-500 text-sm">
                            <p>🎵 专业音频处理工作站 | 基于 Tone.js 构建</p>
                            <p className="mt-2">支持实时效果器处理 • 拖拽排序 • 音频导出 • 高质量音频</p>
                            <p className="mt-2 text-xs opacity-70">
                                版本: 2.3.0 (侧边栏布局版) | 更新时间: {new Date().toLocaleTimeString()}
                            </p>
                        </div>
                    </motion.footer>
                </div>
            </div>
        </div>
    );
}

export default App; 