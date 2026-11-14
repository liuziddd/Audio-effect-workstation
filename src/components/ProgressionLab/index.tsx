import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Tone from 'tone';
import { ArrowDownToLine, Dices, Pause, Play, Repeat } from 'lucide-react';
import { KEYS, MOODS, STYLES, TEXTURES, generateChords, generateMelodies } from '../../utils/progression';
import type { Card, ChordCard, MelodyCard, Mode, MoodId, Settings, StyleId, TextureId } from '../../utils/progression';
import { encodeMidi } from '../../utils/midi';
import { downloadBlob } from '../../utils/wav';
import './styles.css';

interface Timbre {
    octave: number;
    harmonics: number;
    spacing: number;
}

const BEATS_PER_BAR = 4;
/** 卷帘基础高度，音域宽时按跨度自动加高 */
const ROLL_HEIGHT = 52;

/* ===== 加法合成 + 前瞻调度：一个音 = N 个正弦，第 k 个频率 = f0 × (1 + (k-1) × 间距) ===== */
const usePreview = () => {
    /** 已经排进音频时钟的节点，按结束时间成批回收 */
    const batchesRef = useRef<{ at: number; nodes: Tone.ToneAudioNode[] }[]>([]);
    const outputRef = useRef<Tone.Gain | null>(null);
    const timerRef = useRef<number | null>(null);
    const queueRef = useRef<Card['notes']>([]);
    const nextRef = useRef(0);
    /** 最后一个已排期音符的位置与音频时间，改速度时从这里接着算 */
    const anchorRef = useRef({ beat: 0, time: 0 });
    const cardRef = useRef<Card | null>(null);
    const totalRef = useRef(16);
    const timbreRef = useRef<Timbre>({ octave: 0, harmonics: 2, spacing: 1 });
    const bpmRef = useRef(96);
    const loopRef = useRef(true);
    const [playingId, setPlayingId] = useState<string | null>(null);

    const output = () => {
        if (!outputRef.current) {
            outputRef.current = new Tone.Gain(1).toDestination();
        }
        return outputRef.current;
    };

    const halt = useCallback(() => {
        if (timerRef.current !== null) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
        }
        batchesRef.current.forEach((batch) => batch.nodes.forEach((node) => node.dispose()));
        batchesRef.current = [];
        cardRef.current = null;
    }, []);

    const stop = useCallback(() => {
        halt();
        setPlayingId(null);
    }, [halt]);

    useEffect(() => () => halt(), [halt]);

    const voice = useCallback((midi: number, at: number, duration: number, velocity: number) => {
        const { octave, harmonics, spacing } = timbreRef.current;
        const frequency = Tone.Frequency(midi + octave * 12, 'midi').toFrequency();
        const envelope = new Tone.Gain(0).connect(output());
        const nodes: Tone.ToneAudioNode[] = [envelope];

        for (let index = 0; index < harmonics; index++) {
            const oscillator = new Tone.Oscillator({
                frequency: frequency * (1 + index * spacing),
                type: 'sine',
            });
            const partial = new Tone.Gain(1 / Math.pow(index + 1, 1.7));
            oscillator.connect(partial);
            partial.connect(envelope);
            oscillator.start(at);
            oscillator.stop(at + duration + 0.6);
            nodes.push(oscillator, partial);
        }

        const peak = 0.3 * velocity / Math.max(1.2, Math.sqrt(harmonics));
        envelope.gain.setValueAtTime(0, at);
        envelope.gain.linearRampToValueAtTime(peak, at + 0.014);
        envelope.gain.linearRampToValueAtTime(peak * 0.55, at + Math.min(duration * 0.55, 0.7));
        envelope.gain.linearRampToValueAtTime(0.0001, at + duration + 0.32);

        batchesRef.current.push({ at: at + duration + 0.9, nodes });
    }, []);

    const start = useCallback((card: Card, fromBeat: number) => {
        halt();
        queueRef.current = card.notes
            .filter((note) => note.start + note.duration > fromBeat)
            // 从曲子中间起播时，正在响的和弦只补剩下的那一截
            .map((note) => (note.start < fromBeat
                ? { ...note, start: fromBeat, duration: note.start + note.duration - fromBeat }
                : note))
            .sort((a, b) => a.start - b.start);
        nextRef.current = 0;
        totalRef.current = card.bars * BEATS_PER_BAR;
        anchorRef.current = { beat: fromBeat, time: Tone.now() + 0.08 };
        cardRef.current = card;
        setPlayingId(card.id);

        const tick = () => {
            if (!cardRef.current) return;
            const now = Tone.now();
            const horizon = now + 0.18;
            const queue = queueRef.current;

            // 逐个音符往音频时钟里排；每排一个都按当前速度折算，所以改速度立刻生效
            while (nextRef.current < queue.length) {
                const note = queue[nextRef.current];
                const anchor = anchorRef.current;
                const at = anchor.time + (note.start - anchor.beat) * (60 / bpmRef.current);
                if (at > horizon) break;
                const time = Math.max(at, now + 0.008);
                voice(note.midi, time, Math.max(0.05, note.duration) * (60 / bpmRef.current), note.velocity);
                anchorRef.current = { beat: note.start, time };
                nextRef.current++;
            }

            // 回收放完的节点，长时间循环不会越攒越多
            const alive: typeof batchesRef.current = [];
            for (const batch of batchesRef.current) {
                if (batch.at < now - 0.6) batch.nodes.forEach((node) => node.dispose());
                else alive.push(batch);
            }
            batchesRef.current = alive;
        };

        tick();
        timerRef.current = window.setInterval(tick, 25);
    }, [halt, voice]);

    const play = async (card: Card, fromBeat = 0) => {
        await Tone.start();
        start(card, fromBeat);
    };

    const replay = useCallback(() => {
        if (cardRef.current) start(cardRef.current, 0);
    }, [start]);

    const progress = useCallback(() => {
        if (!cardRef.current) return 0;
        const anchor = anchorRef.current;
        const beat = anchor.beat + (Tone.now() - anchor.time) * (bpmRef.current / 60);
        return Math.min(1, Math.max(0, beat / totalRef.current));
    }, []);

    return { play, stop, replay, playingId, progress, timbreRef, bpmRef, loopRef };
};

