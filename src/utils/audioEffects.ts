import * as Tone from 'tone';
import { EffectConfig } from '../types/audio';

type EffectNode =
    | Tone.Reverb
    | Tone.EQ3
    | Tone.Compressor
    | Tone.FeedbackDelay
    | Tone.Chorus
    | Tone.Phaser
    | Tone.Distortion
    | Tone.Filter
    | Tone.Limiter
    | Tone.Gate;

interface EffectEntry {
    node: EffectNode;
    config: EffectConfig;
}

const PARAMETER_RAMP_TIME = 0.02;

const oversampleType = (value = 4): OverSampleType => {
    if (value >= 4) return '4x';
    if (value >= 2) return '2x';
    return 'none';
};

export const getEffectsTailDuration = (effectConfigs: EffectConfig[]): number => {
    const tails = effectConfigs
        .filter(config => config.enabled && !config.bypass)
        .map(config => {
            if (config.type === 'reverb') {
                return (config.parameters.decay ?? 2) + (config.parameters.preDelay ?? 0);
            }
            if (config.type === 'delay') {
                const delayTime = config.parameters.time ?? 0.25;
                const feedback = config.parameters.feedback ?? 0.25;
                if (feedback <= 0) return delayTime;
                const repeatCount = Math.ceil(Math.log(0.001) / Math.log(Math.min(feedback, 0.95)));
                return delayTime * repeatCount;
            }
            return 0;
        });

    return Math.min(Math.max(...tails, 0), 30);
};

export class AudioEffectsProcessor {
    private effects = new Map<string, EffectEntry>();
    private input = new Tone.Gain(1);
    private output = new Tone.Gain(1);
    private chainKey = '';

    constructor() {
        this.input.connect(this.output);
    }

    private createEffect({ type, parameters }: EffectConfig): EffectNode {
        switch (type) {
            case 'reverb':
                return new Tone.Reverb({
                    decay: parameters.decay ?? 2,
                    preDelay: parameters.preDelay ?? 0.02,
                    wet: parameters.wetness ?? 0.3,
                });
            case 'eq':
                return new Tone.EQ3({
                    low: parameters.lowGain ?? 0,
                    mid: parameters.midGain ?? 0,
                    high: parameters.highGain ?? 0,
                    lowFrequency: parameters.lowFreq ?? 200,
                    highFrequency: parameters.highFreq ?? 4000,
                });
            case 'compressor':
                return new Tone.Compressor({
                    threshold: parameters.threshold ?? -18,
                    ratio: parameters.ratio ?? 3,
                    attack: parameters.attack ?? 0.003,
                    release: parameters.release ?? 0.25,
                    knee: parameters.knee ?? 12,
                });
            case 'delay':
                return new Tone.FeedbackDelay({
                    delayTime: parameters.time ?? 0.25,
                    feedback: parameters.feedback ?? 0.25,
                    wet: parameters.wetness ?? 0.25,
                });
            case 'chorus':
                return new Tone.Chorus({
                    frequency: parameters.frequency ?? 1.5,
                    delayTime: parameters.delayTime ?? 3.5,
                    depth: parameters.depth ?? 0.5,
                    spread: parameters.spread ?? 180,
                    type: 'sine',
                    wet: parameters.wetness ?? 0.35,
                }).start();
            case 'phaser':
                return new Tone.Phaser({
                    frequency: parameters.frequency ?? 0.8,
                    octaves: parameters.octaves ?? 3,
                    stages: Math.round(parameters.stages ?? 6),
                    Q: parameters.Q ?? 8,
                    baseFrequency: parameters.baseFrequency ?? 350,
                    wet: parameters.wetness ?? 0.5,
                });
            case 'distortion':
                return new Tone.Distortion({
                    distortion: parameters.drive ?? 0.3,
                    oversample: oversampleType(parameters.oversample),
                    wet: parameters.wetness ?? 0.5,
                });
            case 'filter':
                return new Tone.Filter({
                    frequency: parameters.frequency ?? 1000,
                    Q: parameters.Q ?? 0.707,
                    type: 'lowpass',
                    rolloff: -12,
                });
            case 'limiter':
                return new Tone.Limiter({ threshold: parameters.threshold ?? -3 });
            case 'gate':
                return new Tone.Gate({
                    threshold: parameters.threshold ?? -45,
                    smoothing: parameters.smoothing ?? 0.05,
                });
        }
    }

