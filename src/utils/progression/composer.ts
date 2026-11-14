import { degreeOffset } from './harmony';
import type { ChordSpec, KeyContext } from './harmony';
import type { Idiom, Mode, StyleConfig } from './patterns';

/**
 * 和声推演：把风格收录的进行（idioms）解析成实际和弦，再按乐句组装、加花。
 *
 * 一、进行本身来自曲目库，不是随机拼级数
 * - 每条 idiom 就是一首歌里真实用过的四小节 / 八小节 / 十二小节循环，
 *   罗马数字里写着质量与扩展音（IVmaj7、V7、iii7、iiø7、bVII7）。
 * - 大调 / 小调各有一份写法，所以「小调 i–bVI–bIII–bVII」不会被硬塞进大调的骨架。
 *
 * 二、四小节进行铺成八小节 = 再现 + 终止
 * - 前半原样（第 1–4 小节），后半重新起头（把 idiom 的头两小节再弹一次），
 *   最后两小节换成终止式：正格 / 变格 / ii–V–I / 阻碍 / 后门。
 *   这就是流行歌 A + A′ 的写法：听得出来是同一句话的回答，而不是另起一段。
 * - 王道进行这类本来就悬在 vi 上的进行，后半接 ii–V–I 正好补成一条完整五度圈
 *   （IVmaj7–V7–iii7–vi7–ii7–V7–I），乐理书里给的就是这条解决。
 *
 * 三、加花只有一处，且必须在功能上说得通
 * - 副属 V7/x 只顶到「它要解决的那个和弦」前面一格；
 * - 借用只动下属功能（大调 IV → iv7），因为那是「思念 / 变暗」的标准位置；
 * - 三全音替代只顶句末那个属七（bII7 与 V7 共用同一个三全音）。
 * 三者不叠加：一段进行最多用一处，避免变成和声大杂烩。
 */

type Fn = 'T' | 'PD' | 'D';
type Quality = { minor: boolean; dim: boolean; sus: 0 | 2 | 4; seventh: 0 | 1 | 2; ninth: 'none' | 'natural' | 'flat' | 'sharp'; sixth: boolean };

export interface PlannedChord {
    spec: ChordSpec;
    /** 起始位置，单位：拍 */
    start: number;
    duration: number;
    /** 低音用和弦的哪个音级：0 根音 / 4 三音 / 7 五音 */
    bassInterval: number;
    /** 句末：挂留音落不了地，这里不能再加 sus */
    phraseEnd: boolean;
}

export interface ProgressionPlan {
    bars: number;
    chords: PlannedChord[];
    /** 这条进行用到的写法，仅作悬停说明 */
    name: string;
}

const pc = (value: number) => ((value % 12) + 12) % 12;

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7 };

const pick = <T,>(items: T[], rng: () => number): T => items[Math.min(items.length - 1, Math.floor(rng() * items.length))];

const qualityOf = (upper: boolean, suffix: string): Quality => {
    const base: Quality = { minor: !upper, dim: false, sus: 0, seventh: 0, ninth: 'none', sixth: false };
    switch (suffix) {
        case '': return base;
        case 'maj7': return { ...base, seventh: 2 };
        case 'maj9': return { ...base, seventh: 2, ninth: 'natural' };
        case '7': return { ...base, seventh: 1 };
        case '9': return { ...base, seventh: 1, ninth: 'natural' };
        case '7b9': return { ...base, seventh: 1, ninth: 'flat' };
        case '7#9': return { ...base, seventh: 1, ninth: 'sharp' };
        // 半减：小三度 + 减五度 + 小七度，罗马数字写作 iiø7
        case 'ø7':
        case 'ø': return { minor: true, dim: true, sus: 0, seventh: 1, ninth: 'none', sixth: false };
        case '°7': return { ...base, minor: false, dim: true, seventh: 1 };
        case '°': return { ...base, minor: false, dim: true };
        case 'sus4': return { ...base, sus: 4 };
        case '6': return { ...base, sixth: true };
        case 'add9': return { ...base, ninth: 'natural' };
        default: return base;
    }
};

