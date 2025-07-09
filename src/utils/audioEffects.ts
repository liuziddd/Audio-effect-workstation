import * as Tone from 'tone';
import { EffectConfig } from '../types/audio';

export class AudioEffectsProcessor {
    private effects: Map<string, any> = new Map();
    private effectsChain: any[] = [];
    private input: Tone.Gain;
    private output: Tone.Gain;

    constructor() {
        this.input = new Tone.Gain(1);
        this.output = new Tone.Gain(1);

        // 初始连接（无效果器时直接连接）
        this.input.connect(this.output);
    }

    private createEffect(effectConfig: EffectConfig): any {
        const { type, parameters } = effectConfig;

        switch (type) {
            case 'reverb': {
                const reverb = new Tone.Reverb({
                    decay: parameters.decay ?? 2,
                    wet: parameters.wetness ?? 0.3,
                });
                return reverb;
            }

            case 'eq': {
                const eq = new Tone.EQ3({
                    low: parameters.lowGain ?? 0,
                    mid: parameters.midGain ?? 0,
                    high: parameters.highGain ?? 0,
                    lowFrequency: parameters.lowFreq ?? 200,
                    highFrequency: parameters.highFreq ?? 8000,
                });
                return eq;
            }

            case 'compressor': {
                const compressor = new Tone.Compressor({
                    threshold: parameters.threshold ?? -20,
                    ratio: parameters.ratio ?? 4,
                    attack: parameters.attack ?? 0.01,
                    release: parameters.release ?? 0.1,
                });
                return compressor;
            }

            case 'delay': {
                const delay = new Tone.FeedbackDelay({
                    delayTime: parameters.time ?? 0.25,
                    feedback: parameters.feedback ?? 0.3,
                    wet: parameters.wetness ?? 0.3,
                });
                return delay;
            }

            case 'chorus': {
                const chorus = new Tone.Chorus({
                    frequency: parameters.frequency ?? 2,
                    depth: parameters.depth ?? 0.3,
                    wet: parameters.wetness ?? 0.5,
                });
                chorus.start();
                return chorus;
            }

            case 'phaser': {
                const phaser = new Tone.Phaser({
                    frequency: parameters.frequency ?? 1,
                    octaves: parameters.depth ?? 0.5,
                    stages: Math.round(parameters.stages ?? 6),
                });
                return phaser;
            }

            case 'distortion': {
                const distortion = new Tone.Distortion({
                    distortion: parameters.drive ?? 0.3,
                    oversample: `${Math.round(parameters.oversample ?? 2)}x` as any,
                });
                return distortion;
            }

            case 'filter': {
                const filter = new Tone.Filter({
                    frequency: parameters.frequency ?? 1000,
                    Q: parameters.Q ?? 1,
                    gain: parameters.gain ?? 0,
                    type: 'lowpass',
                });
                return filter;
            }

            case 'limiter': {
                const limiter = new Tone.Limiter({
                    threshold: parameters.threshold ?? -6,
                });
                return limiter;
            }

            case 'gate': {
                const gate = new Tone.Gate({
                    threshold: parameters.threshold ?? -30,
                    smoothing: parameters.release ?? 0.1,
                });
                return gate;
            }

            default:
                throw new Error(`Unsupported effect type: ${type}`);
        }
    }