/* ===== 钢琴卷帘：点击/拖动改播放位置 ===== */
const Roll = ({
    notes,
    bars,
    color,
    playing,
    offset,
    getProgress,
    onSeek,
    onEnd,
}: {
    notes: Card['notes'];
    bars: number;
    color: string;
    playing: boolean;
    /** 未播放时播放头停在的位置（0~1） */
    offset: number;
    getProgress: () => number;
    onSeek: (fraction: number) => void;
    onEnd: () => void;
}) => {
    const headRef = useRef<HTMLSpanElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const beats = bars * BEATS_PER_BAR;

    const { low, rowHeight, height } = useMemo(() => {
        if (!notes.length) return { low: 72, rowHeight: 4, height: ROLL_HEIGHT };
        const values = notes.map((note) => note.midi);
        const top = Math.max(...values) + 1;
        const bottom = Math.min(...values) - 1;
        const span = Math.max(6, top - bottom);
        // 音域越宽卷帘越高，五六个八度的铺底也看得清分层
        const tall = Math.min(116, Math.max(ROLL_HEIGHT, 40 + span * 1.15));
        return { low: top, rowHeight: tall / span, height: tall };
    }, [notes]);

    useEffect(() => {
        if (!playing) {
            if (headRef.current) headRef.current.style.left = `${offset * 100}%`;
            return;
        }
        let frame = 0;
        let ended = false;
        const loop = () => {
            const value = getProgress();
            if (headRef.current) headRef.current.style.left = `${value * 100}%`;
            if (value >= 1) {
                if (!ended) {
                    ended = true;
                    onEnd();
                }
            } else {
                ended = false;
            }
            frame = requestAnimationFrame(loop);
        };
        frame = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(frame);
    }, [playing, offset, getProgress, onEnd]);

    const seek = (event: React.PointerEvent) => {
        const rect = rootRef.current?.getBoundingClientRect();
        if (!rect) return;
        onSeek(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)));
    };

    return (
        <div
            className="pr-roll"
            ref={rootRef}
            style={{ height }}
            onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                seek(event);
            }}
            onPointerMove={(event) => {
                if (event.buttons === 1) seek(event);
            }}
        >
            {Array.from({ length: Math.max(0, bars - 1) }, (_, index) => (
                <span key={index} className="pr-bar-line" style={{ left: `${((index + 1) / bars) * 100}%` }} />
            ))}
            {notes.map((note, index) => (
                <span
                    key={index}
                    className="pr-note"
                    style={{
                        left: `${(note.start / beats) * 100}%`,
                        width: `${Math.max(0.6, (note.duration / beats) * 100)}%`,
                        top: `${(low - note.midi) * rowHeight}px`,
                        height: `${Math.max(3.5, rowHeight * 0.72)}px`,
                        background: color,
                    }}
                />
            ))}
            <span className="pr-playhead" ref={headRef} />
        </div>
    );
};

