import { useState, useRef, useEffect, useCallback } from 'react';
import * as Tone from 'tone';
import { EffectConfig, EffectType, EqBandData, ShaperPoint } from '../types/audio';
import { AudioEffectsProcessor, getEffectsTailDuration } from '../utils/audioEffects';
import { getDefaultEffectParameters, createDefaultEqBands, createDefaultShaperPoints } from '../utils/audioUtils';

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
    beginSeek: () => void;
    previewSeek: (time: number) => void;
    seek: (time: number) => void;
    setVolume: (volume: number) => void;
    loadAudio: (audioBuffer: AudioBuffer, originalDuration?: number) => void;
    clearAudio: () => void;
    addEffect: (effectType: EffectType) => void;
    removeEffect: (effectId: string) => void;
    toggleEffect: (effectId: string) => void;
    updateEffect: (effectId: string, parameters: Record<string, number>) => void;
    updateEffectEqBands: (effectId: string, bands: EqBandData[]) => void;
    updateEffectShaperPoints: (effectId: string, points: ShaperPoint[]) => void;
    reorderEffects: (effects: EffectConfig[]) => void;
    exportAudio: (filename?: string) => Promise<void>;
}

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

const PLAYBACK_FADE_TIME = 0.015;

const writeString = (view: DataView, offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
};

