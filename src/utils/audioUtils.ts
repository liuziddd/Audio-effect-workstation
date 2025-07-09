import * as Tone from 'tone';
import { EffectType } from '../types/audio';

export const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

export const formatFileSize = (bytes: number): string => {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
};

export const createEffect = (type: EffectType, config?: Record<string, number>): Tone.ToneAudioNode => {
    switch (type) {
        case 'reverb':
            return new Tone.Reverb({
                decay: config?.decay || 1.5,
                preDelay: config?.preDelay || 0.01,
                wet: config?.wet || 0.3
            });

        case 'eq':
            return new Tone.EQ3({
                low: config?.low || 0,
                mid: config?.mid || 0,
                high: config?.high || 0,
                lowFrequency: config?.lowFrequency || 400,
                highFrequency: config?.highFrequency || 2500
            });

        case 'compressor':
            return new Tone.Compressor({
                threshold: config?.threshold || -24,
                ratio: config?.ratio || 3,
                attack: config?.attack || 0.003,
                release: config?.release || 0.25,
                knee: config?.knee || 30
            });

        case 'delay':
            return new Tone.FeedbackDelay({
                delayTime: config?.delayTime || 0.25,
                feedback: config?.feedback || 0.125,
                wet: config?.wet || 0.2
            });

        case 'chorus':
            return new Tone.Chorus({
                frequency: config?.frequency || 1.5,
                delayTime: config?.delayTime || 3.5,
                depth: config?.depth || 0.7,
                type: 'sine',
                spread: config?.spread || 180,
                wet: config?.wet || 0.3
            });

        case 'phaser':
            return new Tone.Phaser({
                frequency: config?.frequency || 0.5,
                octaves: config?.octaves || 3,
                stages: config?.stages || 10,
                Q: config?.Q || 10,
                baseFrequency: config?.baseFrequency || 350,
                wet: config?.wet || 0.3
            });

        case 'distortion':
            return new Tone.Distortion({
                distortion: config?.distortion || 0.4,
                oversample: '4x',
                wet: config?.wet || 0.5
            });

        case 'filter':
            return new Tone.Filter({
                frequency: config?.frequency || 350,
                type: 'lowpass',
                rolloff: -12,
                Q: config?.Q || 1,
                gain: config?.gain || 0
            });

        case 'limiter':
            return new Tone.Limiter({
                threshold: config?.threshold || -12
            });

        case 'gate':
            return new Tone.Gate({
                threshold: config?.threshold || -50,
                smoothing: config?.smoothing || 0.1
            });

        default:
            throw new Error(`Unknown effect type: ${type}`);
    }
};