    private updateEffectParameters(node: EffectNode, { type, parameters }: EffectConfig) {
        switch (type) {
            case 'reverb':
                if (node instanceof Tone.Reverb) {
                    if (parameters.decay !== undefined && node.decay !== parameters.decay) {
                        node.decay = Math.max(0.001, parameters.decay);
                    }
                    if (parameters.preDelay !== undefined && node.preDelay !== parameters.preDelay) {
                        node.preDelay = Math.max(0, parameters.preDelay);
                    }
                    if (parameters.wetness !== undefined) node.wet.rampTo(parameters.wetness, PARAMETER_RAMP_TIME);
                }
                break;
            case 'eq':
                if (node instanceof Tone.EQ3) {
                    if (parameters.lowGain !== undefined) node.low.rampTo(parameters.lowGain, PARAMETER_RAMP_TIME);
                    if (parameters.midGain !== undefined) node.mid.rampTo(parameters.midGain, PARAMETER_RAMP_TIME);
                    if (parameters.highGain !== undefined) node.high.rampTo(parameters.highGain, PARAMETER_RAMP_TIME);
                    if (parameters.lowFreq !== undefined) node.lowFrequency.rampTo(parameters.lowFreq, PARAMETER_RAMP_TIME);
                    if (parameters.highFreq !== undefined) node.highFrequency.rampTo(parameters.highFreq, PARAMETER_RAMP_TIME);
                }
                break;
            case 'compressor':
                if (node instanceof Tone.Compressor) {
                    if (parameters.threshold !== undefined) node.threshold.rampTo(parameters.threshold, PARAMETER_RAMP_TIME);
                    if (parameters.ratio !== undefined) node.ratio.rampTo(parameters.ratio, PARAMETER_RAMP_TIME);
                    if (parameters.attack !== undefined) node.attack.rampTo(parameters.attack, PARAMETER_RAMP_TIME);
                    if (parameters.release !== undefined) node.release.rampTo(parameters.release, PARAMETER_RAMP_TIME);
                    if (parameters.knee !== undefined) node.knee.rampTo(parameters.knee, PARAMETER_RAMP_TIME);
                }
                break;
            case 'delay':
                if (node instanceof Tone.FeedbackDelay) {
                    if (parameters.time !== undefined) node.delayTime.rampTo(parameters.time, PARAMETER_RAMP_TIME);
                    if (parameters.feedback !== undefined) node.feedback.rampTo(parameters.feedback, PARAMETER_RAMP_TIME);
                    if (parameters.wetness !== undefined) node.wet.rampTo(parameters.wetness, PARAMETER_RAMP_TIME);
                }
                break;
            case 'chorus':
                if (node instanceof Tone.Chorus) {
                    if (parameters.frequency !== undefined) node.frequency.rampTo(parameters.frequency, PARAMETER_RAMP_TIME);
                    if (parameters.delayTime !== undefined) node.delayTime = parameters.delayTime;
                    if (parameters.depth !== undefined) node.depth = parameters.depth;
                    if (parameters.spread !== undefined) node.spread = parameters.spread;
                    if (parameters.wetness !== undefined) node.wet.rampTo(parameters.wetness, PARAMETER_RAMP_TIME);
                }
                break;
            case 'phaser':
                if (node instanceof Tone.Phaser) {
                    if (parameters.frequency !== undefined) node.frequency.rampTo(parameters.frequency, PARAMETER_RAMP_TIME);
                    if (parameters.octaves !== undefined) node.octaves = parameters.octaves;
                    if (parameters.Q !== undefined) node.Q.rampTo(parameters.Q, PARAMETER_RAMP_TIME);
                    if (parameters.baseFrequency !== undefined) node.baseFrequency = parameters.baseFrequency;
                    if (parameters.wetness !== undefined) node.wet.rampTo(parameters.wetness, PARAMETER_RAMP_TIME);
                }
                break;
            case 'distortion':
                if (node instanceof Tone.Distortion) {
                    if (parameters.drive !== undefined) node.distortion = parameters.drive;
                    if (parameters.oversample !== undefined) node.oversample = oversampleType(parameters.oversample);
                    if (parameters.wetness !== undefined) node.wet.rampTo(parameters.wetness, PARAMETER_RAMP_TIME);
                }
                break;
            case 'filter':
                if (node instanceof Tone.Filter) {
                    if (parameters.frequency !== undefined) node.frequency.rampTo(parameters.frequency, PARAMETER_RAMP_TIME);
                    if (parameters.Q !== undefined) node.Q.rampTo(parameters.Q, PARAMETER_RAMP_TIME);
                }
                break;
            case 'limiter':
                if (node instanceof Tone.Limiter && parameters.threshold !== undefined) {
                    node.threshold.rampTo(parameters.threshold, PARAMETER_RAMP_TIME);
                }
                break;
            case 'gate':
                if (node instanceof Tone.Gate) {
                    if (parameters.threshold !== undefined) node.threshold = parameters.threshold;
                    if (parameters.smoothing !== undefined) node.smoothing = parameters.smoothing;
                }
                break;
        }
    }

