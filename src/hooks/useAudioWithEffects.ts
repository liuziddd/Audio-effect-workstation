import { useState, useRef, useEffect, useCallback } from 'react';
import * as Tone from 'tone';
import { EffectConfig, EffectType } from '../types/audio';
import { AudioEffectsProcessor } from '../utils/audioEffects';


interface UseAudioWithEffectsReturn {
    isPlaying: boolean;
    isLoaded: boolean;
    currentTime: number;
    duration: number;
    volume: number;
    effects: EffectConfig[];
    play: () => Promise<void>;
    pause: () => void;
    stop: () => void;
    seek: (time: number) => void;
    setVolume: (volume: number) => void;
    loadAudio: (audioBuffer: AudioBuffer, originalDuration?: number) => void;
    clearAudio: () => void;
    addEffect: (effectType: EffectType) => void;
    removeEffect: (effectId: string) => void;
    toggleEffect: (effectId: string) => void;
    bypassEffect: (effectId: string) => void;
    updateEffect: (effectId: string, parameters: Record<string, number>) => void;
    reorderEffects: (effects: EffectConfig[]) => void;
    exportAudio: (filename?: string) => Promise<void>;
}

// 效果器中文名称映射
const effectNames: Record<EffectType, string> = {
    reverb: '混响',
    eq: '均衡器',
    compressor: '压缩器',
    delay: '延迟',
    chorus: '合唱',
    phaser: '相位器',
    distortion: '失真',
    filter: '滤波器',
    limiter: '限制器',
    gate: '噪声门',
};

// 每个效果器的默认参数
const defaultParameters: Record<EffectType, Record<string, number>> = {
    reverb: { roomSize: 0.5, decay: 2, wetness: 0.3 },
    eq: { lowGain: 0, midGain: 0, highGain: 0, lowFreq: 200, highFreq: 8000 },
    compressor: { threshold: -20, ratio: 4, attack: 0.01, release: 0.1 },
    delay: { time: 0.25, feedback: 0.3, wetness: 0.3 },
    chorus: { frequency: 2, depth: 0.3, wetness: 0.5 },
    phaser: { frequency: 1, depth: 0.5, stages: 6 },
    distortion: { drive: 0.3, curve: 50, oversample: 2 },
    filter: { frequency: 1000, Q: 1, gain: 0 },
    limiter: { threshold: -6, release: 0.01 },
    gate: { threshold: -30, ratio: 10, attack: 0.001, release: 0.1 },
};

