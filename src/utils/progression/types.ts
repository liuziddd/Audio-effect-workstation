import type { MidiNote } from '../midi';
import type { Mode, MoodId, StyleId, TextureId } from './patterns';

export interface Settings {
    tonic: string;
    mode: Mode;
    style: StyleId;
    bpm: number;
    mood: MoodId;
}

export interface ChordStep {
    roman: string;
    name: string;
    /** 起始位置，单位：拍 */
    start: number;
    duration: number;
    /** 实际发声音高（含低音） */
    notes: number[];
    /** 上层和声，供织体使用 */
    upper: number[];
}

export interface ChordCard {
    id: string;
    kind: 'chord';
    label: string;
    /** 进行在乐理里的叫法，没有就空着 */
    name?: string;
    chords: ChordStep[];
    notes: MidiNote[];
    bpm: number;
    bars: number;
}

export interface MelodyCard {
    id: string;
    kind: 'melody';
    label: string;
    notes: MidiNote[];
    bpm: number;
    bars: number;
    /** 这条织体是照着哪条和声写的 */
    basedOn: string;
    texture: TextureId;
}

export type Card = ChordCard | MelodyCard;
