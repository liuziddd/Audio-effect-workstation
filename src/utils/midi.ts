/**
 * 最小 MIDI 文件编码器（SMF format 0，单轨）
 * 只做我们生成器需要的事：速度、拍号、音轨名、音色、音符事件。
 * 每四分音符 480 tick。
 */

export interface MidiNote {
    midi: number;
    /** 起始位置，单位：拍 */
    start: number;
    /** 时值，单位：拍 */
    duration: number;
    /** 0~1 */
    velocity: number;
}

const PPQ = 480;

const varLen = (out: number[], value: number) => {
    const bytes = [value & 0x7f];
    let rest = value >>> 7;
    while (rest > 0) {
        bytes.unshift((rest & 0x7f) | 0x80);
        rest >>>= 7;
    }
    out.push(...bytes);
};

const textBytes = (text: string) => Array.from(new TextEncoder().encode(text));

const meta = (type: number, payload: number[]) => [0xff, type, ...varLenBytes(payload.length), ...payload];

const varLenBytes = (value: number) => {
    const bytes: number[] = [];
    varLen(bytes, value);
    return bytes;
};

const u32 = (value: number) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
const u16 = (value: number) => [(value >>> 8) & 0xff, value & 0xff];

export const encodeMidi = ({ notes, bpm, name, program = 0 }: { notes: MidiNote[]; bpm: number; name?: string; program?: number }): Uint8Array => {
    type Event = { tick: number; order: number; data: number[] };
    const events: Event[] = [];

    if (name) events.push({ tick: 0, order: 0, data: meta(0x03, textBytes(name)) });
    const usPerBeat = Math.round(60000000 / bpm);
    events.push({
        tick: 0,
        order: 0,
        data: meta(0x51, [(usPerBeat >> 16) & 0xff, (usPerBeat >> 8) & 0xff, usPerBeat & 0xff]),
    });
    // 4/4：分母 4 = 2^2
    events.push({ tick: 0, order: 0, data: meta(0x58, [4, 2, 24, 8]) });
    events.push({ tick: 0, order: 0, data: [0xc0, program & 0x7f] });

    for (const note of notes) {
        const on = Math.round(note.start * PPQ);
        const off = Math.max(on + 1, Math.round((note.start + note.duration) * PPQ));
        const velocity = Math.max(1, Math.min(127, Math.round(note.velocity * 127)));
        events.push({ tick: on, order: 1, data: [0x90, note.midi & 0x7f, velocity] });
        events.push({ tick: off, order: 0, data: [0x80, note.midi & 0x7f, 0x40] });
    }

    // 同一 tick 上先关后开，避免同音重叠被某些 DAW 判成悬音
    events.sort((a, b) => a.tick - b.tick || a.order - b.order);

    const track: number[] = [];
    let cursor = 0;
    for (const event of events) {
        varLen(track, event.tick - cursor);
        cursor = event.tick;
        track.push(...event.data);
    }
    track.push(0x00, 0xff, 0x2f, 0x00);

    const header = [0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x01, ...u16(PPQ)];
    const chunk = [0x4d, 0x54, 0x72, 0x6b, ...u32(track.length), ...track];
    return new Uint8Array([...header, ...chunk]);
};
