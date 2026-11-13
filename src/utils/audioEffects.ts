import * as Tone from 'tone';
import { EffectConfig, EqBandData, ShaperPoint } from '../types/audio';

const PARAMETER_RAMP_TIME = 0.02;

const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch', 'peaking', 'lowshelf', 'highshelf'] as const;

const oversampleType = (value = 4): OverSampleType => {
    if (value >= 4) return '4x';
    if (value >= 2) return '2x';
    return 'none';
};

/** 生成指数衰减的立体声冲激响应（用于卷积混响，支持 size/damping 塑造空间感） */
const generateImpulseResponse = (decay: number, size: number, damping: number, preDelay: number): AudioBuffer => {
    const sampleRate = Tone.context.sampleRate;
    const tailSeconds = Math.min(decay * size, 8);
    const length = Math.max(1, Math.floor(sampleRate * tailSeconds));
    const preSamples = Math.floor(sampleRate * preDelay);
    const total = length + preSamples;
    const buffer = Tone.context.createBuffer(2, total, sampleRate);

    const cutoff = Math.max(200, (1 - damping) * 12000);
    const lpCoeff = Math.exp((-2 * Math.PI * cutoff) / sampleRate);

    for (let ch = 0; ch < 2; ch++) {
        const data = buffer.getChannelData(ch);
        let lp = 0;
        for (let i = preSamples; i < total; i++) {
            const t = (i - preSamples) / sampleRate;
            const noise = Math.random() * 2 - 1;
            lp += (noise - lp) * (1 - lpCoeff);
            data[i] = lp * Math.exp((-3 * t) / decay) * 0.35;
        }
    }
    return buffer;
};

/** 从控制点生成 WaveShaper 曲线（线性分段插值，采样 length 点）。横轴 x 为输入电平(-1~+1)，纵轴 y 为输出电平(-1~+1)，控制点之间直线连接，直接决定不同输入电平映射到哪个输出电平；超出首尾点的输入取端点值（Web Audio 规范）。长度取奇数，保证信号 0 精确对应曲线中心 */
const buildShaperCurve = (points: ShaperPoint[], length = 2049): Float32Array => {
    const pts = [...points].sort((a, b) => a.x - b.x);
    const n = pts.length;
    const curve = new Float32Array(length);
    if (n === 0) {
        // 空曲线退化为直线（无失真）
        for (let i = 0; i < length; i++) curve[i] = (i / (length - 1)) * 2 - 1;
        return curve;
    }
    for (let i = 0; i < length; i++) {
        const x = (i / (length - 1)) * 2 - 1;
        // 曲线两端之外延伸端点值（Web Audio 对 curve 范围外信号取端点值）
        if (x <= pts[0].x) {
            curve[i] = pts[0].y;
            continue;
        }
        if (x >= pts[n - 1].x) {
            curve[i] = pts[n - 1].y;
            continue;
        }
        // 找到 x 所在区间，做线性插值
        let seg = 0;
        while (seg < n - 2 && x > pts[seg + 1].x) seg++;
        const x0 = pts[seg].x;
        const y0 = pts[seg].y;
        const x1 = pts[seg + 1].x;
        const y1 = pts[seg + 1].y;
        const t = (x - x0) / (x1 - x0);
        curve[i] = y0 + t * (y1 - y0);
    }
    return curve;
};

/** 效果器统一接口：input/output 之间可组合任意数量的节点 */
interface EffectModule {
    input: Tone.ToneAudioNode;
    output: Tone.ToneAudioNode;
    update: (config: EffectConfig) => void;
    dispose: () => void;
}

/** 干湿并行结构：wet 链 + dry 链汇入 output，wet 处理链由调用者接入 wet 节点 */
const wetDry = (mix: number) => {
    const input = new Tone.Gain(1);
    const wet = new Tone.Gain(mix);
    const dry = new Tone.Gain(1 - mix);
    const output = new Tone.Gain(1);
    wet.connect(output);
    input.connect(dry);
    dry.connect(output);
    return {
        input,
        output,
        wet,
        dry,
        setMix(value: number) {
            wet.gain.rampTo(value, PARAMETER_RAMP_TIME);
            dry.gain.rampTo(1 - value, PARAMETER_RAMP_TIME);
        },
    };
};

