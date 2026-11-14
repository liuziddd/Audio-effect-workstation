import { Note, Scale } from 'tonal';
import { MOODS } from './patterns';
import type { Mode, MoodId, StyleConfig, VoicingKind } from './patterns';

export interface KeyContext {
    tonicMidi: number;
    offsets: number[];
    names: string[];
    mode: Mode;
}

const SCALE_OFFSETS: Record<Mode, number[]> = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
};

const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const keyContext = (tonic: string, mode: Mode): KeyContext => ({
    tonicMidi: Note.midi(`${tonic}4`) ?? 60,
    offsets: SCALE_OFFSETS[mode],
    names: Scale.get(`${tonic} ${mode}`).notes,
    mode,
});

/** 音阶第 index 级相对主音的半音数（自动跨八度） */
export const degreeOffset = (ctx: KeyContext, index: number) => ctx.offsets[((index % 7) + 7) % 7] + 12 * Math.floor(index / 7);

/** 固定的伪随机，保证同一个种子出同一批结果 */
export const rngFrom = (seed: number) => {
    // 先把种子打散：相邻种子直接喂给 mulberry32 会输出高度相关，重掷时容易撞回同一个套路
    let mixed = (seed ^ 0x9e3779b9) >>> 0;
    mixed = Math.imul(mixed ^ (mixed >>> 16), 0x21f0aaad) >>> 0;
    mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97) >>> 0;
    let a = (mixed ^ (mixed >>> 13)) >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

type NinthKind = 'none' | 'natural' | 'flat' | 'sharp';

export interface ChordSpec {
    degree: number;
    accidental: number;
    minor: boolean;
    dim: boolean;
    aug: boolean;
    sus: 0 | 2 | 4;
    seventh: 0 | 1 | 2;
    ninth: NinthKind;
    eleventh: boolean;
    thirteenth: boolean;
    sixth: boolean;
    add9: boolean;
}

const UPPER = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

interface BuiltChord {
    roman: string;
    name: string;
    rootPc: number;
    /** 相对根音的半音（升序，首项为 0） */
    intervals: number[];
    third: number;
    fifth: number;
    seventh: number | null;
    ninth: number | null;
    eleventh: number | null;
    thirteenth: number | null;
}

const pc = (value: number) => ((value % 12) + 12) % 12;

/** 罗马数字后缀：挂留写在七音之后（V7sus4 而不是 Vsus47） */
const romanLabel = (spec: ChordSpec) => {
    const base = UPPER[spec.degree - 1];
    const acc = spec.accidental < 0 ? 'b' : spec.accidental > 0 ? '#' : '';
    let text = spec.minor ? base.toLowerCase() : base;
    if (spec.dim) text += spec.seventh ? 'ø7' : '°';
    else if (spec.thirteenth) text += '13';
    else if (spec.eleventh) text += '11';
    else if (spec.ninth === 'flat') text += '7b9';
    else if (spec.ninth === 'sharp') text += '7#9';
    else if (spec.ninth === 'natural') text += spec.seventh === 2 ? 'maj9' : spec.seventh ? '9' : 'add9';
    else if (spec.seventh === 2) text += 'maj7';
    else if (spec.seventh === 1) text += '7';
    else if (spec.sixth) text += '6';
    if (spec.sus) text += `sus${spec.sus}`;
    return acc + text;
};

const chordName = (rootName: string, spec: ChordSpec, seventhInterval: number | null) => {
    if (spec.dim) return rootName + (seventhInterval === 10 ? 'm7b5' : seventhInterval === 9 ? 'dim7' : 'dim');
    let name = rootName + (spec.minor ? 'm' : '');
    if (spec.thirteenth) name += '13';
    else if (spec.eleventh) name += '11';
    else if (spec.ninth === 'flat') name += '7b9';
    else if (spec.ninth === 'sharp') name += '7#9';
    else if (spec.ninth === 'natural') name += spec.seventh === 2 ? 'maj9' : spec.seventh ? '9' : 'add9';
    else if (seventhInterval === 11) name += 'maj7';
    else if (seventhInterval === 10) name += '7';
    else if (spec.sixth) name += '6';
    if (spec.sus) name += `sus${spec.sus}`;
    return name;
};