export const getEffectParameters = (type: EffectType): Record<string, any> => {
    const parameterDefinitions = {
        reverb: {
            decay: { min: 0.1, max: 10, step: 0.1, default: 1.5, unit: 's' },
            preDelay: { min: 0, max: 1, step: 0.01, default: 0.01, unit: 's' },
            wet: { min: 0, max: 1, step: 0.01, default: 0.3, unit: '' }
        },
        eq: {
            low: { min: -15, max: 15, step: 0.5, default: 0, unit: 'dB' },
            mid: { min: -15, max: 15, step: 0.5, default: 0, unit: 'dB' },
            high: { min: -15, max: 15, step: 0.5, default: 0, unit: 'dB' },
            lowFrequency: { min: 40, max: 1000, step: 10, default: 400, unit: 'Hz' },
            highFrequency: { min: 1000, max: 10000, step: 100, default: 2500, unit: 'Hz' }
        },
        compressor: {
            threshold: { min: -60, max: 0, step: 1, default: -24, unit: 'dB' },
            ratio: { min: 1, max: 20, step: 0.1, default: 3, unit: ':1' },
            attack: { min: 0, max: 1, step: 0.001, default: 0.003, unit: 's' },
            release: { min: 0, max: 1, step: 0.01, default: 0.25, unit: 's' },
            knee: { min: 0, max: 40, step: 1, default: 30, unit: 'dB' }
        },
        delay: {
            delayTime: { min: 0, max: 1, step: 0.01, default: 0.25, unit: 's' },
            feedback: { min: 0, max: 0.9, step: 0.01, default: 0.125, unit: '' },
            wet: { min: 0, max: 1, step: 0.01, default: 0.2, unit: '' }
        },
        chorus: {
            frequency: { min: 0.1, max: 10, step: 0.1, default: 1.5, unit: 'Hz' },
            delayTime: { min: 1, max: 10, step: 0.1, default: 3.5, unit: 'ms' },
            depth: { min: 0, max: 1, step: 0.01, default: 0.7, unit: '' },
            spread: { min: 0, max: 360, step: 1, default: 180, unit: '°' },
            wet: { min: 0, max: 1, step: 0.01, default: 0.3, unit: '' }
        },
        phaser: {
            frequency: { min: 0.1, max: 10, step: 0.1, default: 0.5, unit: 'Hz' },
            octaves: { min: 1, max: 8, step: 1, default: 3, unit: '' },
            stages: { min: 2, max: 20, step: 1, default: 10, unit: '' },
            Q: { min: 1, max: 30, step: 1, default: 10, unit: '' },
            baseFrequency: { min: 50, max: 1000, step: 10, default: 350, unit: 'Hz' },
            wet: { min: 0, max: 1, step: 0.01, default: 0.3, unit: '' }
        },
        distortion: {
            distortion: { min: 0, max: 1, step: 0.01, default: 0.4, unit: '' },
            wet: { min: 0, max: 1, step: 0.01, default: 0.5, unit: '' }
        },
        filter: {
            frequency: { min: 20, max: 20000, step: 1, default: 350, unit: 'Hz' },
            Q: { min: 0.1, max: 30, step: 0.1, default: 1, unit: '' },
            gain: { min: -40, max: 40, step: 0.5, default: 0, unit: 'dB' }
        },
        limiter: {
            threshold: { min: -60, max: 0, step: 1, default: -12, unit: 'dB' }
        },
        gate: {
            threshold: { min: -80, max: -10, step: 1, default: -50, unit: 'dB' },
            smoothing: { min: 0, max: 1, step: 0.01, default: 0.1, unit: 's' }
        }
    };

    return parameterDefinitions[type] || {};
};

// 检查浏览器对音频格式的支持
export const checkAudioSupport = () => {
    const audio = new Audio();
    const support = {
        mp3: !!(audio.canPlayType && audio.canPlayType('audio/mpeg').replace(/no/, '')),
        wav: !!(audio.canPlayType && audio.canPlayType('audio/wav').replace(/no/, '')),
        ogg: !!(audio.canPlayType && audio.canPlayType('audio/ogg').replace(/no/, '')),
        aac: !!(audio.canPlayType && audio.canPlayType('audio/aac').replace(/no/, '')),
        m4a: !!(audio.canPlayType && audio.canPlayType('audio/mp4').replace(/no/, '')),
        webm: !!(audio.canPlayType && audio.canPlayType('audio/webm').replace(/no/, '')),
        flac: !!(audio.canPlayType && audio.canPlayType('audio/flac').replace(/no/, ''))
    };

    console.log('🔍 浏览器音频格式支持:', support);
    return support;
};

// 从文件名获取扩展名
export const getFileExtension = (filename: string): string => {
    return filename.split('.').pop()?.toLowerCase() || '';
};