export const useAudioWithEffects = (): UseAudioWithEffectsReturn => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [isLoaded, setIsLoaded] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolumeState] = useState(1);
    const [effects, setEffects] = useState<EffectConfig[]>([]);

    const playerRef = useRef<Tone.Player | null>(null);
    const effectsProcessorRef = useRef<AudioEffectsProcessor | null>(null);
    const masterVolumeRef = useRef<Tone.Volume | null>(null);
    const updateIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const effectCounterRef = useRef(0);

    // 保存原始AudioBuffer和时长，用于重新创建播放器
    const audioBufferRef = useRef<AudioBuffer | null>(null);
    const originalDurationRef = useRef<number>(0);

    // 初始化音频链
    useEffect(() => {
        effectsProcessorRef.current = new AudioEffectsProcessor();
        masterVolumeRef.current = new Tone.Volume(0);

        // 连接效果器到主音量控制到输出
        effectsProcessorRef.current.connect(masterVolumeRef.current);
        masterVolumeRef.current.toDestination();

        return () => {
            effectsProcessorRef.current?.dispose();
            masterVolumeRef.current?.dispose();
        };
    }, []);

    // 更新时间的定时器
    useEffect(() => {
        console.log(`⏱️ 定时器状态更新: 播放=${isPlaying}, 时长=${duration}`);

        if (isPlaying && playerRef.current) {
            const startTime = Tone.now();
            const startOffset = currentTime;

            console.log(`▶️ 开始播放定时器，从 ${startOffset} 秒开始`);

            updateIntervalRef.current = setInterval(() => {
                if (playerRef.current && playerRef.current.state === 'started') {
                    const elapsed = Tone.now() - startTime;
                    const newTime = startOffset + elapsed;

                    // 检查是否播放完毕
                    if (newTime >= duration) {
                        console.log('🎵 播放到达终点，停止播放');
                        setCurrentTime(duration);
                        setIsPlaying(false);
                        if (playerRef.current) {
                            playerRef.current.stop();
                        }
                    } else {
                        setCurrentTime(newTime);
                    }
                }
            }, 100);
        } else {
            if (updateIntervalRef.current) {
                clearInterval(updateIntervalRef.current);
                updateIntervalRef.current = null;
            }
        }

        return () => {
            if (updateIntervalRef.current) {
                clearInterval(updateIntervalRef.current);
            }
        };
    }, [isPlaying, currentTime, duration]);

    // 更新效果器链
    useEffect(() => {
        if (effectsProcessorRef.current) {
            effectsProcessorRef.current.updateEffectsChain(effects);
        }
    }, [effects]);

    // 彻底清理所有音频资源
    const clearAllResources = useCallback(() => {
        console.log('🧹 彻底清理所有音频资源...');

        // 停止和清理播放器
        if (playerRef.current) {
            try {
                playerRef.current.stop();
                playerRef.current.disconnect();
                playerRef.current.dispose();
            } catch (error) {
                console.warn('清理播放器时出错:', error);
            }
            playerRef.current = null;
        }

        // 清理定时器
        if (updateIntervalRef.current) {
            clearInterval(updateIntervalRef.current);
            updateIntervalRef.current = null;
        }

        // 重置状态
        setIsLoaded(false);
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(0);

        // 清理保存的音频数据
        audioBufferRef.current = null;
        originalDurationRef.current = 0;

        console.log('✅ 所有资源清理完成');
    }, []);



    const loadAudio = useCallback(async (audioBuffer: AudioBuffer, originalDuration?: number) => {
        try {
            console.log('🔄 开始加载新音频文件...', {
                'audioBuffer存在': !!audioBuffer,
                'audioBuffer时长': audioBuffer?.duration,
                '原始时长': originalDuration
            });

            // 彻底清理之前的资源
            clearAllResources();

            // 保存AudioBuffer和时长信息
            audioBufferRef.current = audioBuffer;
            originalDurationRef.current = originalDuration || audioBuffer.duration;

            // 确保Tone.js上下文已启动
            if (Tone.context.state !== 'running') {
                await Tone.start();
            }

            // 创建新播放器
            const player = new Tone.Player(audioBuffer);
            await new Promise(resolve => setTimeout(resolve, 100));

            // 连接到效果器链
            if (effectsProcessorRef.current) {
                player.connect(effectsProcessorRef.current.getInput());
            }

            playerRef.current = player;

            // 设置状态
            const finalDuration = originalDuration || audioBuffer.duration;
            setDuration(finalDuration);
            setCurrentTime(0);
            setIsLoaded(true);
            setIsPlaying(false);

            console.log('🎯 音频加载完成:', {
                '最终时长': finalDuration,
                'isLoaded': true
            });

        } catch (error) {
            console.error('❌ AudioBuffer加载失败:', error);
            clearAllResources();
        }
    }, [clearAllResources]);

    const play = useCallback(async () => {
        console.log('🎵 播放按钮被点击！');

        if (!isLoaded || !audioBufferRef.current) {
            console.error('❌ 音频未加载完成！');
            return;
        }

        try {
            // 确保Tone.js已启动
            if (Tone.context.state !== 'running') {
                console.log('🔧 启动 Tone.js 上下文...');
                await Tone.start();
            }

            // 检查播放器状态
            const currentState = playerRef.current?.state;
            console.log('🔍 播放器当前状态:', currentState);

            if (currentState === 'started') {
                // 已经在播放中
                console.log('ℹ️ 播放器已在播放中');
                setIsPlaying(true);
                return;
            }

            // 如果播放器不存在或已停止，重新创建一个新的
            if (!playerRef.current || currentState === 'stopped') {
                console.log('🔄 重新创建播放器...');

                // 清理旧播放器
                if (playerRef.current) {
                    try {
                        playerRef.current.disconnect();
                        playerRef.current.dispose();
                    } catch (error) {
                        console.warn('清理旧播放器时出错:', error);
                    }
                }

                // 创建新播放器
                const newPlayer = new Tone.Player(audioBufferRef.current);
                await new Promise(resolve => setTimeout(resolve, 100));

                // 连接到效果器链
                if (effectsProcessorRef.current) {
                    newPlayer.connect(effectsProcessorRef.current.getInput());
                }

                playerRef.current = newPlayer;
            }

            // 开始播放（从当前时间点）
            console.log('▶️ 开始播放，从时间点:', currentTime);
            playerRef.current.start('+0', currentTime);
            setIsPlaying(true);

            console.log('✅ 播放启动成功！');

        } catch (error) {
            console.error('❌ 播放失败:', error);
            console.error('错误堆栈:', error instanceof Error ? error.stack : 'Unknown error');
            setIsPlaying(false);
        }
    }, [isLoaded, currentTime]);

    const pause = useCallback(() => {
        if (playerRef.current && isPlaying) {
            console.log('⏸️ 暂停播放');
            playerRef.current.stop();
            setIsPlaying(false);
        }
    }, [isPlaying]);

    const stop = useCallback(() => {
        if (playerRef.current) {
            console.log('⏹️ 手动停止播放');
            playerRef.current.stop();
            setIsPlaying(false);
            setCurrentTime(0);
        }
    }, []);

    const seek = useCallback(async (time: number) => {
        if (!isLoaded || !audioBufferRef.current) {
            return;
        }

        console.log('🔍 进度调整到:', time);
        const wasPlaying = isPlaying;

        try {

            // 停止当前播放
            if (playerRef.current) {
                playerRef.current.stop();
                playerRef.current.disconnect();
                playerRef.current.dispose();
            }

            // 确保Tone.js上下文已启动
            if (Tone.context.state !== 'running') {
                await Tone.start();
            }

            // 创建新播放器
            const newPlayer = new Tone.Player(audioBufferRef.current);
            await new Promise(resolve => setTimeout(resolve, 100));

            // 连接到效果器链
            if (effectsProcessorRef.current) {
                newPlayer.connect(effectsProcessorRef.current.getInput());
            }

            playerRef.current = newPlayer;
            setCurrentTime(time);

            // 如果之前在播放，从新位置开始播放
            if (wasPlaying) {
                console.log('▶️ 从新位置继续播放:', time);
                playerRef.current.start('+0', time);
                setIsPlaying(true);
            } else {
                setIsPlaying(false);
            }
        } catch (error) {
            console.error('❌ 进度调整失败:', error);
            setIsPlaying(false);
        }
    }, [isLoaded, isPlaying]);

    const setVolume = useCallback((newVolume: number) => {
        if (masterVolumeRef.current) {
            const dbValue = newVolume === 0 ? -Infinity : Tone.gainToDb(newVolume);
            masterVolumeRef.current.volume.value = dbValue;
            setVolumeState(newVolume);
        }
    }, []);



    const addEffect = useCallback((effectType: EffectType) => {
        const effectId = `${effectType}_${++effectCounterRef.current}`;
        const newEffect: EffectConfig = {
            id: effectId,
            name: effectNames[effectType],
            type: effectType,
            enabled: true,
            parameters: { ...defaultParameters[effectType] },
            order: effects.length,
            instanceId: effectId,
            bypass: false,
        };

        setEffects(prev => [...prev, newEffect]);
    }, [effects.length]);

    const removeEffect = useCallback((effectId: string) => {
        setEffects(prev => {
            const filtered = prev.filter(effect => effect.id !== effectId);
            // 重新排序
            return filtered.map((effect, index) => ({
                ...effect,
                order: index,
            }));
        });
    }, []);

    const toggleEffect = useCallback((effectId: string) => {
        setEffects(prev =>
            prev.map(effect =>
                effect.id === effectId
                    ? { ...effect, enabled: !effect.enabled }
                    : effect
            )
        );
    }, []);

    const bypassEffect = useCallback((effectId: string) => {
        setEffects(prev =>
            prev.map(effect =>
                effect.id === effectId
                    ? { ...effect, bypass: !effect.bypass }
                    : effect
            )
        );
    }, []);

    const updateEffect = useCallback((effectId: string, parameters: Record<string, number>) => {
        setEffects(prev =>
            prev.map(effect =>
                effect.id === effectId
                    ? { ...effect, parameters: { ...effect.parameters, ...parameters } }
                    : effect
            )
        );

        // 实时更新效果器参数
        if (effectsProcessorRef.current) {
            effectsProcessorRef.current.updateEffect(effectId, parameters);
        }
    }, []);

    const reorderEffects = useCallback((newEffects: EffectConfig[]) => {
        setEffects(newEffects);
    }, []);

    // 导出音频功能 - WAV格式，使用Tone.js离线渲染获取处理后的音频
    const exportAudio = useCallback(async (filename?: string) => {
        if (!audioBufferRef.current || !effectsProcessorRef.current) {
            throw new Error('没有可导出的音频数据');
        }

        try {
            console.log('🎵 开始导出WAV格式音频...');
            console.log('📊 当前效果器链:', effects.map(e => `${e.name}(${e.enabled ? '启用' : '禁用'})`));

            // 使用Tone.js离线渲染
            const toneAudioBuffer = await Tone.Offline(async () => {
                // 在离线上下文中创建播放器
                const offlinePlayer = new Tone.Player(audioBufferRef.current!);

                // 在离线上下文中重建效果器链
                const offlineEffectsProcessor = new AudioEffectsProcessor();
                const offlineMasterVolume = new Tone.Volume(0);

                // 连接音频链：播放器 -> 效果器处理器 -> 主音量 -> 输出
                offlinePlayer.connect(offlineEffectsProcessor.getInput());
                offlineEffectsProcessor.connect(offlineMasterVolume);
                offlineMasterVolume.toDestination();

                // 更新效果器链（使用当前的效果器配置）
                offlineEffectsProcessor.updateEffectsChain(effects);

                // 设置音量
                const dbValue = volume === 0 ? -Infinity : Tone.gainToDb(volume);
                offlineMasterVolume.volume.value = dbValue;

                // 开始播放（从头开始，播放整个文件）
                offlinePlayer.start(0);

                console.log('🎛️ 离线渲染中，应用效果器链...');

            }, duration || audioBufferRef.current.duration);

            // 将ToneAudioBuffer转换为标准AudioBuffer
            const audioBuffer = toneAudioBuffer.get();
            if (!audioBuffer) {
                throw new Error('无法获取渲染后的AudioBuffer');
            }

            console.log('✅ 离线渲染完成，开始WAV编码...');
            await exportWAV(audioBuffer, filename);

        } catch (error) {
            console.error('❌ 音频导出失败:', error);
            throw error;
        }
    }, [effects, volume, duration]);

    // 导出WAV格式
    const exportWAV = useCallback(async (audioBuffer: AudioBuffer, filename?: string) => {
        const length = audioBuffer.length;
        const numberOfChannels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const bytesPerSample = 2; // 16-bit
        const byteRate = sampleRate * numberOfChannels * bytesPerSample;
        const blockAlign = numberOfChannels * bytesPerSample;
        const dataSize = length * numberOfChannels * bytesPerSample;
        const fileSize = 36 + dataSize;

        const buffer = new ArrayBuffer(44 + dataSize);
        const view = new DataView(buffer);

        // WAV header
        writeString(view, 0, 'RIFF');
        view.setUint32(4, fileSize, true);
        writeString(view, 8, 'WAVE');
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, numberOfChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, 16, true);
        writeString(view, 36, 'data');
        view.setUint32(40, dataSize, true);

        // Convert audio data
        let offset = 44;
        for (let i = 0; i < length; i++) {
            for (let channel = 0; channel < numberOfChannels; channel++) {
                const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(channel)[i]));
                view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
                offset += 2;
            }
        }

        const blob = new Blob([buffer], { type: 'audio/wav' });
        downloadFile(blob, filename || `audio_export_${Date.now()}.wav`);
    }, []);



    // 辅助函数：写入字符串到DataView
    const writeString = (view: DataView, offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };

    // 辅助函数：下载文件
    const downloadFile = (blob: Blob, filename: string) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        console.log(`✅ 文件已导出: ${filename}`);
    };

    return {
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
        clearAudio: clearAllResources,
        addEffect,
        removeEffect,
        toggleEffect,
        bypassEffect,
        updateEffect,
        reorderEffects,
        exportAudio,
    };
}; 