export type ColorLevel = 'plain' | 'seventh' | 'ninth';

interface BuildOptions {
    style: StyleConfig;
    mood: MoodId;
    rng: () => number;
    /** 整张卡的色彩等级：同一段进行保持一致，才不会一段里有的和弦带九音有的不带 */
    color: ColorLevel;
    /** 这一拍能不能挂 sus：句末挂上去就悬在那儿不落地，只有句中的属和弦才挂 */
    allowSus: boolean;
}

export const buildChord = (ctx: KeyContext, spec: ChordSpec, options: BuildOptions): BuiltChord => {
    const { style, mood, rng, color, allowSus } = options;
    const rootOffset = degreeOffset(ctx, spec.degree - 1) + spec.accidental;
    const rootMidi = ctx.tonicMidi + rootOffset;
    const rootPc = pc(rootMidi);
    const rootName = spec.accidental === 0
        ? ctx.names[(spec.degree - 1) % 7] ?? FLAT_NAMES[rootPc]
        : (spec.accidental < 0 ? FLAT_NAMES : SHARP_NAMES)[rootPc];

    // 模板没写扩展时，按风格与情绪补七 / 九 / sus
    const moodColor = MOODS[mood];
    const bare = !spec.seventh && spec.ninth === 'none' && !spec.eleventh && !spec.thirteenth && !spec.sus && !spec.sixth;
    let seventh = spec.seventh;
    let ninth: NinthKind = spec.ninth;
    let sus = spec.sus;
    let autoSeventh = false;
    if (bare) {
        if (color !== 'plain') {
            seventh = 1;
            autoSeventh = true;
        }
        if (color === 'ninth') ninth = 'natural';
        // 挂留只挂在句中的属和弦上（Vsus4 / V7sus4）；挂在别的级数上只是把三音糊掉，挂在句末又落不了地
        if (allowSus && spec.degree === 5 && !spec.minor && !spec.dim && ninth === 'none' && rng() < Math.min(0.9, style.sus + moodColor.sus)) sus = 4;
    }
    const third = sus === 2 ? 2 : sus === 4 ? 5 : spec.minor || spec.dim ? 3 : 4;
    const fifth = spec.dim ? 6 : spec.aug ? 8 : 7;
    let seventhInterval: number | null = null;
    if (seventh === 2) seventhInterval = 11;
    else if (seventh === 1) {
        if (autoSeventh) {
            // 自动补的七音走调内三度叠置：I 得 maj7、V 得属七；
            // 但借用 / 副属改变了和弦性质时（如大调借来的 iv），调内七音就不再是它自己的七音
            seventhInterval = spec.minor || spec.dim
                ? 10
                : (((degreeOffset(ctx, spec.degree - 1 + 6) - rootOffset) % 12) + 12) % 12;
        } else {
            seventhInterval = spec.dim && !spec.minor ? 9 : 10;
        }
    }
    // 紧张情绪下把真正的属七（调内 V7）做成变化属（b9 / #9）；
    // 别的属七（bVII7、副属的二级属）挂上变化音只会变怪，B 段后门和弦尤其别动
    if (seventhInterval === 10 && !spec.minor && !spec.dim
        && spec.degree === 5 && spec.accidental === 0 && rng() < moodColor.alt) {
        ninth = rng() < 0.5 ? 'flat' : 'sharp';
    }

    const ninthInterval = ninth === 'flat' ? 13 : ninth === 'sharp' ? 15 : ninth === 'natural' ? 14 : null;
    const eleventhInterval = spec.eleventh ? (spec.minor ? 17 : 18) : null;
    const thirteenthInterval = spec.thirteenth ? 21 : null;
    const sixthInterval = spec.sixth ? 9 : null;

    const intervals = [0, sus ? (sus === 2 ? 2 : 5) : third, fifth];
    if (seventhInterval !== null) intervals.push(seventhInterval);
    if (ninthInterval !== null) intervals.push(ninthInterval);
    if (eleventhInterval !== null) intervals.push(eleventhInterval);
    if (thirteenthInterval !== null) intervals.push(thirteenthInterval);
    if (sixthInterval !== null) intervals.push(sixthInterval);

    // 名称按实际响出来的音来写：自动补的七 / 九音也要体现在和弦名上，别声音是 9 和弦名字还是 maj7
    const label: ChordSpec = {
        ...spec,
        seventh: seventhInterval === null ? 0 : seventhInterval === 11 ? 2 : 1,
        ninth: ninthInterval === null ? 'none' : ninth,
        sus: sus as 0 | 2 | 4,
    };

    return {
        roman: romanLabel(label),
        name: chordName(rootName, label, seventhInterval),
        rootPc,
        intervals: [...new Set(intervals)].sort((a, b) => a - b),
        third,
        fifth,
        seventh: seventhInterval,
        ninth: ninthInterval,
        eleventh: eleventhInterval,
        thirteenth: thirteenthInterval,
    };
};