// 验证音频文件
export const validateAudioFile = (file: File): { valid: boolean; error?: string; suggestion?: string } => {
    const maxSize = 50 * 1024 * 1024; // 50MB

    // 检查文件大小
    if (file.size > maxSize) {
        return {
            valid: false,
            error: `文件太大 (${(file.size / 1024 / 1024).toFixed(1)}MB)，最大支持50MB`
        };
    }

    // 检查文件扩展名
    const extension = getFileExtension(file.name);
    const supportedExtensions = ['mp3', 'wav', 'ogg', 'aac', 'm4a', 'webm', 'flac'];

    if (!supportedExtensions.includes(extension)) {
        return {
            valid: false,
            error: `不支持的文件格式: .${extension}`,
            suggestion: `请使用以下格式: ${supportedExtensions.join(', ')}`
        };
    }

    // 检查MIME类型
    const supportedMimeTypes = [
        'audio/mpeg',     // MP3 (标准)
        'audio/mp3',      // MP3 (备用)
        'audio/x-mpeg',   // MP3 (备用)
        'audio/mpeg3',    // MP3 (备用)
        'audio/wav',      // WAV
        'audio/wave',     // WAV (备用)
        'audio/x-wav',    // WAV (备用)
        'audio/ogg',      // OGG
        'audio/ogg; codecs="vorbis"', // OGG Vorbis
        'audio/mp4',      // M4A/AAC
        'audio/aac',      // AAC
        'audio/x-aac',    // AAC (备用)
        'audio/webm',     // WebM
        'audio/webm; codecs="vorbis"', // WebM Vorbis
        'audio/flac',     // FLAC
        'audio/x-flac'    // FLAC (备用)
    ];

    // 如果MIME类型不在支持列表中，但扩展名支持，仍然尝试加载
    if (!supportedMimeTypes.includes(file.type) && file.type !== '') {
        console.warn(`⚠️ MIME类型 "${file.type}" 可能不被支持，但将尝试按扩展名 ".${extension}" 处理`);
    }

    return { valid: true };
};

// 检测音频文件的实际可播放性
export const testAudioPlayability = (file: File): Promise<{ playable: boolean; error?: string; duration?: number }> => {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const audio = new Audio();

        let resolved = false;

        const cleanup = () => {
            if (!resolved) {
                resolved = true;
                URL.revokeObjectURL(url);
            }
        };

        // 成功加载
        audio.addEventListener('loadedmetadata', () => {
            cleanup();
            console.log('🎵 音频可播放性测试成功:', {
                '文件名': file.name,
                '时长': audio.duration,
                '采样率': '未知', // HTML audio元素无法直接获取采样率
                'readyState': audio.readyState,
                'networkState': audio.networkState
            });

            // 确保时长是有效的数字
            const validDuration = audio.duration && isFinite(audio.duration) && audio.duration > 0
                ? audio.duration
                : 0;

            resolve({
                playable: true,
                duration: validDuration
            });
        }, { once: true });

        // 加载失败
        audio.addEventListener('error', () => {
            cleanup();
            const error = audio.error;
            let errorMessage = '未知错误';

            if (error) {
                switch (error.code) {
                    case MediaError.MEDIA_ERR_ABORTED:
                        errorMessage = '播放被中止';
                        break;
                    case MediaError.MEDIA_ERR_NETWORK:
                        errorMessage = '网络错误';
                        break;
                    case MediaError.MEDIA_ERR_DECODE:
                        errorMessage = '音频解码失败，文件可能损坏或格式不受支持';
                        break;
                    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                        errorMessage = '音频格式不受浏览器支持';
                        break;
                }
            }

            console.error('❌ 音频可播放性测试失败:', {
                '文件名': file.name,
                '错误代码': error?.code,
                '错误信息': errorMessage
            });

            resolve({
                playable: false,
                error: errorMessage
            });
        }, { once: true });

        // 超时处理
        setTimeout(() => {
            if (!resolved) {
                cleanup();
                console.warn('⏰ 音频可播放性测试超时:', file.name);
                resolve({
                    playable: false,
                    error: '音频加载超时'
                });
            }
        }, 10000);

        // 开始加载
        audio.src = url;
        audio.preload = 'metadata';
        console.log('🧪 开始测试音频可播放性:', file.name);
    });
}; 