const createModule = (config: EffectConfig): EffectModule => {
    const p = config.parameters;

    switch (config.type) {
        case 'reverb': {
            // 卷积混响：IR 由 decay/size/damping/preDelay 生成，音色自然但调参需重算 IR
            let ir = { d: p.decay ?? 3, s: p.size ?? 1, dam: p.damping ?? 0.5, pd: p.preDelay ?? 0.02 };
            const convolver = new Tone.Convolver(new Tone.ToneAudioBuffer(generateImpulseResponse(ir.d, ir.s, ir.dam, ir.pd)));
            const mix = wetDry(p.mix ?? 0.35);
            mix.input.connect(convolver);
            convolver.connect(mix.wet);
            return {
                input: mix.input,
                output: mix.output,
                update(config) {
                    const params = config.parameters;
                    if (params.mix !== undefined) mix.setMix(params.mix);
                    const d = params.decay ?? ir.d;
                    const s = params.size ?? ir.s;
                    const dam = params.damping ?? ir.dam;
                    const pd = params.preDelay ?? ir.pd;
                    if (d !== ir.d || s !== ir.s || dam !== ir.dam || pd !== ir.pd) {
                        ir = { d, s, dam, pd };
                        convolver.buffer = new Tone.ToneAudioBuffer(generateImpulseResponse(d, s, dam, pd));
                    }
                },
                dispose() {
                    mix.input.disconnect();
                    mix.output.disconnect();
                    convolver.dispose();
                    mix.wet.dispose();
                    mix.dry.dispose();
                    mix.input.dispose();
                    mix.output.dispose();
                },
            };
        }

        case 'eq': {
            const filters: Tone.Filter[] = (config.eqBands ?? []).map((band) => {
                const filter = new Tone.Filter(band.freq, band.type, -12);
                filter.Q.value = band.q;
                filter.gain.value = band.gain;
                return filter;
            });
            const input = new Tone.Gain(1);
            const output = new Tone.Gain(1);
            input.chain(...filters, output);

            const applyBand = (filter: Tone.Filter, band: EqBandData) => {
                if (filter.type !== band.type) filter.type = band.type;
                filter.frequency.rampTo(band.freq, PARAMETER_RAMP_TIME);
                filter.Q.rampTo(band.q, PARAMETER_RAMP_TIME);
                // gain 为 dB 可负，指数 ramp 无法到达负值，改用线性 ramp
                filter.gain.linearRampTo(band.gain, PARAMETER_RAMP_TIME);
            };

            return {
                input,
                output,
                update(config) {
                    // 频点数量变化由 shouldRebuild 触发重建，这里实时处理类型切换与 freq/gain/q
                    (config.eqBands ?? []).forEach((band, i) => {
                        if (filters[i]) applyBand(filters[i], band);
                    });
                },
                dispose() {
                    input.disconnect();
                    filters.forEach((f) => f.dispose());
                    input.dispose();
                    output.dispose();
                },
            };
        }

        case 'compressor': {
            const compressor = new Tone.Compressor({
                threshold: p.threshold ?? -18,
                ratio: p.ratio ?? 3,
                attack: p.attack ?? 0.003,
                release: p.release ?? 0.25,
                knee: p.knee ?? 12,
            });
            const makeup = new Tone.Gain(Tone.dbToGain(p.makeup ?? 0));
            const input = new Tone.Gain(1);
            const output = new Tone.Gain(1);
            input.chain(compressor, makeup, output);
            return {
                input,
                output,
                update(config) {
                    const params = config.parameters;
                    if (params.threshold !== undefined) compressor.threshold.rampTo(params.threshold, PARAMETER_RAMP_TIME);
                    if (params.ratio !== undefined) compressor.ratio.rampTo(params.ratio, PARAMETER_RAMP_TIME);
                    if (params.attack !== undefined) compressor.attack.rampTo(params.attack, PARAMETER_RAMP_TIME);
                    if (params.release !== undefined) compressor.release.rampTo(params.release, PARAMETER_RAMP_TIME);
                    if (params.knee !== undefined) compressor.knee.rampTo(params.knee, PARAMETER_RAMP_TIME);
                    if (params.makeup !== undefined) makeup.gain.rampTo(Tone.dbToGain(params.makeup), PARAMETER_RAMP_TIME);
                },
                dispose() {
                    input.disconnect();
                    compressor.dispose();
                    makeup.dispose();
                    input.dispose();
                    output.dispose();
                },
            };
        }

        case 'delay': {
            const delay = new Tone.FeedbackDelay({ delayTime: p.time ?? 0.25, feedback: p.feedback ?? 0.25, wet: 1 });
            const tone = new Tone.Filter(p.tone ?? 4000, 'lowpass');
            const mix = wetDry(p.mix ?? 0.25);
            mix.input.connect(delay);
            delay.connect(tone);
            tone.connect(mix.wet);
            return {
                input: mix.input,
                output: mix.output,
                update(config) {
                    const params = config.parameters;
                    if (params.time !== undefined) delay.delayTime.rampTo(params.time, PARAMETER_RAMP_TIME);
                    if (params.feedback !== undefined) delay.feedback.rampTo(params.feedback, PARAMETER_RAMP_TIME);
                    if (params.tone !== undefined) tone.frequency.rampTo(params.tone, PARAMETER_RAMP_TIME);
                    if (params.mix !== undefined) mix.setMix(params.mix);
                },
                dispose() {
                    mix.input.disconnect();
                    mix.output.disconnect();
                    delay.dispose();
                    tone.dispose();
                    mix.wet.dispose();
                    mix.dry.dispose();
                    mix.input.dispose();
                    mix.output.dispose();
                },
            };
        }

        case 'chorus': {
            const chorus = new Tone.Chorus({
                frequency: p.rate ?? 1.5,
                delayTime: p.delay ?? 3.5,
                depth: p.depth ?? 0.5,
                feedback: p.feedback ?? 0,
                spread: p.spread ?? 180,
                type: 'sine',
                wet: p.mix ?? 0.35,
            }).start();
            return {
                input: chorus,
                output: chorus,
                update(config) {
                    const params = config.parameters;
                    if (params.rate !== undefined) chorus.frequency.rampTo(params.rate, PARAMETER_RAMP_TIME);
                    if (params.delay !== undefined) chorus.delayTime = params.delay;
                    if (params.depth !== undefined) chorus.depth = params.depth;
                    if (params.feedback !== undefined) chorus.feedback.rampTo(params.feedback, PARAMETER_RAMP_TIME);
                    if (params.spread !== undefined) chorus.spread = params.spread;
                    if (params.mix !== undefined) chorus.wet.rampTo(params.mix, PARAMETER_RAMP_TIME);
                },
                dispose() {
                    chorus.dispose();
                },
            };
        }

        case 'phaser': {
            const phaser = new Tone.Phaser({
                frequency: p.rate ?? 0.8,
                octaves: p.octaves ?? 3,
                stages: Math.round(p.stages ?? 6),
                Q: p.Q ?? 8,
                baseFrequency: p.baseFrequency ?? 350,
                wet: p.mix ?? 0.5,
            });
            return {
                input: phaser,
                output: phaser,
                update(config) {
                    const params = config.parameters;
                    if (params.rate !== undefined) phaser.frequency.rampTo(params.rate, PARAMETER_RAMP_TIME);
                    if (params.octaves !== undefined) phaser.octaves = params.octaves;
                    if (params.Q !== undefined) phaser.Q.rampTo(params.Q, PARAMETER_RAMP_TIME);
                    if (params.baseFrequency !== undefined) phaser.baseFrequency = params.baseFrequency;
                    if (params.mix !== undefined) phaser.wet.rampTo(params.mix, PARAMETER_RAMP_TIME);
                },
                dispose() {
                    phaser.dispose();
                },
            };
        }

        case 'distortion': {
            // 纯正失真：drive（输入增益）→ WaveShaper（输入电平→输出电平的非线性映射曲线）→ output → 低通，全程串联无干湿
            const drive = new Tone.Gain(Tone.dbToGain(p.drive ?? 0));
            const shaper = new Tone.WaveShaper(buildShaperCurve(config.shaperPoints ?? []));
            shaper.oversample = oversampleType(p.oversample);
            const outputGain = new Tone.Gain(Tone.dbToGain(p.output ?? 0));
            const tone = new Tone.Filter(p.tone ?? 20000, 'lowpass');
            drive.connect(shaper);
            shaper.connect(outputGain);
            outputGain.connect(tone);
            return {
                input: drive,
                output: tone,
                update(config) {
                    const params = config.parameters;
                    if (params.drive !== undefined) drive.gain.rampTo(Tone.dbToGain(params.drive), PARAMETER_RAMP_TIME);
                    if (params.output !== undefined) outputGain.gain.rampTo(Tone.dbToGain(params.output), PARAMETER_RAMP_TIME);
                    if (params.tone !== undefined) tone.frequency.rampTo(params.tone, PARAMETER_RAMP_TIME);
                    if (params.oversample !== undefined) shaper.oversample = oversampleType(params.oversample);
                    if (config.shaperPoints !== undefined) shaper.curve = buildShaperCurve(config.shaperPoints);
                },
                dispose() {
                    drive.disconnect();
                    tone.disconnect();
                    drive.dispose();
                    shaper.dispose();
                    outputGain.dispose();
                    tone.dispose();
                },
            };
        }

        case 'filter': {
            const filter = new Tone.Filter(p.frequency ?? 1000, FILTER_TYPES[p.type ?? 0] ?? 'lowpass', -12);
            filter.Q.value = p.Q ?? 0.707;
            filter.gain.value = p.gain ?? 0;
            return {
                input: filter,
                output: filter,
                update(config) {
                    const params = config.parameters;
                    if (params.type !== undefined) filter.type = FILTER_TYPES[params.type] ?? 'lowpass';
                    if (params.frequency !== undefined) filter.frequency.rampTo(params.frequency, PARAMETER_RAMP_TIME);
                    if (params.Q !== undefined) filter.Q.rampTo(params.Q, PARAMETER_RAMP_TIME);
                    if (params.gain !== undefined) filter.gain.linearRampTo(params.gain, PARAMETER_RAMP_TIME);
                },
                dispose() {
                    filter.dispose();
                },
            };
        }

        case 'limiter': {
            // FL Limiter 风格：输入增益 → 高比率压缩(20:1 砖墙) → 输出上限(ceiling)
            const inputGain = new Tone.Gain(Tone.dbToGain(p.gain ?? 0));
            const compressor = new Tone.Compressor({
                threshold: p.threshold ?? -3,
                ratio: 20,
                attack: p.attack ?? 0.003,
                release: p.release ?? 0.1,
                knee: 0,
            });
            const ceiling = new Tone.Gain(Tone.dbToGain(p.ceiling ?? -0.1));
            inputGain.connect(compressor);
            compressor.connect(ceiling);
            return {
                input: inputGain,
                output: ceiling,
                update(config) {
                    const params = config.parameters;
                    if (params.gain !== undefined) inputGain.gain.rampTo(Tone.dbToGain(params.gain), PARAMETER_RAMP_TIME);
                    if (params.threshold !== undefined) compressor.threshold.rampTo(params.threshold, PARAMETER_RAMP_TIME);
                    if (params.attack !== undefined) compressor.attack.rampTo(params.attack, PARAMETER_RAMP_TIME);
                    if (params.release !== undefined) compressor.release.rampTo(params.release, PARAMETER_RAMP_TIME);
                    if (params.ceiling !== undefined) ceiling.gain.rampTo(Tone.dbToGain(params.ceiling), PARAMETER_RAMP_TIME);
                },
                dispose() {
                    inputGain.disconnect();
                    compressor.dispose();
                    ceiling.dispose();
                    inputGain.dispose();
                },
            };
        }

        case 'gate': {
            const gate = new Tone.Gate({ threshold: p.threshold ?? -45, smoothing: p.smoothing ?? 0.05 });
            return {
                input: gate,
                output: gate,
                update(config) {
                    const params = config.parameters;
                    if (params.threshold !== undefined) gate.threshold = params.threshold;
                    if (params.smoothing !== undefined) gate.smoothing = params.smoothing;
                },
                dispose() {
                    gate.dispose();
                },
            };
        }
    }
};