/* ===== 声部排列 ===== */

/**
 * 上层结构：从和弦音里挑音，绝不凭空加音。
 * 超过四个声部时先扔五音（它不决定和弦性格），再扔根音（低音已经有了），
 * 最后才动九音 / 十一音——键盘手在九和弦上留的正是 3、7、9。
 */
const pickUpper = (chord: BuiltChord, kind: VoicingKind): number[] => {
    if (kind === 'power') return [0, 7, 12];
    let notes = [...chord.intervals].sort((a, b) => a - b);
    for (const interval of [7, 0, 17, 14]) {
        if (notes.length <= 4) break;
        if (notes.includes(interval)) notes = notes.filter((value) => value !== interval);
    }
    // 无根音排列：低音已经给了根音，上层再留一个根音只会挤在底下；三和弦留不出三个音就保持原位
    if (kind === 'upper') {
        const rootless = notes.filter((value) => value !== 0);
        if (rootless.length >= 3) notes = rootless;
    }
    return [...new Set(notes)].sort((a, b) => a - b);
};

/** 平行五度 / 平行八度：两个声部同时保持纯音程，是声部进行里最该避免的东西 */
const parallelCost = (notes: number[], previous: number[] | null) => {
    if (!previous || notes.length < 2) return 0;
    let cost = 0;
    const size = Math.min(notes.length, previous.length);
    for (let lower = 0; lower + 1 < size; lower++) {
        for (let upper = lower + 1; upper < size; upper++) {
            const before = Math.abs(previous[upper] - previous[lower]) % 12;
            if (before !== Math.abs(notes[upper] - notes[lower]) % 12) continue;
            if (before === 7) cost += 5;
            else if (before === 0) cost += 7;
        }
    }
    return cost;
};

const motionCost = (notes: number[], previous: number[]) => {
    const size = Math.min(notes.length, previous.length);
    let cost = 0;
    for (let index = 0; index < size; index++) cost += Math.abs(notes[index] - previous[index]);
    cost += Math.abs(notes.length - previous.length) * 4;
    return cost / Math.max(1, size);
};

/** 把一组音级排成升序和弦，枚举转位与八度，取与上一个排列最接近的 */
const stackVoicing = (pcs: number[], previous: number[] | null, [low, high]: [number, number]) => {
    const classes = [...new Set(pcs.map(pc))].sort((a, b) => a - b);
    let best: number[] | null = null;
    let bestCost = Infinity;

    for (let base = low - 12; base <= low; base += 12) {
        for (let rotation = 0; rotation < classes.length; rotation++) {
            const order = [...classes.slice(rotation), ...classes.slice(0, rotation)];
            const notes: number[] = [];
            let last = base - 1;
            for (const value of order) {
                let note = value;
                while (note < base) note += 12;
                while (note <= last) note += 12;
                notes.push(note);
                last = note;
            }
            if (notes[0] < low || notes[notes.length - 1] > high) continue;
            // 半音相撞（大七度贴根音这类）直接不用
            let clash = false;
            for (let index = 1; index < notes.length; index++) {
                if (notes[index] - notes[index - 1] < 2) clash = true;
            }
            if (clash) continue;
            let cost = previous
                ? motionCost(notes, previous) + parallelCost(notes, previous)
                // 第一个和弦落在音域偏下的位置，给后面的声部进行留出上行余量，低音和和声之间也不会空一大截
                : Math.abs((notes[0] + notes[notes.length - 1]) / 2 - (low + (high - low) * 0.3));
            // 低音与和声之间别拉开太远：左手低音、右手和声分得开是好事，空出两个八度就散了
            cost += Math.max(0, notes[0] - low - 5) * 0.8;
            // 低音区的大二度会糊，往上推一点让它散开
            for (let index = 1; index < notes.length; index++) {
                if (notes[index] - notes[index - 1] === 2 && notes[index] < 62) cost += 5;
            }
            if (cost < bestCost) {
                bestCost = cost;
                best = notes;
            }
        }
    }

    return best ?? classes.map((value) => low + (((value - low) % 12) + 12) % 12).sort((a, b) => a - b);
};

