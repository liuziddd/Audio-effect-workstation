import { EffectType, EqBandData, ShaperPoint } from '../types/audio';

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

export interface EffectParameterDefinition {
    min: number;
    max: number;
    step: number;
    default: number;
    unit: string;
    label: string;
    /** 控件类型：默认旋钮，slider 用于对数频率类参数，select 用于枚举参数 */
    control?: 'knob' | 'slider' | 'select';
    /** select 控件的选项（索引值映射） */
    options?: string[];
}

export const effectParameterDefinitions: Record<EffectType, Record<string, EffectParameterDefinition>> = {
    reverb: {
        mix: { min: 0, max: 1, step: 0.01, default: 0.35, unit: '', label: '干湿比' },
        decay: { min: 0.1, max: 20, step: 0.1, default: 3, unit: 's', label: '衰减' },
        preDelay: { min: 0, max: 0.3, step: 0.005, default: 0.02, unit: 's', label: '预延迟' },
        size: { min: 0.1, max: 3, step: 0.05, default: 1, unit: '', label: '空间大小' },
        damping: { min: 0, max: 1, step: 0.01, default: 0.5, unit: '', label: '高频阻尼' },
    },
    eq: {},
    compressor: {
        threshold: { min: -60, max: 0, step: 1, default: -18, unit: 'dB', label: '阈值' },
        ratio: { min: 1, max: 20, step: 0.5, default: 3, unit: ':1', label: '压缩比' },
        attack: { min: 0.001, max: 0.2, step: 0.001, default: 0.003, unit: 's', label: '启动' },
        release: { min: 0.01, max: 1, step: 0.01, default: 0.25, unit: 's', label: '释放' },
        knee: { min: 0, max: 40, step: 1, default: 12, unit: 'dB', label: '拐点' },
        makeup: { min: 0, max: 24, step: 0.5, default: 0, unit: 'dB', label: '补偿增益' },
    },
    delay: {
        time: { min: 0.01, max: 1, step: 0.01, default: 0.25, unit: 's', label: '延迟时间' },
        feedback: { min: 0, max: 0.9, step: 0.01, default: 0.25, unit: '', label: '反馈' },
        mix: { min: 0, max: 1, step: 0.01, default: 0.25, unit: '', label: '干湿比' },
        tone: { min: 100, max: 8000, step: 10, default: 4000, unit: 'Hz', label: '音色（低通）', control: 'slider' },
    },
    chorus: {
        rate: { min: 0.1, max: 8, step: 0.1, default: 1.5, unit: 'Hz', label: '调制速率' },
        delay: { min: 2, max: 20, step: 0.1, default: 3.5, unit: 'ms', label: '基础延迟' },
        depth: { min: 0, max: 1, step: 0.01, default: 0.5, unit: '', label: '深度' },
        feedback: { min: 0, max: 0.95, step: 0.01, default: 0, unit: '', label: '反馈' },
        spread: { min: 0, max: 360, step: 1, default: 180, unit: '°', label: '立体声宽度' },
        mix: { min: 0, max: 1, step: 0.01, default: 0.35, unit: '', label: '干湿比' },
    },
    phaser: {
        rate: { min: 0.1, max: 8, step: 0.1, default: 0.8, unit: 'Hz', label: '调制速率' },
        octaves: { min: 0.5, max: 6, step: 0.5, default: 3, unit: '', label: '扫频范围' },
        stages: { min: 2, max: 12, step: 2, default: 6, unit: '', label: '级数' },
        Q: { min: 0.5, max: 20, step: 0.5, default: 8, unit: '', label: '谐振' },
        baseFrequency: { min: 50, max: 2000, step: 10, default: 350, unit: 'Hz', label: '基础频率', control: 'slider' },
        mix: { min: 0, max: 1, step: 0.01, default: 0.5, unit: '', label: '干湿比' },
    },
    distortion: {
        drive: { min: -24, max: 24, step: 0.5, default: 0, unit: 'dB', label: '驱动' },
        output: { min: -24, max: 24, step: 0.5, default: 0, unit: 'dB', label: '输出' },
        tone: { min: 100, max: 20000, step: 100, default: 10000, unit: 'Hz', label: '音色（低通）', control: 'slider' },
        mix: { min: 0, max: 1, step: 0.01, default: 0.5, unit: '', label: '干湿比' },
        oversample: { min: 0, max: 4, step: 2, default: 4, unit: 'x', label: '过采样' },
    },
    filter: {
        type: { min: 0, max: 6, step: 1, default: 0, unit: '', label: '类型', control: 'select', options: ['低通', '高通', '带通', '陷波', '峰值', '低架', '高架'] },
        frequency: { min: 20, max: 20000, step: 10, default: 1000, unit: 'Hz', label: '截止频率', control: 'slider' },
        Q: { min: 0.1, max: 20, step: 0.1, default: 0.707, unit: '', label: '谐振' },
        gain: { min: -40, max: 40, step: 0.5, default: 0, unit: 'dB', label: '增益' },
    },
    limiter: {
        gain: { min: -24, max: 24, step: 0.5, default: 0, unit: 'dB', label: '输入增益' },
        threshold: { min: -30, max: 0, step: 0.5, default: -3, unit: 'dB', label: '阈值' },
        attack: { min: 0.001, max: 0.05, step: 0.001, default: 0.003, unit: 's', label: '启动' },
        release: { min: 0.01, max: 1, step: 0.01, default: 0.1, unit: 's', label: '释放' },
        ceiling: { min: -12, max: 0, step: 0.1, default: -0.1, unit: 'dB', label: '输出上限' },
    },
    gate: {
        threshold: { min: -80, max: 0, step: 1, default: -45, unit: 'dB', label: '阈值' },
        smoothing: { min: 0.005, max: 0.5, step: 0.005, default: 0.05, unit: 's', label: '包络平滑' },
    },
};

export const getDefaultEffectParameters = (type: EffectType): Record<string, number> =>
    Object.fromEntries(
        Object.entries(effectParameterDefinitions[type]).map(([name, definition]) => [name, definition.default])
    );

let eqBandSeq = 0;
const newEqBandId = () => `b${Date.now().toString(36)}${(eqBandSeq++).toString(36)}`;

/** 生成一个新的 EQ 频段（默认峰值型，位于图形中部） */
export const createEqBand = (freq: number, gain = 0, type: EqBandData['type'] = 'peaking'): EqBandData => ({
    id: newEqBandId(),
    type,
    freq,
    gain,
    q: type === 'peaking' ? 1 : 0.707,
});

/** 均衡器默认频段：低架 + 三段峰值 + 高架 */
export const createDefaultEqBands = (): EqBandData[] => [
    { id: newEqBandId(), type: 'lowshelf', freq: 100, gain: 0, q: 0.707 },
    { id: newEqBandId(), type: 'peaking', freq: 250, gain: 0, q: 1 },
    { id: newEqBandId(), type: 'peaking', freq: 1000, gain: 0, q: 1 },
    { id: newEqBandId(), type: 'peaking', freq: 4000, gain: 0, q: 1 },
    { id: newEqBandId(), type: 'highshelf', freq: 8000, gain: 0, q: 0.707 },
];

/** 失真波形整形默认曲线：首尾端点固定(-1,-1)/(1,1)，中间两点构成轻微软削波 */
export const createDefaultShaperPoints = (): ShaperPoint[] => [
    { x: -1, y: -1 },
    { x: -0.5, y: -0.35 },
    { x: 0, y: 0 },
    { x: 0.5, y: 0.35 },
    { x: 1, y: 1 },
];

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