export const getEffectsTailDuration = (effectConfigs: EffectConfig[]): number => {
    const tails = effectConfigs
        .filter((config) => config.enabled)
        .map((config) => {
            if (config.type === 'reverb') {
                return (config.parameters.decay ?? 3) + (config.parameters.preDelay ?? 0);
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

interface EffectEntry {
    module: EffectModule;
    config: EffectConfig;
}

export class AudioEffectsProcessor {
    private effects = new Map<string, EffectEntry>();
    private input = new Tone.Gain(1);
    private output = new Tone.Gain(1);
    private chainKey = '';

    constructor() {
        this.input.connect(this.output);
    }

    private removeEffect(effectId: string) {
        const entry = this.effects.get(effectId);
        if (!entry) return;
        entry.module.dispose();
        this.effects.delete(effectId);
    }

    private shouldRebuild(existing: EffectConfig, next: EffectConfig): boolean {
        if (existing.type !== next.type) return true;
        // 相位器级数变化会重建内部全通链，需重建模块
        if (next.type === 'phaser') return existing.parameters.stages !== next.parameters.stages;
        // EQ 仅频点数量变化（增删频点）需重建；类型切换在 update 里实时改 type
        if (next.type === 'eq') {
            return (existing.eqBands ?? []).length !== (next.eqBands ?? []).length;
        }
        return false;
    }

    updateEffectsChain(effectConfigs: EffectConfig[]) {
        const enabledEffects = effectConfigs
            .filter((config) => config.enabled)
            .sort((a, b) => a.order - b.order);
        const enabledIds = new Set(enabledEffects.map((config) => config.id));

        // 标记本次是否有模块被移除/重建，需要强制重连链
        let chainDirty = false;

        for (const effectId of this.effects.keys()) {
            if (!enabledIds.has(effectId)) {
                this.removeEffect(effectId);
                chainDirty = true;
            }
        }

        for (const config of enabledEffects) {
            const existing = this.effects.get(config.id);
            if (existing && this.shouldRebuild(existing.config, config)) {
                this.removeEffect(config.id);
                chainDirty = true;
            }

            try {
                if (!this.effects.has(config.id)) {
                    this.effects.set(config.id, { module: createModule(config), config });
                } else {
                    const entry = this.effects.get(config.id)!;
                    entry.module.update(config);
                    entry.config = config;
                }
            } catch {
                this.removeEffect(config.id);
                chainDirty = true;
            }
        }

        const orderedEntries = enabledEffects
            .map((config) => this.effects.get(config.id))
            .filter((entry): entry is EffectEntry => Boolean(entry));
        const nextChainKey = orderedEntries.map((entry) => entry.config.id).join('|');
        if (nextChainKey === this.chainKey && !chainDirty) return;

        this.input.disconnect();
        for (const entry of this.effects.values()) entry.module.output.disconnect();

        let currentNode: Tone.ToneAudioNode = this.input;
        for (const entry of orderedEntries) {
            currentNode.connect(entry.module.input);
            currentNode = entry.module.output;
        }
        currentNode.connect(this.output);
        this.chainKey = nextChainKey;
    }

    async ready(): Promise<void> {
        // 卷积混响用同步 AudioBuffer 设置，无需异步等待
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