/** 降二声部：把次高音降八度，得到爵士键盘的 drop-2 排列 */
const dropSecond = (notes: number[]) => {
    if (notes.length < 3) return notes;
    const sorted = [...notes].sort((a, b) => a - b);
    const index = sorted.length - 2;
    if (sorted[index] - 12 > sorted[0]) {
        sorted[index] -= 12;
        sorted.sort((a, b) => a - b);
    }
    return sorted;
};

interface Voiced {
    notes: number[];
    upper: number[];
}

/** 半音相撞（13 音的 E 贴着 b7 的 F 这种）把上面那个音抬八度，跟键盘手的处理一样 */
const declash = (notes: number[], cap: number) => {
    const out = [...notes].sort((a, b) => a - b);
    for (let pass = 0; pass < 3; pass++) {
        let moved = false;
        for (let index = 1; index < out.length; index++) {
            if (out[index] - out[index - 1] < 2 && out[index] + 12 <= cap) {
                out[index] += 12;
                moved = true;
            }
        }
        out.sort((a, b) => a - b);
        if (!moved) break;
    }
    return out;
};

interface ArrangeOptions {
    /** 情绪决定的整体音域偏移 */
    shift: number;
    /** 上层和声跨度（半音） */
    spread: number;
    /** 低音用和弦的哪个音级：0 根音 / 3·4 三音 / 7 五音 */
    bassInterval?: number;
    /** 上一个和弦的低音，用来看低音线该往上还是往下走 */
    previousBass?: number | null;
}

export const arrange = (
    chord: BuiltChord,
    previousUpper: number[] | null,
    style: StyleConfig,
    { shift, spread, bassInterval = 0, previousBass = null }: ArrangeOptions,
): Voiced => {
    // 低音：同一个和弦可以转位，八度取离上一个低音最近的那个，低音线才能顺着走而不是来回大跳
    const bassPc = pc(chord.rootPc + bassInterval);
    const anchor = previousBass ?? style.bass + shift;
    let bass = bassPc + 12 * Math.round((anchor - bassPc) / 12);
    // 低音锁在一个八度半的活动范围里：再低就成了听不见的次低频，再高就顶到和声区
    if (bass < 33 || bass > 52) {
        const options = [bass - 12, bass + 12].filter((value) => value >= 33 && value <= 52);
        if (options.length) bass = options.reduce((a, b) => (Math.abs(b - anchor) < Math.abs(a - anchor) ? b : a));
    }

    if (style.voicing === 'power') {
        // 强力和弦：根音 + 五度 + 八度，宽一点时把五度再叠一个十二度
        const shape = spread >= 19 ? [bass, bass + 7, bass + 12, bass + 19] : [bass, bass + 7, bass + 12];
        return { notes: shape, upper: shape };
    }

    // 音程是相对根音的，排声部前先还原成实际音级
    const pcs = pickUpper(chord, style.voicing).map((interval) => chord.rootPc + interval);
    const low = bass + 12;
    const high = low + spread;

    let upper = stackVoicing(pcs, previousUpper, [low, high]);
    if (style.voicing === 'drop2') upper = dropSecond(upper);
    upper = declash(upper, high + 12);

    return { notes: [bass, ...upper], upper };
};
