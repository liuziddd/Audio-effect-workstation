import type { MidiNote } from '../midi';
import { degreeOffset, keyContext, rngFrom } from './harmony';
import { MOODS, STYLES } from './patterns';
import type { TextureId } from './patterns';
import type { ChordCard, ChordStep, MelodyCard, Settings } from './types';

const BEATS_PER_BAR = 4;

const pick = <T,>(list: T[], rng: () => number): T => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

const chordAt = (card: ChordCard, beat: number): ChordStep =>
    card.chords.find((chord) => beat >= chord.start - 1e-6 && beat < chord.start + chord.duration - 1e-6) ?? card.chords[card.chords.length - 1];

/** 音区内的和弦音（跨八度铺满）：织体取音都从这里挑，跟块状和声是同一组和弦音 */
const chordTones = (chord: ChordStep, low: number, high: number) => {
    const classes = [...new Set(chord.notes.map((note) => ((note % 12) + 12) % 12))].sort((a, b) => a - b);
    const out: number[] = [];
    for (const value of classes) {
        for (let note = low + (((value - low) % 12) + 12) % 12; note <= high; note += 12) out.push(note);
    }
    return [...new Set(out)].sort((a, b) => a - b);
};

/** 低音支撑：每个和弦换位时给一个长音，织体才不会飘；转位后低音线也跟着走 */
const bassNotes = (card: ChordCard): MidiNote[] =>
    card.chords.map((chord) => ({
        midi: chord.notes[0],
        start: chord.start,
        duration: chord.duration * 0.96,
        velocity: 0.5,
    }));

/** 把一串起音点变成音符：时值取到下一个起音 */
const toNotes = (onsets: { beat: number; midi: number; velocity: number }[], max = 2, total = 16): MidiNote[] => {
    const sorted = [...onsets].sort((a, b) => a.beat - b.beat);
    return sorted.map((onset, index) => {
        const next = index + 1 < sorted.length ? sorted[index + 1].beat : total;
        return {
            midi: onset.midi,
            start: onset.beat,
            duration: Math.min(max, Math.max(0.12, (next - onset.beat) * 0.94)),
            velocity: onset.velocity,
        };
    });
};

/* ===== 旋律的句法：动机 → 重复 → 模进 → 收束 ===== */

type Contour = 'arch' | 'descent' | 'ascent' | 'neighbor';

/** 起伏轮廓（0 低 / 1 高）：一句话要有形状，不能一路往上爬也不能原地打转 */
const contourValue = (kind: Contour, t: number) => {
    switch (kind) {
        case 'arch': return 0.22 + 0.62 * Math.sin(Math.PI * Math.min(1, t * 1.02));
        case 'descent': return 0.86 - 0.52 * t;
        case 'ascent': return 0.26 + 0.52 * t;
        default: return 0.54 + 0.2 * Math.sin(Math.PI * 3 * t);
    }
};

const nearestIndex = (scale: number[], note: number) => {
    let best = 0;
    for (let index = 1; index < scale.length; index++) {
        if (Math.abs(scale[index] - note) < Math.abs(scale[best] - note)) best = index;
    }
    return best;
};

/** 按调内级数平移：模进就是把同一句话挪几级，而不是另写一句 */
const transposeInScale = (scale: number[], note: number, steps: number) => {
    const index = Math.min(scale.length - 1, Math.max(0, nearestIndex(scale, note) + steps));
    return scale[index];
};

interface WalkOptions {
    /** 本小节的击弦点（16 分音符位置） */
    onsets: number[];
    /** 小节起点，单位：拍 */
    barBeat: number;
    chord: ChordStep;
    /** 整条句子的目标轮廓 */
    contour: Contour;
    /** 句子在整段里的进度 0~1，用来取轮廓上的位置 */
    progress: (beat: number) => number;
    scale: number[];
    low: number;
    high: number;
    /** 模进的级数：正数往上挪，0 就是原样重复 */
    shift: number;
    /** 动机的第一个音：模进以它为基准整体挪级，跨小节不变 */
    skeleton: number | null;
    /** 收束小节：只留前半，最后一个音落到和弦音 */
    cadence: boolean;
    previous: number | null;
    beforePrevious: number | null;
}

/**
 * 一小节的旋律：正拍必须是和弦音（和声在响的那一下要能对上），
 * 弱拍走调内经过音；相邻两音尽量级进，同音不连三次，也不原地折返。
 * 模进通过 `shift` 把骨架整体挪级数，再在正拍上贴回新和弦的和弦音。
 */
