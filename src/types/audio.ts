export interface AudioFile {
    file: File;
    url: string;
    name: string;
    duration: number;
    size: number;
}

export type EqBandType =
    | 'lowpass'
    | 'highpass'
    | 'bandpass'
    | 'notch'
    | 'peaking'
    | 'lowshelf'
    | 'highshelf';

export interface EqBandData {
    id: string;
    type: EqBandType;
    freq: number;
    /** dB，仅对 peaking/lowshelf/highshelf 生效 */
    gain: number;
    q: number;
}

/** 失真波形整形曲线控制点：x 为输入(-1..1)，y 为输出(-1..1) */
export interface ShaperPoint {
    x: number;
    y: number;
}

export interface EffectConfig {
    id: string;
    name: string;
    type: EffectType;
    enabled: boolean;
    parameters: Record<string, number>;
    order: number;
    /** 仅 eq 类型使用：动态频段列表 */
    eqBands?: EqBandData[];
    /** 仅 distortion 类型使用：波形整形曲线控制点 */
    shaperPoints?: ShaperPoint[];
}

export type EffectType =
    | 'reverb'
    | 'eq'
    | 'compressor'
    | 'delay'
    | 'chorus'
    | 'phaser'
    | 'distortion'
    | 'filter'
    | 'limiter'
    | 'gate';

 