/** `IVmaj7` / `iii7` / `bVII7` / `iiø7` → 和弦规格；大小写决定三和弦性质 */
const parseToken = (token: string): ChordSpec => {
    const match = /^([b#]?)([IViv]+)(.*)$/.exec(token);
    if (!match) throw new Error(`无法解析的和弦记号：${token}`);
    const accidental = match[1] === 'b' ? -1 : match[1] === '#' ? 1 : 0;
    const letters = match[2];
    const degree = ROMAN[letters.toLowerCase()];
    const upper = letters === letters.toUpperCase();
    const quality = qualityOf(upper, match[3]);
    return {
        degree: degree ?? 1,
        accidental,
        minor: quality.minor,
        dim: quality.dim,
        aug: false,
        sus: quality.sus,
        seventh: quality.seventh,
        ninth: quality.ninth,
        eleventh: false,
        thirteenth: false,
        sixth: quality.sixth,
        add9: false,
    };
};

const functionOf = (spec: ChordSpec): Fn => {
    const degree = spec.degree;
    if (degree === 1 || degree === 3 || degree === 6) return 'T';
    if (degree === 2 || degree === 4) return 'PD';
    return 'D';
};

/** 结束两小节可以怎么收：正格 / 变格 / ii–V–I / 阻碍 / 后门 */
const TAILS: Record<Mode, string[][]> = {
    major: [
        ['V7', 'I'],
        ['V7', 'I'],
        ['IV', 'I'],
        ['ii7', 'V7', 'I'],
        ['V7', 'vi'],
        ['iv7', 'bVII7', 'I'],
    ],
    minor: [
        ['V7', 'i'],
        ['V7', 'i'],
        ['iv', 'i'],
        ['iiø7', 'V7', 'i'],
        ['V7', 'VI'],
        ['VII7', 'i'],
    ],
};

const cadenceName = (tokens: string[]): string => {
    const last = tokens[tokens.length - 1] ?? '';
    const prev = tokens[tokens.length - 2] ?? '';
    if (/^(i|I)$/.test(last)) return /^(IV|iv)/.test(prev) ? '变格终止' : /^(bVII7|bVII)/.test(prev) ? '后门终止' : '正格终止';
    if (/^V/.test(last)) return '半终止';
    if (/^(vi|VI)$/.test(last)) return '阻碍终止';
    return '循环';
};

/**
 * 四小节 idiom 铺成八小节：前半原样，后半再现头两小节，最后两小节换成终止式。
 * 终止式长度按条数把后半的头补够。
 */
const expandToEight = (tokens: string[], mode: Mode, rng: () => number) => {
    const degreeOf = (token: string) => parseToken(token).degree;
    const pools = TAILS[mode];
    const start = Math.floor(rng() * pools.length);
    /** 从 idiom 的第 offset 个和弦起，顺着取 count 个（绕回来补） */
    const windowOf = (offset: number, count: number) =>
        Array.from({ length: count }, (_, step) => tokens[(offset + step) % tokens.length]);

    // 再现段从 idiom 的哪一格起手都可以，只要能避开两处接缝：
    // 前半 → 再现起手、再现收尾 → 终止式起手。连着两小节同一个和弦是「卡住」而不是停顿。
    for (let attempt = 0; attempt < pools.length * tokens.length; attempt++) {
        const tail = pools[(start + attempt) % pools.length];
        const head = windowOf(Math.floor(attempt / pools.length) % tokens.length, Math.max(1, 4 - tail.length));
        const enter = degreeOf(tokens[tokens.length - 1]) !== degreeOf(head[0]);
        const leave = degreeOf(head[head.length - 1]) !== degreeOf(tail[0]);
        if (enter && leave) return [...tokens, ...head, ...tail];
    }

    // 兜底：不再要求再现，直接把这句走完再收尾，长度照样是八小节
    const tail = pools[start];
    return [...windowOf(0, 8 - tail.length), ...tail];
};

/** 找到「下一个和弦」是哪个，副属才有地方解决 */
const isTonicOf = (spec: ChordSpec) => spec.degree === 1 && spec.accidental === 0;

const applyDevices = (
    specs: ChordSpec[],
    style: StyleConfig,
    ctx: KeyContext,
    rng: () => number,
): string[] => {
    const used: string[] = [];
    const last = specs.length - 1;
    const total = style.tritone + style.mixture + style.secondary;
    let roll = rng() * Math.max(1e-6, total);
    const pickTritone = (roll -= style.tritone) < 0;
    const pickMixture = !pickTritone && (roll -= style.mixture) < 0;
    const pickSecondary = !pickTritone && !pickMixture;

    // 三全音替代：句末属七换成 bII7（与 V7 共用三全音，功能等价）
    if (pickTritone) {
        for (let index = 0; index < last; index++) {
            const current = specs[index];
            const next = specs[index + 1];
            if (current.degree === 5 && current.seventh === 1 && !current.minor && isTonicOf(next)) {
                specs[index] = {
                    ...current,
                    degree: 2,
                    accidental: -1,
                    ninth: 'none',
                };
                used.push('三全音替代');
                break;
            }
        }
    }

    // 借用：大调把下属换成小 iv7（思念 / 变暗），只挂在主或属前面
    if (pickMixture && ctx.mode === 'major') {
        for (let index = 0; index < specs.length; index++) {
            const current = specs[index];
            const next = specs[index + 1];
            if (current.degree !== 4 || current.accidental !== 0 || current.minor) continue;
            if (current.seventh !== 0 || current.ninth !== 'none') continue;
            if (!next || !(isTonicOf(next) || next.degree === 5)) continue;
            specs[index] = { ...current, minor: true, seventh: 1 };
            used.push('借用');
            break;
        }
    }

    // 副属：把「目标和弦的前一格」换成 V7/x，解决时正好顺着五度圈落下去
    if (pickSecondary) {
        const limit = 1;
        let placed = 0;
        for (let index = 1; index < last && placed < limit; index++) {
            const target = specs[index + 1];
            if (!target || target.degree === 1 || target.degree === 5 || target.degree === 7) continue;
            // 借用和弦（bVII / bIII / bVI）是调式色彩，不做副属目标
            if (target.accidental !== 0) continue;
            // 小调的 V7/iv 会带出还原主音，流行 / 摇滚里听着像跑调
            if (ctx.mode === 'minor' && target.degree === 4) continue;
            // 已经是属功能（V7/x 自己）就不再叠
            if (functionOf(specs[index]) === 'D' && specs[index].seventh === 1) continue;
            // 替换的必须是调内和弦：bII7（三全音替代）、bVII7 这些是刻意的色彩，不许再动
            if (specs[index].accidental !== 0) continue;
            // 目标如果是用级进下来的（安达卢西亚、下行四度），插五度会把那条低音线打断
            const currentPc = pc(ctx.tonicMidi + degreeOffset(ctx, specs[index].degree - 1) + specs[index].accidental);
            const targetPc = pc(ctx.tonicMidi + degreeOffset(ctx, target.degree - 1) + target.accidental);
            if (((currentPc - targetPc) % 12 + 12) % 12 <= 2) continue;
            const targetOffset = degreeOffset(ctx, target.degree - 1) + target.accidental;
            const rootPc = pc(ctx.tonicMidi + targetOffset + 7);
            const rootName = pc(rootPc - ctx.tonicMidi);
            let resolved: { degree: number; accidental: number } | null = null;
            for (let degree = 1; degree <= 7 && !resolved; degree++) {
                for (const accidental of [-1, 0, 1]) {
                    if (pc(ctx.offsets[degree - 1] + accidental) === rootName) {
                        resolved = { degree, accidental };
                        break;
                    }
                }
            }
            // 副属的根音必须落在调内的某一级上（五度关系），否则宁可不用
            if (!resolved || resolved.accidental !== 0) continue;
            // 换上去不能和前后撞成同一个和弦（连着两小节同一个和弦听着像卡住）
            const previous = specs[index - 1];
            if (previous && previous.degree === resolved.degree && previous.accidental === 0) continue;
            if (target.degree === resolved.degree) continue;
            specs[index] = {
                degree: resolved.degree,
                accidental: resolved.accidental,
                minor: false,
                dim: false,
                aug: false,
                sus: 0,
                seventh: 1,
                ninth: 'none',
                eleventh: false,
                thirteenth: false,
                sixth: false,
                add9: false,
            };
            used.push('副属');
            placed += 1;
        }
    }

    return used;
};

export const composeProgression = (
    ctx: KeyContext,
    style: StyleConfig,
    rng: () => number,
): ProgressionPlan => {
    const pool = style.idioms.filter((idiom: Idiom) => (ctx.mode === 'major' ? idiom.major : idiom.minor));
    const idiom = pick(pool, rng);
    const base = [...((ctx.mode === 'major' ? idiom.major : idiom.minor) ?? [])];

    // 4 小节的循环，按风格决定要不要铺成 8 小节（A + 再现 + 终止）
    const fourBar = base.length <= 4;
    const wantEight = fourBar && style.phrases.includes(8) && rng() < 0.6;
    const tokens = wantEight ? expandToEight(base, ctx.mode, rng) : base;
    const bars = tokens.length;

    const specs = tokens.map(parseToken);
    // 12 小节蓝调是固定曲式，不加花
    const devices = bars >= 12 ? [] : applyDevices(specs, style, ctx, rng);

    const chords: PlannedChord[] = specs.map((spec, index) => {
        const phraseEnd = index >= bars - 2;
        return {
            spec,
            start: index * 4,
            duration: 4,
            bassInterval: 0,
            phraseEnd,
        };
    });

    // 低音转位：只在低音能级进时转，句末一律踩根音，低音线才顺着走
    const wrapDistance = (a: number, b: number) => {
        const distance = Math.abs(pc(a) - pc(b));
        return Math.min(distance, 12 - distance);
    };
    const rootPcOf = (spec: ChordSpec) => pc(ctx.tonicMidi + degreeOffset(ctx, spec.degree - 1) + spec.accidental);

    for (let index = 1; index < chords.length; index++) {
        const chord = chords[index];
        if (style.voicing === 'power' || chord.phraseEnd) continue;
        if (rng() >= style.inversion) continue;
        const previousPc = rootPcOf(chords[index - 1].spec);
        const root = rootPcOf(chord.spec);
        const options = chord.spec.dim ? [0, 3, 6] : [0, 4, 7];
        const scores = options.map((interval) => wrapDistance(root + interval, previousPc));
        const best = Math.min(...scores);
        if (best <= 2) chord.bassInterval = options[scores.indexOf(best)];
    }

    return {
        bars,
        chords,
        name: [idiom.name, ...devices, cadenceName(tokens)].join(' · '),
    };
};