const walkBar = (options: WalkOptions) => {
    const { onsets, barBeat, chord, contour, progress, scale, low, high, shift, cadence } = options;
    let previous = options.previous;
    let beforePrevious = options.beforePrevious;
    const skeleton = options.skeleton;

    const tones = chordTones(chord, low, high);
    const usable = cadence ? onsets.slice(0, Math.max(1, Math.ceil(onsets.length / 2))) : onsets;

    return usable.map((onset, index) => {
        const beat = barBeat + onset / 4;
        const strong = onset % 4 === 0;
        const target = low + (high - low) * contourValue(contour, progress(beat));
        const pool = strong ? tones : scale.filter((note) => note >= low && note <= high);
        const source = pool.length ? pool : tones;

        // 硬约束：弱拍不许大跳（级进才是旋律，跳进只在正拍上偶尔用一次），
        // 也不许同一个音连着三次、不许原地折返
        const within = (limit: number) => source.filter((note) => {
            if (previous === null) return true;
            if (Math.abs(note - previous) > limit) return false;
            if (note === previous && previous === beforePrevious) return false;
            return true;
        });
        // 一层层放宽，而不是一步退回「整组和弦音」——那会出现八度大跳
        const limit = strong ? 5 : 3;
        const usablePool = within(limit).length ? within(limit)
            : within(limit + 2).length ? within(limit + 2)
                : within(9).length ? within(9)
                    : source;
        const usableTones = usablePool;
        // 收尾那个音直接在和弦音里挑，不受「级进」限制——句子要落在和弦上
        const candidates = cadence && index === usable.length - 1 && tones.length ? tones : usableTones;

        let best = candidates[0];
        let bestCost = Infinity;
        for (const note of candidates) {
            // 骨架：动机的第一个音定下位置，后面的小节按级数平移
            // 轮廓只圈定大概的音区，真正决定落点的是「离上一个音多远」——
            // 旋律是走出来的，不是往目标上跳出来的
            let cost = Math.abs(note - target) * 0.45;
            if (shift && skeleton !== null && index === 0) cost += Math.abs(note - transposeInScale(scale, skeleton, shift)) * 0.6;
            if (previous !== null) {
                const step = Math.abs(note - previous);
                cost += step * 1.05;
                // 往轮廓目标的方向走：级进也要有方向，不能全靠落点决定朝上朝下
                if (note !== previous && Math.sign(note - previous) !== Math.sign(target - previous)) cost += 2.2;
                if (step > 4) cost += 5;
                if (note === previous) cost += 9;
                // 折返（A–B–A）听上去像颤音，不是旋律
                if (note === beforePrevious) cost += 12;
            }
            if (cadence && index === usable.length - 1) {
                // 收尾落在和弦音上，往下级进收住；不要停在半空也不要和上一个音重复
                cost = Math.abs(note - (previous ?? note)) * 1.4
                    + (tones.includes(note) ? 0 : 30)
                    + (note > (previous ?? note) ? 4 : 0)
                    + (note === previous ? 20 : 0)
                    + Math.abs(note - target) * 0.15;
            }
            if (cost < bestCost) {
                bestCost = cost;
                best = note;
            }
        }

        // 模进：非正拍上保持动机的音程形状，整体挪级；正拍仍要贴住当前和弦。
        // 收束的那个音不挪——它是句子的落点，挪了就会停在半空
        const moved = shift && !strong && skeleton !== null && !(cadence && index === usable.length - 1);
        const midi = moved ? transposeInScale(scale, best, shift) : best;

        beforePrevious = previous;
        previous = midi;
        return { beat, midi, velocity: strong ? 0.8 : index % 2 === 0 ? 0.64 : 0.56, strong };
    });
};

/**
 * 旋律织体：按「句子」生成，而不是逐音随机。
 * - 前两小节是动机（同一句话），第三小节起原样模进（挪两级），
 *   第四小节只留前半句并把尾音收到和弦音上——这就是一问一答的乐句；
 * - 八小节时第二句换个轮廓（拱形反过来），收在更低的音上；
 * - 每个和弦换位的正拍都贴住和弦音，所以听上去始终「在和声里」。
 */
