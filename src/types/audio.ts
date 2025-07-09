export interface AudioFile {
    file: File;
    url: string;
    name: string;
    duration: number;
    size: number;
}

export interface EffectConfig {
    id: string;
    name: string;
    type: EffectType;
    enabled: boolean;
    parameters: Record<string, number>;
    order: number;
    instanceId?: string; // 用于区分同类型的多个实例
    bypass?: boolean; // 是否绕过效果器
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

 