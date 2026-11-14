import { EffectType, EqBandData, ShaperPoint } from '../types/audio';

interface EffectParameterDefinition {
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
        drive: { min: -24, max: 24, step: 0.5, default: 6, unit: 'dB', label: '驱动' },
        output: { min: -24, max: 24, step: 0.5, default: 0, unit: 'dB', label: '输出' },
        tone: { min: 100, max: 20000, step: 100, default: 20000, unit: 'Hz', label: '音色（低通）', control: 'slider' },
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

/** 失真波形整形默认曲线：标准软削波——中心段(-0.5~+0.5)斜率 1.4 放大、两端斜率 0.6 压缩趋于饱和（类 tanh），配合 drive 增益把信号推进非线性区 */
export const createDefaultShaperPoints = (): ShaperPoint[] => [
    { x: -1, y: -1 },
    { x: -0.5, y: -0.7 },
    { x: 0, y: 0 },
    { x: 0.5, y: 0.7 },
    { x: 1, y: 1 },
];

// 验证音频文件：大小 ≤ 50MB 且扩展名在支持列表内
export const validateAudioFile = (file: File): boolean => {
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    return file.size <= 50 * 1024 * 1024 &&
        ['mp3', 'wav', 'ogg', 'aac', 'm4a', 'webm', 'flac'].includes(extension);
};