    private removeEffect(effectId: string) {
        const entry = this.effects.get(effectId);
        if (!entry) return;
        entry.node.disconnect();
        entry.node.dispose();
        this.effects.delete(effectId);
    }

    updateEffectsChain(effectConfigs: EffectConfig[]) {
        const enabledEffects = effectConfigs
            .filter(config => config.enabled && !config.bypass)
            .sort((a, b) => a.order - b.order);
        const enabledIds = new Set(enabledEffects.map(config => config.id));

        for (const effectId of this.effects.keys()) {
            if (!enabledIds.has(effectId)) this.removeEffect(effectId);
        }

        for (const config of enabledEffects) {
            const existing = this.effects.get(config.id);
            const stagesChanged = config.type === 'phaser'
                && existing?.config.parameters.stages !== config.parameters.stages;

            if (existing && (existing.config.type !== config.type || stagesChanged)) {
                this.removeEffect(config.id);
            }

            try {
                if (!this.effects.has(config.id)) {
                    this.effects.set(config.id, {
                        node: this.createEffect(config),
                        config,
                    });
                } else {
                    const entry = this.effects.get(config.id)!;
                    this.updateEffectParameters(entry.node, config);
                    entry.config = config;
                }
            } catch (error) {
                console.error(`无法创建或更新效果器 ${config.type}:`, error);
                this.removeEffect(config.id);
            }
        }

        const orderedEntries = enabledEffects
            .map(config => this.effects.get(config.id))
            .filter((entry): entry is EffectEntry => Boolean(entry));
        const nextChainKey = orderedEntries.map(entry => entry.config.id).join('|');
        if (nextChainKey === this.chainKey) return;

        this.input.disconnect();
        for (const entry of this.effects.values()) entry.node.disconnect();

        let currentNode: Tone.ToneAudioNode = this.input;
        for (const entry of orderedEntries) {
            currentNode.connect(entry.node);
            currentNode = entry.node;
        }
        currentNode.connect(this.output);
        this.chainKey = nextChainKey;
    }

    async ready(): Promise<void> {
        await Promise.all(
            [...this.effects.values()]
                .map(entry => entry.node)
                .filter((node): node is Tone.Reverb => node instanceof Tone.Reverb)
                .map(reverb => reverb.ready)
        );
    }

    connect(destination: Tone.ToneAudioNode) {
        this.output.connect(destination);
    }

    dispose() {
        this.input.disconnect();
        this.output.disconnect();
        for (const effectId of [...this.effects.keys()]) this.removeEffect(effectId);
        this.input.dispose();
        this.output.dispose();
        this.chainKey = '';
    }

    getInput() {
        return this.input;
    }
}
