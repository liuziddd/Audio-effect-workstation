import type { MidiNote } from '../midi';
import { arrange, buildChord, keyContext, rngFrom } from './harmony';
import { MOODS, STYLES } from './patterns';
import { composeProgression } from './composer';
import { generateTexture } from './texture';
import type { TextureId } from './patterns';
import type { ColorLevel } from './harmony';
import type { ChordCard, ChordStep, MelodyCard, Settings } from './types';

export * from './patterns';
export type { Card, ChordCard, ChordStep, MelodyCard, Settings } from './types';

/** 每个和弦整小节铺开：只交代走向，不做节奏切分（织体另有音型） */
const compNotes = (chords: ChordStep[]): MidiNote[] =>
    chords.flatMap((chord) =>
        chord.notes.map((midi, voice) => ({
            midi,
            start: chord.start,
            duration: chord.duration * 0.94,
            velocity: voice === 0 ? 0.7 : 0.58,
        })),
    );

const generateChordCard = (settings: Settings, seed: number, id: string): ChordCard => {
    const rng = rngFrom(seed);
    const ctx = keyContext(settings.tonic, settings.mode);
    const style = STYLES[settings.style];
    const mood = MOODS[settings.mood];

    // 和弦由功能圈 + 五度圈现场推演，风格只提供倾向与终止式偏好
    const plan = composeProgression(ctx, style, rng);
    const register = mood.register;

    // 整张卡统一色彩：先掷一次，避免一段进行里和弦忽浓忽淡
    const colorRoll = rng();
    const ninthChance = Math.min(0.9, style.ninth + mood.ninth);
    // 强力和弦只弹根音五度八度，挂上七音九音也不会响，名字别跟着变
    const color: ColorLevel = style.voicing === 'power'
        ? 'plain'
        : colorRoll < ninthChance
            ? 'ninth'
            : colorRoll < ninthChance + (1 - ninthChance) * Math.min(1, style.seventh + mood.seventh)
                ? 'seventh'
                : 'plain';

    // 整张卡统一音域：跨度先掷一次，别一句宽一句窄
    const spread = style.spread[Math.floor(rng() * style.spread.length)] ?? 19;

    let previousUpper: number[] | null = null;
    let previousBass: number | null = null;

    const chords: ChordStep[] = plan.chords.map((planned) => {
        const built = buildChord(ctx, planned.spec, {
            style,
            mood: settings.mood,
            rng,
            color,
            // 挂留只留在句中，句末挂上去就落不了地
            allowSus: !planned.phraseEnd,
        });
        const voiced = arrange(built, previousUpper, style, {
            shift: register,
            spread,
            bassInterval: planned.bassInterval,
            previousBass,
        });
        previousUpper = voiced.upper;
        previousBass = voiced.notes[0];
        return {
            roman: built.roman,
            name: built.name,
            start: planned.start,
            duration: planned.duration,
            notes: voiced.notes,
            upper: voiced.upper,
        };
    });

    return {
        id,
        kind: 'chord',
        label: chords.map((chord) => chord.roman).join('–'),
        name: plan.name,
        chords,
        notes: compNotes(chords),
        bpm: settings.bpm,
        bars: plan.bars,
    };
};

const openingRoot = (card: ChordCard) => card.chords[0]?.name.match(/^[A-G][#b]?/)?.[0] ?? '';

/** 循环移位后相同的一律算同一段进行，避免三张卡只是同一句话从不同字起头 */
const canonical = (card: ChordCard) => {
    const romans = card.chords.map((chord) => chord.roman);
    return romans
        .map((_, index) => [...romans.slice(index), ...romans.slice(0, index)].join('–'))
        .sort()[0];
};

export const generateChords = (settings: Settings, seed: number, count = 3): ChordCard[] => {
    const cards: ChordCard[] = [];
    const openings = new Set<string>();
    const shapes = new Set<string>();

    for (let index = 0; index < count; index++) {
        // 小调里能开头的级数就那么几个，先保证「进行本身不同」，再尽量错开开头
        let card = generateChordCard(settings, seed + index * 7919, `c-${seed}-${index}`);
        let fallback: ChordCard | null = null;
        for (let attempt = 1; attempt < 14; attempt++) {
            const shapeNew = !shapes.has(canonical(card));
            if (shapeNew && !openings.has(openingRoot(card))) break;
            if (shapeNew && !fallback) fallback = card;
            card = generateChordCard(settings, seed + index * 7919 + attempt * 104729, `c-${seed}-${index}`);
        }
        if (shapes.has(canonical(card)) && fallback) card = fallback;
        openings.add(openingRoot(card));
        shapes.add(canonical(card));
        cards.push(card);
    }

    return cards;
};

export const generateMelodies = (
    settings: Settings,
    harmonies: ChordCard[],
    seed: number,
    count = 3,
    texture: TextureId = 'arp',
): MelodyCard[] =>
    Array.from({ length: count }, (_, index) => {
        const harmony = harmonies[index % harmonies.length];
        return generateTexture(settings, harmony, seed + index * 4409, `m-${seed}-${index}`, texture);
    });