    private updateEffectParameters(effect: any, effectConfig: EffectConfig) {
        const { type, parameters } = effectConfig;

        try {
            switch (type) {
                case 'reverb':
                    if (parameters.decay !== undefined) effect.decay = parameters.decay;
                    if (parameters.wetness !== undefined) effect.wet.value = parameters.wetness;
                    break;

                case 'eq':
                    if (parameters.lowGain !== undefined) effect.low.value = parameters.lowGain;
                    if (parameters.midGain !== undefined) effect.mid.value = parameters.midGain;
                    if (parameters.highGain !== undefined) effect.high.value = parameters.highGain;
                    if (parameters.lowFreq !== undefined) effect.lowFrequency.value = parameters.lowFreq;
                    if (parameters.highFreq !== undefined) effect.highFrequency.value = parameters.highFreq;
                    break;

                case 'compressor':
                    if (parameters.threshold !== undefined) effect.threshold.value = parameters.threshold;
                    if (parameters.ratio !== undefined) effect.ratio.value = parameters.ratio;
                    if (parameters.attack !== undefined) effect.attack.value = parameters.attack;
                    if (parameters.release !== undefined) effect.release.value = parameters.release;
                    break;

                case 'delay':
                    if (parameters.time !== undefined) effect.delayTime.value = parameters.time;
                    if (parameters.feedback !== undefined) effect.feedback.value = parameters.feedback;
                    if (parameters.wetness !== undefined) effect.wet.value = parameters.wetness;
                    break;

                case 'chorus':
                    if (parameters.frequency !== undefined) effect.frequency.value = parameters.frequency;
                    if (parameters.depth !== undefined) effect.depth = parameters.depth;
                    if (parameters.wetness !== undefined) effect.wet.value = parameters.wetness;
                    break;

                case 'phaser':
                    if (parameters.frequency !== undefined) effect.frequency.value = parameters.frequency;
                    if (parameters.depth !== undefined) effect.octaves = parameters.depth;
                    break;

                case 'distortion':
                    if (parameters.drive !== undefined) effect.distortion = parameters.drive;
                    break;

                case 'filter':
                    if (parameters.frequency !== undefined) effect.frequency.value = parameters.frequency;
                    if (parameters.Q !== undefined) effect.Q.value = parameters.Q;
                    if (parameters.gain !== undefined) effect.gain.value = parameters.gain;
                    break;

                case 'limiter':
                    if (parameters.threshold !== undefined) effect.threshold.value = parameters.threshold;
                    break;

                case 'gate':
                    if (parameters.threshold !== undefined) effect.threshold.value = parameters.threshold;
                    if (parameters.release !== undefined) effect.smoothing = parameters.release;
                    break;
            }
        } catch (error) {
            console.warn(`Failed to update parameters for effect ${type}:`, error);
        }
    }

    updateEffectsChain(effectConfigs: EffectConfig[]) {
        // 断开所有连接
        this.disconnectAll();

        // 清理旧效果器
        this.effects.forEach((effect) => {
            try {
                if (effect.dispose) {
                    effect.dispose();
                }
            } catch (error) {
                console.warn('Error disposing effect:', error);
            }
        });
        this.effects.clear();
        this.effectsChain = [];

        // 创建新的效果器链
        const enabledEffects = effectConfigs
            .filter(config => config.enabled && !config.bypass)
            .sort((a, b) => a.order - b.order);

        let currentNode = this.input;

        for (const effectConfig of enabledEffects) {
            try {
                const effect = this.createEffect(effectConfig);
                this.effects.set(effectConfig.id, effect);
                this.effectsChain.push(effect);

                // 连接到链中
                currentNode.connect(effect);
                currentNode = effect;
            } catch (error) {
                console.error(`Failed to create effect ${effectConfig.type}:`, error);
            }
        }

        // 连接到输出
        currentNode.connect(this.output);
    }

    updateEffect(effectId: string, parameters: Record<string, number>) {
        const effect = this.effects.get(effectId);
        if (!effect) return;

        // 找到对应的配置
        const effectConfig = { id: effectId, parameters } as EffectConfig;

        // 根据效果器类型确定类型
        if (effect instanceof Tone.Reverb) effectConfig.type = 'reverb';
        else if (effect instanceof Tone.EQ3) effectConfig.type = 'eq';
        else if (effect instanceof Tone.Compressor) effectConfig.type = 'compressor';
        else if (effect instanceof Tone.FeedbackDelay) effectConfig.type = 'delay';
        else if (effect instanceof Tone.Chorus) effectConfig.type = 'chorus';
        else if (effect instanceof Tone.Phaser) effectConfig.type = 'phaser';
        else if (effect instanceof Tone.Distortion) effectConfig.type = 'distortion';
        else if (effect instanceof Tone.Filter) effectConfig.type = 'filter';
        else if (effect instanceof Tone.Limiter) effectConfig.type = 'limiter';
        else if (effect instanceof Tone.Gate) effectConfig.type = 'gate';

        this.updateEffectParameters(effect, effectConfig);
    }

    private disconnectAll() {
        // 断开输入连接
        this.input.disconnect();

        // 断开效果器链
        this.effectsChain.forEach((effect) => {
            try {
                if (effect.disconnect) {
                    effect.disconnect();
                }
            } catch (error) {
                console.warn('Error disconnecting effect:', error);
            }
        });

        // 重新连接输入到输出（绕过所有效果器）
        this.input.connect(this.output);
    }

    connect(destination: any) {
        this.output.connect(destination);
    }

    disconnect() {
        this.output.disconnect();
    }

    dispose() {
        this.disconnectAll();

        this.effects.forEach((effect) => {
            try {
                if (effect.dispose) {
                    effect.dispose();
                }
            } catch (error) {
                console.warn('Error disposing effect:', error);
            }
        });

        this.input.dispose();
        this.output.dispose();
        this.effects.clear();
        this.effectsChain = [];
    }

    getInput() {
        return this.input;
    }

    getOutput() {
        return this.output;
    }
} 