const exportWAV = (audioBuffer: AudioBuffer, filename: string) => {
    const { length, numberOfChannels, sampleRate } = audioBuffer;
    const bytesPerSample = 2;
    const dataSize = length * numberOfChannels * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numberOfChannels * bytesPerSample, true);
    view.setUint16(32, numberOfChannels * bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    const channels = Array.from(
        { length: numberOfChannels },
        (_, channel) => audioBuffer.getChannelData(channel)
    );
    let offset = 44;
    for (let i = 0; i < length; i++) {
        for (const channelData of channels) {
            const sample = Math.max(-1, Math.min(1, channelData[i]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
            offset += 2;
        }
    }

    const url = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
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
    const masterLimiterRef = useRef<Tone.Limiter | null>(null);
    const updateIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const effectCounterRef = useRef(0);
    const audioBufferRef = useRef<AudioBuffer | null>(null);

    const isPlayingRef = useRef(false);
    const isLoadedRef = useRef(false);
    const playPendingRef = useRef(false);
    const positionRef = useRef(0);
    const durationRef = useRef(0);
    const playbackStartedAtRef = useRef(0);
    const playbackOffsetRef = useRef(0);
    const resumeAfterSeekRef = useRef(false);

    const updatePosition = useCallback((time: number) => {
        const clampedTime = Math.max(0, Math.min(time, durationRef.current));
        positionRef.current = clampedTime;
        setCurrentTime(clampedTime);
    }, []);

    const getPlaybackPosition = useCallback(() => {
        if (!isPlayingRef.current) return positionRef.current;
        const elapsed = Math.max(0, Tone.now() - playbackStartedAtRef.current);
        return Math.min(playbackOffsetRef.current + elapsed, durationRef.current);
    }, []);

    const startFromPosition = useCallback((time: number) => {
        const player = playerRef.current;
        if (!player || !isLoadedRef.current || time >= durationRef.current) return false;

        if (player.state === 'started') player.stop();
        const startAt = Tone.now() + PLAYBACK_FADE_TIME;
        player.start(startAt, time);

        playbackStartedAtRef.current = startAt;
        playbackOffsetRef.current = time;
        updatePosition(time);
        isPlayingRef.current = true;
        setIsPlaying(true);
        return true;
    }, [updatePosition]);

    useEffect(() => {
        const processor = new AudioEffectsProcessor();
        const masterVolume = new Tone.Volume(0);
        const masterLimiter = new Tone.Limiter(-1);
        processor.connect(masterVolume);
        masterVolume.connect(masterLimiter);
        masterLimiter.toDestination();
        effectsProcessorRef.current = processor;
        masterVolumeRef.current = masterVolume;
        masterLimiterRef.current = masterLimiter;

        return () => {
            if (updateIntervalRef.current) clearInterval(updateIntervalRef.current);
            playerRef.current?.dispose();
            playerRef.current = null;
            processor.dispose();
            masterVolume.dispose();
            masterLimiter.dispose();
            effectsProcessorRef.current = null;
            masterVolumeRef.current = null;
            masterLimiterRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (!isPlaying) return;

        updateIntervalRef.current = setInterval(() => {
            const nextPosition = getPlaybackPosition();
            if (nextPosition >= durationRef.current) {
                playerRef.current?.stop();
                updatePosition(durationRef.current);
                isPlayingRef.current = false;
                setIsPlaying(false);
                resumeAfterSeekRef.current = false;
            } else {
                updatePosition(nextPosition);
            }
        }, 50);

        return () => {
            if (updateIntervalRef.current) {
                clearInterval(updateIntervalRef.current);
                updateIntervalRef.current = null;
            }
        };
    }, [isPlaying, getPlaybackPosition, updatePosition]);

    useEffect(() => {
        effectsProcessorRef.current?.updateEffectsChain(effects);
    }, [effects]);

    const clearAllResources = useCallback(() => {
        if (updateIntervalRef.current) {
            clearInterval(updateIntervalRef.current);
            updateIntervalRef.current = null;
        }
        if (playerRef.current) {
            playerRef.current.stop();
            playerRef.current.dispose();
            playerRef.current = null;
        }

        setEffects([]);
        audioBufferRef.current = null;
        isLoadedRef.current = false;
        isPlayingRef.current = false;
        playPendingRef.current = false;
        resumeAfterSeekRef.current = false;
        positionRef.current = 0;
        durationRef.current = 0;
        setIsLoaded(false);
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(0);
    }, []);

    const loadAudio = useCallback(async (audioBuffer: AudioBuffer, originalDuration?: number) => {
        try {
            clearAllResources();
            if (Tone.context.state !== 'running') await Tone.start();

            const player = new Tone.Player(audioBuffer);
            player.fadeIn = PLAYBACK_FADE_TIME;
            player.fadeOut = PLAYBACK_FADE_TIME;
            if (!effectsProcessorRef.current) throw new Error('音频处理器尚未初始化');
            player.connect(effectsProcessorRef.current.getInput());

            const loadedDuration = originalDuration || audioBuffer.duration;
            audioBufferRef.current = audioBuffer;
            playerRef.current = player;
            durationRef.current = loadedDuration;
            isLoadedRef.current = true;
            setDuration(loadedDuration);
            setCurrentTime(0);
            setIsLoaded(true);
            setIsPlaying(false);
        } catch {
            clearAllResources();
        }
    }, [clearAllResources]);

    const play = useCallback(async () => {
        if (!isLoadedRef.current || !playerRef.current || isPlayingRef.current || playPendingRef.current) return;
        playPendingRef.current = true;

        try {
            if (Tone.context.state !== 'running') await Tone.start();
            const startPosition = positionRef.current >= durationRef.current ? 0 : positionRef.current;
            startFromPosition(startPosition);
        } catch {
            isPlayingRef.current = false;
            setIsPlaying(false);
        } finally {
            playPendingRef.current = false;
        }
    }, [startFromPosition]);

    const pause = useCallback(() => {
        if (!playerRef.current || !isPlayingRef.current) return;
        updatePosition(getPlaybackPosition());
        playerRef.current.stop();
        isPlayingRef.current = false;
        setIsPlaying(false);
    }, [getPlaybackPosition, updatePosition]);

    const stop = useCallback(() => {
        resumeAfterSeekRef.current = false;
        playerRef.current?.stop();
        isPlayingRef.current = false;
        setIsPlaying(false);
        updatePosition(0);
    }, [updatePosition]);

    const beginSeek = useCallback(() => {
        if (!isLoadedRef.current) return;
        resumeAfterSeekRef.current = isPlayingRef.current;
        if (isPlayingRef.current) pause();
    }, [pause]);

    const previewSeek = useCallback((time: number) => {
        if (isLoadedRef.current) updatePosition(time);
    }, [updatePosition]);

    const seek = useCallback((time: number) => {
        if (!isLoadedRef.current || !playerRef.current) return;
        const shouldResume = resumeAfterSeekRef.current || isPlayingRef.current;
        resumeAfterSeekRef.current = false;
        updatePosition(time);

        if (shouldResume && positionRef.current < durationRef.current) {
            startFromPosition(positionRef.current);
        } else {
            playerRef.current.stop();
            isPlayingRef.current = false;
            setIsPlaying(false);
        }
    }, [startFromPosition, updatePosition]);

    const setVolume = useCallback((newVolume: number) => {
        const clampedVolume = Math.max(0, Math.min(newVolume, 1));
        if (masterVolumeRef.current) {
            const dbValue = clampedVolume === 0 ? -Infinity : Tone.gainToDb(clampedVolume);
            masterVolumeRef.current.volume.rampTo(dbValue, 0.02);
        }
        setVolumeState(clampedVolume);
    }, []);

    const addEffect = useCallback((effectType: EffectType) => {
        const effectId = `${effectType}_${++effectCounterRef.current}`;
        setEffects(previous => [...previous, {
            id: effectId,
            name: effectNames[effectType],
            type: effectType,
            enabled: true,
            parameters: getDefaultEffectParameters(effectType),
            order: previous.length,
            ...(effectType === 'eq' ? { eqBands: createDefaultEqBands() } : {}),
            ...(effectType === 'distortion' ? { shaperPoints: createDefaultShaperPoints() } : {}),
        }]);
    }, []);

    const removeEffect = useCallback((effectId: string) => {
        setEffects(previous => previous
            .filter(effect => effect.id !== effectId)
            .map((effect, index) => ({ ...effect, order: index }))
        );
    }, []);

    const toggleEffect = useCallback((effectId: string) => {
        setEffects(previous => previous.map(effect =>
            effect.id === effectId ? { ...effect, enabled: !effect.enabled } : effect
        ));
    }, []);

    const updateEffect = useCallback((effectId: string, parameters: Record<string, number>) => {
        setEffects(previous => previous.map(effect =>
            effect.id === effectId
                ? { ...effect, parameters: { ...effect.parameters, ...parameters } }
                : effect
        ));
    }, []);

    const updateEffectEqBands = useCallback((effectId: string, bands: EqBandData[]) => {
        setEffects(previous => previous.map(effect =>
            effect.id === effectId ? { ...effect, eqBands: bands } : effect
        ));
    }, []);

    const updateEffectShaperPoints = useCallback((effectId: string, points: ShaperPoint[]) => {
        setEffects(previous => previous.map(effect =>
            effect.id === effectId ? { ...effect, shaperPoints: points } : effect
        ));
    }, []);

    const reorderEffects = useCallback((newEffects: EffectConfig[]) => {
        setEffects(newEffects);
    }, []);

    const exportAudio = useCallback(async (filename?: string) => {
        const sourceBuffer = audioBufferRef.current;
        if (!sourceBuffer) throw new Error('没有可导出的音频数据');

        const renderDuration = (durationRef.current || sourceBuffer.duration)
            + getEffectsTailDuration(effects);
        const toneAudioBuffer = await Tone.Offline(async () => {
            const offlinePlayer = new Tone.Player(sourceBuffer);
            const offlineProcessor = new AudioEffectsProcessor();
            const offlineVolume = new Tone.Volume(Tone.gainToDb(volume));
            const offlineLimiter = new Tone.Limiter(-1);

            offlinePlayer.connect(offlineProcessor.getInput());
            offlineProcessor.connect(offlineVolume);
            offlineVolume.connect(offlineLimiter);
            offlineLimiter.toDestination();
            offlineProcessor.updateEffectsChain(effects);
            await offlineProcessor.ready();
            offlinePlayer.start(0);
        }, renderDuration);

        const renderedBuffer = toneAudioBuffer.get();
        if (!renderedBuffer) throw new Error('无法获取渲染后的音频数据');

        const customName = filename?.trim();
        const outputName = customName
            ? (/\.wav$/i.test(customName) ? customName : `${customName}.wav`)
            : `audio_export_${Date.now()}.wav`;
        exportWAV(renderedBuffer, outputName);
    }, [effects, volume]);

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
        beginSeek,
        previewSeek,
        seek,
        setVolume,
        loadAudio,
        clearAudio: clearAllResources,
        addEffect,
        removeEffect,
        toggleEffect,
        updateEffect,
        updateEffectEqBands,
        updateEffectShaperPoints,
        reorderEffects,
        exportAudio,
    };
};