const melodic = (settings: Settings, card: ChordCard, seed: number, kind: 'riff' | 'line'): MidiNote[] => {
    const rng = rngFrom(seed);
    const style = STYLES[settings.style];
    const cell = pick(kind === 'riff' ? style.riff : style.line, rng);
    const ctx = keyContext(settings.tonic, settings.mode);
    const shift = MOODS[settings.mood].register;
    const low = (kind === 'riff' ? 60 : 57) + shift;
    const high = (kind === 'riff' ? 84 : 81) + shift;
    // 音阶要铺满「和弦音实际所在的音区」，不能只从主音往上数：
    // 和弦音常常低于主音，音阶如果只覆盖主音以上，弱拍的经过音就没得选，只能跳上去
    const scale: number[] = [];
    for (let index = -30; index < 40; index++) {
        const note = ctx.tonicMidi + degreeOffset(ctx, index) + shift;
        if (note >= low - 7 && note <= high + 7) scale.push(note);
    }
    const total = card.bars * BEATS_PER_BAR;
    const contours: Contour[] = kind === 'riff'
        ? ['arch', 'descent', 'neighbor']
        : ['descent', 'arch', 'ascent'];
    const contour = pick(contours, rng);

    const onsets: { beat: number; midi: number; velocity: number }[] = [];
    let previous: number | null = null;
    let beforePrevious: number | null = null;
    /** 动机的起手音：整段不变，模进都拿它当基准 */
    let skeleton: number | null = null;

    for (let bar = 0; bar < card.bars; bar++) {
        const barBeat = bar * 4;
        const chord = chordAt(card, barBeat);
        const inPhrase = bar % 4;
        // 句子的第四小节收束、留白，别把整段填满
        const cadence = inPhrase === 3;
        const sound = walkBar({
            onsets: cell,
            barBeat,
            chord,
            contour: bar % 8 >= 4 ? (contour === 'arch' ? 'descent' : 'arch') : contour,
            progress: (beat) => Math.min(1, Math.max(0, (beat - (bar - inPhrase) * 4) / 16)),
            scale,
            low,
            high,
            // 一句四小节：前两小节原样，后两小节模进两级
            shift: inPhrase < 2 ? 0 : 2,
            skeleton,
            cadence,
            previous,
            beforePrevious,
        });
        if (skeleton === null && sound.length) skeleton = sound[0].midi;
        for (const note of sound) {
            onsets.push({ beat: note.beat, midi: note.midi, velocity: note.velocity });
        }
        const last = sound[sound.length - 1];
        if (last) {
            beforePrevious = sound.length > 1 ? sound[sound.length - 2].midi : beforePrevious;
            previous = last.midi;
        }
    }

    return [...bassNotes(card), ...toNotes(onsets, kind === 'riff' ? 2 : 1.6, total)];
};

/**
 * 分解和弦：低音托住，右手在和弦音上来回。
 * 每两小节反一次向，每四小节末句用一串上行接住下一个和弦——听感上像句子，而不是循环。
 */
const arp = (settings: Settings, card: ChordCard, seed: number): MidiNote[] => {
    const rng = rngFrom(seed);
    const style = STYLES[settings.style];
    const cell = pick(style.arp, rng);
    const step = style.arpStep;
    const total = card.bars * BEATS_PER_BAR;
    const onsets: { beat: number; midi: number; velocity: number }[] = [];
    // 整段的分解音都固定在一个两八度的窗口里，换和弦只换音级、不换音区，
    // 否则每个和弦各自从自己的根音起算，跨和弦就会跳三个八度
    const anchor = (card.chords[0].upper[0] ?? card.chords[0].notes[0]) + 12;
    /** 在音级上来回走，不夹在顶端重复同一个音 */
    const bounce = (offset: number, count: number) => {
        const span = Math.max(1, count - 1);
        const cycle = span * 2;
        const position = ((offset % cycle) + cycle) % cycle;
        return position <= span ? position : cycle - position;
    };

    for (let index = 0; index < Math.round(total / step); index++) {
        const beat = Number((index * step).toFixed(4));
        const chord = chordAt(card, beat);
        const tones = chordTones(chord, anchor, anchor + 19);
        if (!tones.length) continue;

        const bar = Math.floor(beat / 4);
        const inBar = Math.round((beat % 4) / step);
        const shape = Math.floor(bar / 2) % 2 === 1 ? [...cell].reverse() : cell;
        // 每小节第一拍落在最低的和弦音上，右手才有「从底下滚上去」的手感
        const offset = inBar === 0 ? 0 : shape[inBar % shape.length];
        // 四小节一组：最后一小节改成上行经过句，把下一个和弦接进来
        const runOut = bar % 4 === 3 ? inBar : -1;
        const target = bounce(runOut >= 0 ? runOut : Math.abs(offset), tones.length);

        onsets.push({
            beat,
            midi: tones[target],
            velocity: inBar === 0 ? 0.78 : inBar % 2 === 0 ? 0.64 : 0.56,
        });
    }

    return [...bassNotes(card), ...toNotes(onsets, 2, total)];
};

export const generateTexture = (settings: Settings, harmony: ChordCard, seed: number, id: string, texture: TextureId): MelodyCard => {
    const notes = texture === 'arp' ? arp(settings, harmony, seed) : melodic(settings, harmony, seed, texture);

    return {
        id,
        kind: 'melody',
        label: harmony.label,
        notes,
        bpm: settings.bpm,
        bars: harmony.bars,
        basedOn: harmony.label,
        texture,
    };
};