const CardShell = ({
    children,
    title,
    subtitle,
    hint,
    playing,
    onToggle,
    onDownload,
}: {
    children: React.ReactNode;
    title: string;
    subtitle: string;
    hint?: string;
    playing: boolean;
    onToggle: () => void;
    onDownload: () => void;
}) => (
    <div className={`pr-card ${playing ? 'playing' : ''}`}>
        <div className="pr-card-head">
            <button className="pr-card-play" onClick={onToggle} title={playing ? '停止' : '试听'}>
                {playing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            </button>
            <div className="pr-card-text" title={hint}>
                <span className="pr-card-title">{title}</span>
                <span className="pr-card-sub">{subtitle}</span>
            </div>
            <button className="pr-card-download" onClick={onDownload} title="导出 MIDI">
                <ArrowDownToLine className="w-3.5 h-3.5" />
            </button>
        </div>
        {children}
    </div>
);

const fileName = (card: Card, settings: Settings) => {
    const suffix = card.kind === 'chord' ? 'chords' : 'melody';
    const label = card.kind === 'chord' ? card.chords.map((chord) => chord.name).join('-') : card.label.replace(/–/g, '-');
    return `${settings.tonic}${settings.mode === 'major' ? 'maj' : 'min'}-${STYLES[settings.style].label}-${suffix}-${label}.mid`.replace(/\s+/g, '');
};

export const ProgressionLab = () => {
    const { play, stop, replay, playingId, progress, timbreRef, bpmRef, loopRef } = usePreview();
    const [settings, setSettings] = useState<Settings>({ tonic: 'C', mode: 'major', style: 'pop', bpm: 96, mood: 'warm' });
    const [chords, setChords] = useState<ChordCard[]>([]);
    const [melodies, setMelodies] = useState<MelodyCard[]>([]);
    const [timbre, setTimbre] = useState<Timbre>({ octave: 0, harmonics: 2, spacing: 1 });
    const [texture, setTexture] = useState<TextureId>('arp');
    const [loop, setLoop] = useState(true);
    /** 每张卡各自的起播位置（拍），点了卷帘就记在这里 */
    const seekMap = useRef<Record<string, number>>({});
    /** 同一份位置换成 0~1，用来画暂停时的播放头 */
    const [seekAt, setSeekAt] = useState<Record<string, number>>({});

    timbreRef.current = timbre;
    bpmRef.current = settings.bpm;
    loopRef.current = loop;

    const settingsRef = useRef(settings);
    settingsRef.current = settings;
    const chordsRef = useRef<ChordCard[]>([]);
    const seedRef = useRef(0);
    const textureRef = useRef<TextureId>('arp');

    const regenerate = useCallback((section: 'all' | 'chord' | 'melody', keepSeed = false) => {
        if (!keepSeed) seedRef.current += 1;
        const seed = seedRef.current * 977;
        const next = settingsRef.current;
        stop();
        seekMap.current = {};

        if (section !== 'melody') {
            const chordCards = generateChords(next, seed, 3);
            chordsRef.current = chordCards;
            setChords(chordCards);
            setMelodies(generateMelodies(next, chordCards, seed + 4111, 3, textureRef.current));
            return;
        }
        const base = chordsRef.current.length ? chordsRef.current : generateChords(next, seed, 3);
        if (!chordsRef.current.length) {
            chordsRef.current = base;
            setChords(base);
        }
        setMelodies(generateMelodies(next, base, seed + 4111, 3, textureRef.current));
    }, [stop]);

    // 离散参数一改就换一批；速度只影响播放，不重新生成
    useEffect(() => {
        regenerate('all');
    }, [settings.tonic, settings.mode, settings.style, settings.mood, regenerate]);

    const toggle = (card: Card) => {
        if (playingId === card.id) {
            stop();
            return;
        }
        play(card, seekMap.current[card.id] ?? 0);
    };

    const seek = (card: Card, fraction: number) => {
        const beat = card.bars * BEATS_PER_BAR * fraction;
        seekMap.current[card.id] = beat;
        setSeekAt((previous) => ({ ...previous, [card.id]: fraction }));
        if (playingId === card.id) play(card, beat);
    };

    const handleEnd = (card: Card) => {
        if (loopRef.current) {
            replay();
            return;
        }
        seekMap.current[card.id] = 0;
        setSeekAt((previous) => ({ ...previous, [card.id]: 0 }));
        stop();
    };

    // 换织体：种子不变，同一段和声换一种弹法，方便直接对比
    const switchTexture = (next: TextureId) => {
        if (next === texture) return;
        setTexture(next);
        textureRef.current = next;
        regenerate('melody', true);
    };

    const download = (card: Card) => {
        const bytes = encodeMidi({ notes: card.notes, bpm: settings.bpm, name: card.kind === 'chord' ? '和弦进行' : '旋律进行' });
        downloadBlob(new Blob([bytes], { type: 'audio/midi' }), fileName(card, settings));
    };

    return (
        <div className="pr-root">
            {/* 参数 */}
            <div className="pr-settings">
                <div className="pr-row">
                    <span className="pr-label">调性</span>
                    <div className="pr-group">
                        <select className="pr-select" value={settings.tonic} onChange={(event) => setSettings({ ...settings, tonic: event.target.value })}>
                            {KEYS.map((key) => (
                                <option key={key} value={key}>{key}</option>
                            ))}
                        </select>
                        <div className="pr-segment">
                            {(['major', 'minor'] as Mode[]).map((mode) => (
                                <button
                                    key={mode}
                                    className={settings.mode === mode ? 'on' : ''}
                                    onClick={() => setSettings({ ...settings, mode })}
                                >
                                    {mode === 'major' ? '大调' : '小调'}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="pr-row pr-row-block">
                    <span className="pr-label">风格</span>
                    <div className="pr-chips">
                        {(Object.keys(STYLES) as StyleId[]).map((id) => (
                            <button
                                key={id}
                                className={`pr-chip ${settings.style === id ? 'on' : ''}`}
                                onClick={() => setSettings({ ...settings, style: id })}
                            >
                                {STYLES[id].label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="pr-row">
                    <span className="pr-label">速度</span>
                    <input
                        className="pr-range"
                        type="range"
                        min={56}
                        max={168}
                        step={1}
                        value={settings.bpm}
                        onChange={(event) => setSettings({ ...settings, bpm: Number(event.target.value) })}
                    />
                    <span className="pr-value">{settings.bpm}</span>
                    <button
                        className={`pr-loop ${loop ? 'on' : ''}`}
                        onClick={() => setLoop(!loop)}
                        title={loop ? '循环试听：开' : '循环试听：关'}
                    >
                        <Repeat className="w-3 h-3" />
                    </button>
                </div>

                <div className="pr-row">
                    <span className="pr-label">情绪</span>
                    <div className="pr-chips">
                        {(Object.keys(MOODS) as MoodId[]).map((id) => (
                            <button
                                key={id}
                                className={`pr-chip ${settings.mood === id ? 'on' : ''}`}
                                onClick={() => setSettings({ ...settings, mood: id })}
                            >
                                {MOODS[id].label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="pr-row">
                    <span className="pr-label">音色</span>
                    <div className="pr-timbre">
                        <span className="pr-timbre-name">八度</span>
                        <div className="pr-segment">
                            {[-1, 0, 1].map((value) => (
                                <button key={value} className={timbre.octave === value ? 'on' : ''} onClick={() => setTimbre({ ...timbre, octave: value })}>
                                    {value > 0 ? `+${value}` : value}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
                <div className="pr-row">
                    <span className="pr-label">谐波</span>
                    <input
                        className="pr-range"
                        type="range"
                        min={1}
                        max={6}
                        step={1}
                        value={timbre.harmonics}
                        onChange={(event) => setTimbre({ ...timbre, harmonics: Number(event.target.value) })}
                    />
                    <span className="pr-value">{timbre.harmonics}</span>
                    <span className="pr-timbre-name">间距</span>
                    <input
                        className="pr-range pr-range-short"
                        type="range"
                        min={1}
                        max={2}
                        step={0.05}
                        value={timbre.spacing}
                        onChange={(event) => setTimbre({ ...timbre, spacing: Number(event.target.value) })}
                    />
                    <span className="pr-value">{timbre.spacing.toFixed(2)}</span>
                </div>
            </div>

            {/* 和弦 */}
            <div className="pr-section">
                <div className="pr-section-head">
                    <h4>和声进行</h4>
                    <button className="pr-refresh" onClick={() => regenerate('chord')}>
                        <Dices className="w-3.5 h-3.5" />
                        换一批
                    </button>
                </div>
                {chords.map((card) => (
                    <CardShell
                        key={card.id}
                        title={card.chords.map((chord) => chord.name).join(' · ')}
                        subtitle={`${card.bars} 小节 · ${card.chords.map((chord) => chord.roman).join('–')}`}
                        hint={`${card.name}｜${card.chords.map((chord) => chord.name).join(' ')}`}
                        playing={playingId === card.id}
                        onToggle={() => toggle(card)}
                        onDownload={() => download(card)}
                    >
                        <Roll
                            notes={card.notes}
                            bars={card.bars}
                            color="var(--pr-chord)"
                            playing={playingId === card.id}
                            offset={seekAt[card.id] ?? 0}
                            getProgress={progress}
                            onSeek={(fraction) => seek(card, fraction)}
                            onEnd={() => handleEnd(card)}
                        />
                    </CardShell>
                ))}
            </div>

            {/* 织体 */}
            <div className="pr-section">
                <div className="pr-section-head">
                    <h4>织体</h4>
                    <div className="pr-head-actions">
                        <div className="pr-segment">
                            {(Object.keys(TEXTURES) as TextureId[]).map((id) => (
                                <button key={id} className={texture === id ? 'on' : ''} onClick={() => switchTexture(id)}>
                                    {TEXTURES[id]}
                                </button>
                            ))}
                        </div>
                        <button className="pr-refresh" onClick={() => regenerate('melody')}>
                            <Dices className="w-3.5 h-3.5" />
                            换一批
                        </button>
                    </div>
                </div>
                {melodies.map((card) => (
                    <CardShell
                        key={card.id}
                        title={`${TEXTURES[card.texture]} · ${new Set(card.notes.map((note) => note.start)).size} 个音`}
                        subtitle={`${card.bars} 小节 · 和声 ${card.basedOn}`}
                        playing={playingId === card.id}
                        onToggle={() => toggle(card)}
                        onDownload={() => download(card)}
                    >
                        <Roll
                            notes={card.notes}
                            bars={card.bars}
                            color="var(--pr-melody)"
                            playing={playingId === card.id}
                            offset={seekAt[card.id] ?? 0}
                            getProgress={progress}
                            onSeek={(fraction) => seek(card, fraction)}
                            onEnd={() => handleEnd(card)}
                        />
                    </CardShell>
                ))}
            </div>
        </div>
    );
};
