import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import * as Tone from 'tone';
import { EffectConfig, EffectType, EqBandData, ShaperPoint } from '../types/audio';
import { AudioEffectsProcessor, getEffectsTailDuration } from '../utils/audioEffects';
import { getDefaultEffectParameters, createDefaultEqBands, createDefaultShaperPoints, validateAudioFile } from '../utils/audioUtils';

export interface MixerChannel {
    id: string;
    /** 通道编号显示名，如 CH 1（单击可改名） */
    label: string;
    /** 用户手动改过名：编号不再跟着位置重排 */
    customLabel?: boolean;
    /** 已加载音频的文件名，空串表示空通道 */
    trackName: string;
    duration: number;
    /** 线性增益 0~1.5 */
    volume: number;
    /** 声像 -1（左）~ 1（右） */
    pan: number;
    muted: boolean;
    solo: boolean;
    /** 旁通该通道的全部效果器 */
    bypassed: boolean;
    effects: EffectConfig[];
    /** 通道自己的颜色（分组时也用来标色） */
    color?: string;
    /** 所属分组；同一分组的通道共用一种颜色 */
    groupId?: string;
}

/** 分组：一组连续通道 + 一个统一颜色 + 一个可改的名字 */
export interface MixerGroup {
    id: string;
    color: string;
    /** 显示在组首通道条上方的名字，点击即可改 */
    name: string;
}

/** 通道间单向路由：from 的输出送到 to 的输入；线色跟着源通道颜色走 */
interface MixerRoute {
    id: string;
    from: string;
    to: string;
}

interface ChannelNodes {
    player: Tone.Player | null;
    processor: AudioEffectsProcessor;
    gain: Tone.Gain;
    volume: Tone.Volume;
    /** 恒等曲线：输入超出 ±1 时被节点按端点钳制，等价于 0 dBFS 硬削波 */
    clipper: Tone.WaveShaper;
    panner: Tone.Panner;
    analyser: Tone.Analyser;
}

const PLAYBACK_FADE_TIME = 0.015;

/** 推子顶端的增益上限：+12 dB（推到顶足以让通道过载） */
const FADER_MAX_DB = 12;
/** 批量按比例调音量时的上限，别让一条通道被倍率推出量程 */
const MAX_CHANNEL_GAIN = 10 ** (FADER_MAX_DB / 20);
/** 0 dB 在推子行程上的位置：下方 80% 走 -60~0 dB，上方 20% 走 0~+12 dB */
const FADER_UNITY = 0.8;
/** 推子底端的对数量程 */
const FADER_FLOOR_DB = 60;

/** 通道推子：默认 1.0 = 0 dB（音频按原始大小播放） */
export const DEFAULT_CHANNEL_VOLUME = 1;

/** 推子行程（0 底 ~ 1 顶）→ 线性增益 */
export const faderToGain = (ratio: number) => {
    const position = Math.max(0, Math.min(1, ratio));
    if (position <= 0.02) return 0;
    const db = position <= FADER_UNITY
        ? FADER_FLOOR_DB * (position / FADER_UNITY) - FADER_FLOOR_DB
        : FADER_MAX_DB * ((position - FADER_UNITY) / (1 - FADER_UNITY));
    return 10 ** (db / 20);
};

/** 线性增益 → 推子行程（faderToGain 的逆） */
export const gainToFader = (gain: number) => {
    if (gain <= 0) return 0;
    const db = 20 * Math.log10(gain);
    if (db <= 0) return Math.max(0, (db + FADER_FLOOR_DB) / FADER_FLOOR_DB) * FADER_UNITY;
    return FADER_UNITY + Math.min(1, db / FADER_MAX_DB) * (1 - FADER_UNITY);
};

const effectNames: Record<EffectType, string> = {
    reverb: '混响',
    eq: '均衡器',
    compressor: '压缩器',
    delay: '延迟',
    chorus: '合唱',
    phaser: '相位器',
    distortion: '失真',
    filter: '滤波器',
    limiter: '限制器',
    gate: '噪声门',
};

const writeString = (view: DataView, offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
};

const exportWAV = (audioBuffer: AudioBuffer, filename: string) => {
    const { length, numberOfChannels, sampleRate } = audioBuffer;
    const bytesPerSample = 2;
    const dataSize = length * numberOfChannels * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numberOfChannels * bytesPerSample, true);
    view.setUint16(32, numberOfChannels * bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    const channels = Array.from({ length: numberOfChannels }, (_, channel) => audioBuffer.getChannelData(channel));
    let offset = 44;
    for (let i = 0; i < length; i++) {
        for (const channelData of channels) {
            const sample = Math.max(-1, Math.min(1, channelData[i]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
            offset += 2;
        }
    }

    const url = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
};

const createChannel = (serial: number, position: number): MixerChannel => ({
    id: `ch_${Date.now()}_${serial}`,
    label: `CH ${position + 1}`,
    trackName: '',
    duration: 0,
    volume: DEFAULT_CHANNEL_VOLUME,
    pan: 0,
    muted: false,
    solo: false,
    bypassed: false,
    effects: [],
});

/** 没被手动命名的通道，编号跟着位置走；改过名的保持原名 */
const renumber = (list: MixerChannel[]) =>
    list.map((channel, index) => (
        channel.customLabel ? channel : { ...channel, label: `CH ${index + 1}` }
    ));

/**
 * 分组必须是一段连续的通道。排序、增删、拖动之后过一遍：
 * 每组保留最长的一段连续成员，被拖散的其余成员退出分组并恢复默认颜色；
 * 保留段不足两条时整组解散。
 */
const enforceGroupContinuity = (list: MixerChannel[]): MixerChannel[] => {
    const members = new Map<string, number[]>();
    list.forEach((channel, index) => {
        if (!channel.groupId) return;
        const seen = members.get(channel.groupId);
        if (seen) seen.push(index);
        else members.set(channel.groupId, [index]);
    });

    const leaving = new Set<number>();
    for (const indexes of members.values()) {
        // 切成连续段，留下最长的一段（一样长取靠左的）
        let bestStart = 0;
        let bestLength = 1;
        let start = 0;
        for (let i = 1; i <= indexes.length; i++) {
            if (i < indexes.length && indexes[i] === indexes[i - 1] + 1) continue;
            if (i - start > bestLength) {
                bestStart = start;
                bestLength = i - start;
            }
            start = i;
        }
        const from = bestLength >= 2 ? indexes[bestStart] : -1;
        const to = bestLength >= 2 ? indexes[bestStart + bestLength - 1] : -1;
        for (const index of indexes) {
            if (index < from || index > to) leaving.add(index);
        }
    }

    if (!leaving.size) return list;
    return list.map((channel, index) => (
        leaving.has(index) ? { ...channel, groupId: undefined, color: undefined } : channel
    ));
};

/** 把一段通道按「留下的在前、退出的在后」重排，退出者恢复默认色 */
const splitGroup = (
    list: MixerChannel[],
    groupId: string,
    leaving: Set<string>,
): MixerChannel[] => {
    const members = list.filter((channel) => channel.groupId === groupId);
    if (!members.length) return list;
    const going = members.filter((channel) => leaving.has(channel.id));
    if (!going.length) return list;
    const staying = members.filter((channel) => !leaving.has(channel.id));
    const dissolved = staying.length < 2;
    const kept = dissolved ? staying.map((c) => ({ ...c, groupId: undefined, color: undefined })) : staying;
    const ejected = going.map((c) => ({ ...c, groupId: undefined, color: undefined }));

    const block = new Set(members.map((channel) => channel.id));
    const firstIndex = list.findIndex((channel) => channel.id === members[0].id);
    const rest = list.filter((channel) => !block.has(channel.id));
    return [...rest.slice(0, firstIndex), ...kept, ...ejected, ...rest.slice(firstIndex)];
};

export const useMixer = (initialChannels = 8) => {
    const [channels, setChannels] = useState<MixerChannel[]>(() =>
        Array.from({ length: initialChannels }, (_, index) => createChannel(index, index))
    );
    const [routes, setRoutes] = useState<MixerRoute[]>([]);
    const [isPlaying, setIsPlaying] = useState(false);
    const [loop, setLoop] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    /** 各通道的分析器引用，供波形与电平表读取 */
    const [analyzers, setAnalyzers] = useState<Record<string, Tone.Analyser>>({});
    /** 侧栏效果器库的投放目标：最后被操作的那条通道 */
    const [activeChannelId, setActiveChannelId] = useState(() => channels[0].id);
    const [groups, setGroups] = useState<MixerGroup[]>([]);
    /** 固定在左侧、不随横向滚动移出视口的通道 */
    const [pinnedIds, setPinnedIds] = useState<string[]>([]);

    const nodesRef = useRef(new Map<string, ChannelNodes>());
    const buffersRef = useRef(new Map<string, AudioBuffer>());
    const masterGainRef = useRef<Tone.Gain | null>(null);
    const channelsRef = useRef(channels);
    const groupsRef = useRef(groups);
    const effectCounterRef = useRef(0);
    const channelCounterRef = useRef(initialChannels);

    const isPlayingRef = useRef(false);
    const loopRef = useRef(false);
    const positionRef = useRef(0);
    const durationRef = useRef(0);
    const playbackStartedAtRef = useRef(0);
    const playbackOffsetRef = useRef(0);
    const resumeAfterSeekRef = useRef(false);
    const updateIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    channelsRef.current = channels;
    groupsRef.current = groups;
    loopRef.current = loop;

    const updatePosition = useCallback((time: number) => {
        const clamped = Math.max(0, Math.min(time, durationRef.current));
        positionRef.current = clamped;
        setCurrentTime(clamped);
    }, []);

    const getPlaybackPosition = useCallback(() => {
        if (!isPlayingRef.current) return positionRef.current;
        const elapsed = Math.max(0, Tone.now() - playbackStartedAtRef.current);
        return Math.min(playbackOffsetRef.current + elapsed, durationRef.current);
    }, []);

    const stopAllPlayers = useCallback(() => {
        for (const nodes of nodesRef.current.values()) {
            if (nodes.player?.state === 'started') nodes.player.stop();
        }
        isPlayingRef.current = false;
        setIsPlaying(false);
    }, []);

    const startFromPosition = useCallback((time: number) => {
        const startAt = Tone.now() + PLAYBACK_FADE_TIME;
        let started = 0;
        for (const channel of channelsRef.current) {
            const nodes = nodesRef.current.get(channel.id);
            const buffer = buffersRef.current.get(channel.id);
            if (!nodes?.player || !buffer || time >= buffer.duration) continue;
            if (nodes.player.state === 'started') nodes.player.stop();
            nodes.player.start(startAt, time);
            started += 1;
        }
        if (!started) return false;

        playbackStartedAtRef.current = startAt;
        playbackOffsetRef.current = time;
        updatePosition(time);
        isPlayingRef.current = true;
        setIsPlaying(true);
        return true;
    }, [updatePosition]);

    // 母线：所有通道汇入 → 输出。不挂限制器——推过头就该听到、看到削波
    useEffect(() => {
        const master = new Tone.Gain(1);
        master.toDestination();
        masterGainRef.current = master;

        return () => {
            if (updateIntervalRef.current) clearInterval(updateIntervalRef.current);
            for (const nodes of nodesRef.current.values()) {
                nodes.player?.dispose();
                nodes.processor.dispose();
                nodes.gain.dispose();
                nodes.volume.dispose();
                nodes.clipper.dispose();
                nodes.panner.dispose();
                nodes.analyser.dispose();
            }
            nodesRef.current.clear();
            master.dispose();
            masterGainRef.current = null;
        };
    }, []);

    // 通道增删：同步节点图
    const channelIds = useMemo(() => channels.map((channel) => channel.id).join('|'), [channels]);
    useEffect(() => {
        const master = masterGainRef.current;
        if (!master) return;
        const ids = new Set(channelsRef.current.map((channel) => channel.id));
        const removed: string[] = [];

        for (const [id, nodes] of nodesRef.current) {
            if (ids.has(id)) continue;
            nodes.player?.dispose();
            nodes.processor.dispose();
            nodes.gain.dispose();
            nodes.volume.dispose();
            nodes.clipper.dispose();
            nodes.panner.dispose();
            nodes.analyser.dispose();
            nodesRef.current.delete(id);
            buffersRef.current.delete(id);
            removed.push(id);
        }

        if (removed.length) {
            setAnalyzers((previous) => {
                const next = { ...previous };
                for (const id of removed) delete next[id];
                return next;
            });
        }

        for (const channel of channelsRef.current) {
            if (nodesRef.current.has(channel.id)) continue;
            const processor = new AudioEffectsProcessor();
            const gain = new Tone.Gain(1);
            const volume = new Tone.Volume(Tone.gainToDb(channel.volume));
            const panner = new Tone.Panner(channel.pan);
            const analyser = new Tone.Analyser('waveform', 1024);
            const clipper = new Tone.WaveShaper((value: number) => value, 8192);
            processor.connect(gain);
            gain.connect(volume);
            volume.connect(analyser);
            analyser.connect(clipper);
            clipper.connect(panner);
            nodesRef.current.set(channel.id, { player: null, processor, gain, volume, clipper, panner, analyser });
            setAnalyzers((previous) => ({ ...previous, [channel.id]: analyser }));
        }
    }, [channelIds]);

    // 通道路由：有下游的通道把输出接到下游的效果器入口，没有下游的直接进母线
    useEffect(() => {
        const master = masterGainRef.current;
        if (!master) return;
        for (const nodes of nodesRef.current.values()) nodes.panner.disconnect();
        for (const channel of channelsRef.current) {
            const nodes = nodesRef.current.get(channel.id);
            if (!nodes) continue;
            const outgoing = routes.filter((route) => route.from === channel.id);
            if (!outgoing.length) {
                nodes.panner.connect(master);
                continue;
            }
            for (const route of outgoing) {
                const target = nodesRef.current.get(route.to);
                if (target) nodes.panner.connect(target.processor.getInput());
            }
        }
    }, [routes, channelIds]);

    // 参数同步：音量 / 声像 / 静音独奏 / 效果链
    useEffect(() => {
        const anySolo = channels.some((channel) => channel.solo);
        for (const channel of channels) {
            const nodes = nodesRef.current.get(channel.id);
            if (!nodes) continue;
            nodes.volume.volume.rampTo(channel.volume <= 0 ? -Infinity : Tone.gainToDb(channel.volume), 0.02);
            nodes.panner.pan.rampTo(channel.pan, 0.02);
            const audible = !channel.muted && (!anySolo || channel.solo);
            nodes.gain.gain.rampTo(audible ? 1 : 0, 0.01);
            nodes.processor.updateEffectsChain(channel.effects, channel.bypassed);
        }
    }, [channels]);

    // 混音总时长 = 已加载通道里最长的那条
    useEffect(() => {
        const max = channels.reduce((longest, channel) => Math.max(longest, channel.duration), 0);
        durationRef.current = max;
        setDuration(max);
    }, [channels]);

    // 播放进度轮询
    useEffect(() => {
        if (!isPlaying) return;
        updateIntervalRef.current = setInterval(() => {
            const next = getPlaybackPosition();
            if (next >= durationRef.current) {
                // 循环开启：整台从开头接上，进度条跟着回零，不中断播放
                if (loopRef.current) {
                    startFromPosition(0);
                    return;
                }
                stopAllPlayers();
                updatePosition(durationRef.current);
                resumeAfterSeekRef.current = false;
            } else {
                updatePosition(next);
            }
        }, 50);
        return () => {
            if (updateIntervalRef.current) clearInterval(updateIntervalRef.current);
            updateIntervalRef.current = null;
        };
    }, [isPlaying, getPlaybackPosition, startFromPosition, updatePosition, stopAllPlayers]);

    const play = useCallback(async () => {
        if (isPlayingRef.current) return;
        if (Tone.context.state !== 'running') await Tone.start();
        const startPosition = positionRef.current >= durationRef.current ? 0 : positionRef.current;
        startFromPosition(startPosition);
    }, [startFromPosition]);

    const pause = useCallback(() => {
        if (!isPlayingRef.current) return;
        updatePosition(getPlaybackPosition());
        stopAllPlayers();
    }, [getPlaybackPosition, updatePosition, stopAllPlayers]);

    const toggleLoop = useCallback(() => setLoop((current) => !current), []);

    const stop = useCallback(() => {
        resumeAfterSeekRef.current = false;
        stopAllPlayers();
        updatePosition(0);
    }, [stopAllPlayers, updatePosition]);

    const beginSeek = useCallback(() => {
        resumeAfterSeekRef.current = isPlayingRef.current;
        if (isPlayingRef.current) pause();
    }, [pause]);

    const previewSeek = useCallback((time: number) => updatePosition(time), [updatePosition]);

    const seek = useCallback((time: number) => {
        const shouldResume = resumeAfterSeekRef.current || isPlayingRef.current;
        resumeAfterSeekRef.current = false;
        stopAllPlayers();
        updatePosition(time);
        if (shouldResume && positionRef.current < durationRef.current) startFromPosition(positionRef.current);
    }, [startFromPosition, stopAllPlayers, updatePosition]);

    const updateChannel = useCallback((channelId: string, patch: Partial<MixerChannel>) => {
        setChannels((previous) => previous.map((channel) => (
            channel.id === channelId ? { ...channel, ...patch } : channel
        )));
    }, []);

    /**
     * 批量改参数（Shift 多选后的通用参数）：
     * 音量 / 声像按「比例」同步——以发起操作的通道为基准，其余通道乘同一个倍率；
     * 声像在基准为 0 时比例失效，改用同向偏移量。旁通 / 静音 / 独奏这类开关直接同步成当前状态。
     */
    const updateChannels = useCallback((ids: string[], patch: Partial<MixerChannel>) => {
        setChannels((previous) => {
            const anchor = previous.find((channel) => channel.id === ids[0]);
            if (!anchor) return previous;
            const volumeRatio = patch.volume !== undefined && anchor.volume > 0 ? patch.volume / anchor.volume : 1;
            const panRatio = patch.pan !== undefined && Math.abs(anchor.pan) > 0.001 ? patch.pan / anchor.pan : null;
            const panOffset = patch.pan !== undefined ? patch.pan - anchor.pan : 0;

            return previous.map((channel) => {
                if (!ids.includes(channel.id)) return channel;
                if (channel.id === ids[0]) return { ...channel, ...patch };
                const next: MixerChannel = { ...channel, ...patch };
                if (patch.volume !== undefined) next.volume = Math.min(MAX_CHANNEL_GAIN, channel.volume * volumeRatio);
                if (patch.pan !== undefined) {
                    next.pan = Math.max(-1, Math.min(1, panRatio === null ? channel.pan + panOffset : channel.pan * panRatio));
                }
                return next;
            });
        });
    }, []);

    const loadChannelAudio = useCallback(async (channelId: string, file: File) => {
        if (!validateAudioFile(file)) return;
        if (Tone.context.state !== 'running') await Tone.start();
        const url = URL.createObjectURL(file);
        try {
            const toneBuffer = await Tone.ToneAudioBuffer.fromUrl(url);
            const audioBuffer = toneBuffer.get();
            const nodes = nodesRef.current.get(channelId);
            if (!audioBuffer || !nodes) return;
            if (isPlayingRef.current) pause();

            nodes.player?.dispose();
            const player = new Tone.Player(audioBuffer);
            player.fadeIn = PLAYBACK_FADE_TIME;
            player.fadeOut = PLAYBACK_FADE_TIME;
            player.connect(nodes.processor.getInput());
            nodes.player = player;
            buffersRef.current.set(channelId, audioBuffer);

            updateChannel(channelId, {
                trackName: file.name,
                duration: audioBuffer.duration,
            });
        } finally {
            URL.revokeObjectURL(url);
        }
    }, [pause, updateChannel]);

    const clearChannel = useCallback((channelId: string) => {
        const nodes = nodesRef.current.get(channelId);
        nodes?.player?.stop();
        nodes?.player?.dispose();
        if (nodes) nodes.player = null;
        buffersRef.current.delete(channelId);
        updateChannel(channelId, { trackName: '', duration: 0 });
    }, [updateChannel]);

    const addChannel = useCallback(() => {
        const serial = channelCounterRef.current++;
        setChannels((previous) => [...previous, createChannel(serial, previous.length)]);
    }, []);

    /**
     * 拖动排序：把一组通道（多选时是整段）插到 targetId 之前，targetId 传 null 表示落到队尾；
     * 组内相对顺序不变，没改过名的通道编号跟着位置重排。
     * 落点左右有同组邻居时，被拖进来的通道自动并入那个分组——拖进组就等于入组。
     */
    const moveChannels = useCallback((ids: string[], targetId: string | null) => {
        setChannels((previous) => {
            if (!ids.length) return previous;
            const moving = previous.filter((channel) => ids.includes(channel.id));
            const rest = previous.filter((channel) => !ids.includes(channel.id));
            if (!moving.length) return previous;
            const to = targetId === null ? rest.length : rest.findIndex((channel) => channel.id === targetId);
            if (to < 0) return previous;
            const next = [...rest];
            next.splice(to, 0, ...moving);

            // 拖进分组：原本不属于任何组的通道，落点左右有组员就并进那个组。
            // 这一步必须排在连续性校验之前——否则被拖进组中间的那条会先把它后面的组员挤出去
            const groups = new Map(groupsRef.current.map((group) => [group.id, group]));
            let joined = false;
            for (let index = 0; index < next.length; index += 1) {
                const channel = next[index];
                if (channel.groupId || !ids.includes(channel.id)) continue;
                const before = next[index - 1]?.groupId;
                const after = next[index + 1]?.groupId;
                const groupId = before && before === after ? before : (before ?? after);
                const group = groupId ? groups.get(groupId) : undefined;
                if (!group) continue;
                next[index] = { ...channel, groupId: group.id, color: group.color };
                joined = true;
            }

            // 拖动会把同组通道拉散：散开的自动退出分组，颜色也跟着回默认
            const ordered = enforceGroupContinuity(next);

            // 顺序和分组都没变就不触发重渲染
            if (
                !joined
                && ordered === next
                && next.every((channel, index) => channel.id === previous[index].id)
            ) {
                return previous;
            }
            return renumber(ordered);
        });
    }, []);

    /** 单条通道改颜色：属于分组时整组一起换色，点「默认」等于退出这个分组 */
    const setChannelColor = useCallback((channelId: string, color: string | null) => {
        setChannels((previous) => {
            const target = previous.find((channel) => channel.id === channelId);
            if (!target) return previous;
            if (target.groupId) {
                if (!color) return renumber(splitGroup(previous, target.groupId, new Set([channelId])));
                return previous.map((channel) => (
                    channel.groupId === target.groupId ? { ...channel, color } : channel
                ));
            }
            return previous.map((channel) => (
                channel.id === channelId ? { ...channel, color: color ?? undefined } : channel
            ));
        });
        if (color) {
            const groupId = channelsRef.current.find((channel) => channel.id === channelId)?.groupId;
            if (!groupId) return;
            setGroups((previous) => previous.map((group) => (
                group.id === groupId ? { ...group, color } : group
            )));
        }
    }, []);

    /**
     * 把选中的通道并成一个分组。非相邻的成员会被自动拉拢到最左那条的右边，连成一段，
     * 这样分组两侧的分隔线才画得出来；组名自动排号，之后可以点着改。
     */
    const groupChannels = useCallback((ids: string[], color: string) => {
        if (ids.length < 2) return;
        const used = new Set(groupsRef.current.map((group) => group.name));
        let serial = groupsRef.current.length + 1;
        while (used.has(`分组 ${serial}`)) serial += 1;
        const id = `g_${Date.now().toString(36)}`;
        const name = `分组 ${serial}`;

        setChannels((previous) => {
            const members = previous.filter((channel) => ids.includes(channel.id));
            if (members.length < 2) return previous;
            const others = previous.filter((channel) => !ids.includes(channel.id));
            const anchor = previous.findIndex((channel) => ids.includes(channel.id));
            const insertAt = previous.slice(0, anchor).filter((channel) => !ids.includes(channel.id)).length;
            const grouped = members.map((channel) => ({ ...channel, groupId: id, color }));
            return renumber([...others.slice(0, insertAt), ...grouped, ...others.slice(insertAt)]);
        });
        setGroups((previous) => [...previous, { id, color, name }]);
    }, []);

    /** 把选中的通道并进已有分组：接到组尾之后，颜色跟组色；原本在别的组里的会一起搬过来 */
    const joinGroup = useCallback((ids: string[], groupId: string) => {
        setChannels((previous) => {
            const group = groupsRef.current.find((item) => item.id === groupId);
            if (!group) return previous;
            const moving = previous.filter((channel) => ids.includes(channel.id) && channel.groupId !== groupId);
            if (!moving.length) return previous;
            const movingIds = new Set(moving.map((channel) => channel.id));
            const lastMember = previous.reduce(
                (last, channel, index) => (channel.groupId === groupId ? index : last),
                -1,
            );
            if (lastMember < 0) return previous;
            const insertAt = previous
                .slice(0, lastMember + 1)
                .filter((channel) => !movingIds.has(channel.id)).length;
            const rest = previous.filter((channel) => !movingIds.has(channel.id));
            const joined = moving.map((channel) => ({ ...channel, groupId, color: group.color }));
            const next = [...rest];
            next.splice(insertAt, 0, ...joined);
            return renumber(enforceGroupContinuity(next));
        });
    }, []);

    /** 解散分组：退出的通道移到组尾之外并恢复默认颜色；组里剩不到两条就整组解散 */
    const ungroupChannels = useCallback((ids: string[]) => {
        const leaving = new Set(ids);
        setChannels((previous) => {
            const affected = new Set(
                previous
                    .filter((channel) => channel.groupId && leaving.has(channel.id))
                    .map((channel) => channel.groupId!),
            );
            if (!affected.size) return previous;
            let next = previous;
            for (const groupId of affected) next = splitGroup(next, groupId, leaving);
            return renumber(next);
        });
    }, []);

    const renameGroup = useCallback((groupId: string, name: string) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        setGroups((previous) => previous.map((group) => (
            group.id === groupId ? { ...group, name: trimmed } : group
        )));
    }, []);

    // 组里一个成员都不剩了（全被拖出去或删掉），分组记录跟着注销
    useEffect(() => {
        const alive = new Set(
            channels.map((channel) => channel.groupId).filter((id): id is string => Boolean(id)),
        );
        setGroups((previous) => {
            const next = previous.filter((group) => alive.has(group.id));
            return next.length === previous.length ? previous : next;
        });
    }, [channels]);

    /** 固定 / 取消固定：已经全固定了就整组取消 */
    const togglePin = useCallback((ids: string[]) => {
        if (!ids.length) return;
        setPinnedIds((previous) => {
            const allPinned = ids.every((id) => previous.includes(id));
            return allPinned
                ? previous.filter((id) => !ids.includes(id))
                : [...new Set([...previous, ...ids])];
        });
    }, []);

    /** 清掉手动命名的名字，恢复成按位置编号的 CH n */
    const resetChannelLabel = useCallback((channelId: string) => {
        setChannels((previous) => renumber(previous.map((channel) => (
            channel.id === channelId ? { ...channel, customLabel: false } : channel
        ))));
    }, []);

    const removeChannel = useCallback((channelId: string) => {
        setChannels((previous) => {
            if (previous.length <= 1) return previous;
            return renumber(enforceGroupContinuity(previous.filter((channel) => channel.id !== channelId)));
        });
    }, []);

    /** 建立单向路由；同向重复会被忽略，A↔B 双向允许（真实反馈），更长的环路会被拒绝 */
    const addRoute = useCallback((from: string, to: string) => {
        if (from === to) return;
        setRoutes((previous) => {
            if (previous.some((route) => route.from === from && route.to === to)) return previous;
            // 从 to 的出口往下找，绕开「to → from」这条直连边：直连就是双向路由，允许；
            // 若还能绕回来，说明会形成三段以上的环，拒绝
            const stack = previous
                .filter((route) => route.from === to && route.to !== from)
                .map((route) => route.to);
            const visited = new Set<string>();
            while (stack.length) {
                const current = stack.pop()!;
                if (current === from) return previous;
                if (visited.has(current)) continue;
                visited.add(current);
                for (const route of previous) {
                    if (route.from === current) stack.push(route.to);
                }
            }
            return [...previous, {
                id: `${from}->${to}`,
                from,
                to,
            }];
        });
    }, []);

    /** 断开某条通道的全部出线 */
    const removeRoutesFrom = useCallback((from: string) => {
        setRoutes((previous) => previous.filter((route) => route.from !== from));
    }, []);

    /** 断开指定的一条连接 */
    const removeRoute = useCallback((from: string, to: string) => {
        setRoutes((previous) => previous.filter((route) => !(route.from === from && route.to === to)));
    }, []);

    // 目标通道被删掉时，回落到第一条通道
    useEffect(() => {
        if (channels.some((channel) => channel.id === activeChannelId)) return;
        setActiveChannelId(channels[0].id);
    }, [channels, activeChannelId]);

    // 通道被删掉时，挂在它上面的路由一起清掉；固定名单跟着收紧
    useEffect(() => {
        const ids = new Set(channelsRef.current.map((channel) => channel.id));
        setRoutes((previous) => {
            const next = previous.filter((route) => ids.has(route.from) && ids.has(route.to));
            return next.length === previous.length ? previous : next;
        });
        setPinnedIds((previous) => {
            const next = previous.filter((id) => ids.has(id));
            return next.length === previous.length ? previous : next;
        });
    }, [channelIds]);

    const addEffect = useCallback((channelId: string, effectType: EffectType) => {
        const effectId = `${effectType}_${++effectCounterRef.current}`;
        setChannels((previous) => previous.map((channel) => {
            if (channel.id !== channelId) return channel;
            return {
                ...channel,
                effects: [...channel.effects, {
                    id: effectId,
                    name: effectNames[effectType],
                    type: effectType,
                    enabled: true,
                    parameters: getDefaultEffectParameters(effectType),
                    order: channel.effects.length,
                    ...(effectType === 'eq' ? { eqBands: createDefaultEqBands() } : {}),
                    ...(effectType === 'distortion' ? { shaperPoints: createDefaultShaperPoints() } : {}),
                }],
            };
        }));
    }, []);

    /** 把若干效果器（连同调好的参数）按原顺序复制，插到目标通道链的第 index 位 */
    const insertEffectCopies = useCallback((channelId: string, sources: EffectConfig[], index: number) => {
        if (!sources.length) return;
        setChannels((previous) => previous.map((channel) => {
            if (channel.id !== channelId) return channel;
            const copies: EffectConfig[] = sources.map((source) => ({
                ...source,
                id: `${source.type}_${++effectCounterRef.current}`,
                parameters: { ...source.parameters },
                ...(source.eqBands ? { eqBands: source.eqBands.map((band) => ({ ...band })) } : {}),
                ...(source.shaperPoints ? { shaperPoints: source.shaperPoints.map((point) => ({ ...point })) } : {}),
            }));
            const effects = [...channel.effects];
            effects.splice(Math.max(0, Math.min(index, effects.length)), 0, ...copies);
            return { ...channel, effects: effects.map((effect, order) => ({ ...effect, order })) };
        }));
    }, []);

    const mapEffects = useCallback((channelId: string, transform: (effects: EffectConfig[]) => EffectConfig[]) => {
        setChannels((previous) => previous.map((channel) => (
            channel.id === channelId ? { ...channel, effects: transform(channel.effects) } : channel
        )));
    }, []);

    const removeEffects = useCallback((channelId: string, effectIds: string[]) => {
        mapEffects(channelId, (effects) => effects
            .filter((effect) => !effectIds.includes(effect.id))
            .map((effect, index) => ({ ...effect, order: index })));
    }, [mapEffects]);

    /** 开关效果器：多选时一次性把整组设成同一个状态，而不是各自取反 */
    const setEffectsEnabled = useCallback((channelId: string, effectIds: string[], enabled: boolean) => {
        mapEffects(channelId, (effects) => effects.map((effect) => (
            effectIds.includes(effect.id) ? { ...effect, enabled } : effect
        )));
    }, [mapEffects]);

    const updateEffect = useCallback((channelId: string, effectId: string, parameters: Record<string, number>) => {
        mapEffects(channelId, (effects) => effects.map((effect) => (
            effect.id === effectId ? { ...effect, parameters: { ...effect.parameters, ...parameters } } : effect
        )));
    }, [mapEffects]);

    const updateEffectEqBands = useCallback((channelId: string, effectId: string, bands: EqBandData[]) => {
        mapEffects(channelId, (effects) => effects.map((effect) => (
            effect.id === effectId ? { ...effect, eqBands: bands } : effect
        )));
    }, [mapEffects]);

    const updateEffectShaperPoints = useCallback((channelId: string, effectId: string, points: ShaperPoint[]) => {
        mapEffects(channelId, (effects) => effects.map((effect) => (
            effect.id === effectId ? { ...effect, shaperPoints: points } : effect
        )));
    }, [mapEffects]);

    const reorderEffects = useCallback((channelId: string, effects: EffectConfig[]) => {
        mapEffects(channelId, () => effects);
    }, [mapEffects]);

    const getAnalyser = useCallback((channelId: string) => analyzers[channelId] ?? null, [analyzers]);

    const exportMix = useCallback(async (filename?: string) => {
        const loaded = channelsRef.current.filter((channel) => buffersRef.current.has(channel.id));
        if (!loaded.length) return;

        const anySolo = loaded.some((channel) => channel.solo);
        const longest = loaded.reduce((max, channel) => {
            const buffer = buffersRef.current.get(channel.id)!;
            return Math.max(max, buffer.duration);
        }, 0);
        const tail = loaded.reduce((max, channel) => (
            channel.bypassed ? max : Math.max(max, getEffectsTailDuration(channel.effects))
        ), 0);

        const rendered = await Tone.Offline(async () => {
            const master = new Tone.Gain(1);
            master.toDestination();

            const built = new Map<string, { panner: Tone.Panner; processor: AudioEffectsProcessor }>();

            for (const channel of loaded) {
                const buffer = buffersRef.current.get(channel.id)!;
                const audible = !channel.muted && (!anySolo || channel.solo);
                if (!audible) continue;

                const player = new Tone.Player(buffer);
                const processor = new AudioEffectsProcessor();
                const gain = new Tone.Gain(1);
                const volume = new Tone.Volume(channel.volume <= 0 ? -Infinity : Tone.gainToDb(channel.volume));
                const clipper = new Tone.WaveShaper((value: number) => value, 8192);
                const panner = new Tone.Panner(channel.pan);

                player.connect(processor.getInput());
                processor.connect(gain);
                gain.connect(volume);
                volume.connect(clipper);
                clipper.connect(panner);
                processor.updateEffectsChain(channel.effects, channel.bypassed);
                player.start(0);
                built.set(channel.id, { panner, processor });
            }

            // 与实时图一致：有下游的通道接到下游效果器入口，没有下游的进母线
            for (const [channelId, node] of built) {
                const outgoing = routes.filter((route) => route.from === channelId);
                if (!outgoing.length) {
                    node.panner.connect(master);
                    continue;
                }
                for (const route of outgoing) {
                    const target = built.get(route.to);
                    if (target) node.panner.connect(target.processor.getInput());
                }
            }
        }, longest + tail);

        const renderedBuffer = rendered.get();
        if (!renderedBuffer) return;

        const customName = filename?.trim();
        const outputName = customName
            ? (/\.wav$/i.test(customName) ? customName : `${customName}.wav`)
            : `mixdown_${Date.now()}.wav`;
        exportWAV(renderedBuffer, outputName);
    }, [routes]);

    return {
        channels,
        routes,
        isPlaying,
        loop,
        currentTime,
        duration,
        hasAudio: channels.some((channel) => channel.duration > 0),
        play,
        pause,
        stop,
        toggleLoop,
        beginSeek,
        previewSeek,
        seek,
        updateChannel,
        updateChannels,
        loadChannelAudio,
        clearChannel,
        addChannel,
        moveChannels,
        removeChannel,
        resetChannelLabel,
        setChannelColor,
        groupChannels,
        joinGroup,
        ungroupChannels,
        renameGroup,
        groups,
        pinnedIds,
        togglePin,
        addRoute,
        removeRoutesFrom,
        removeRoute,
        addEffect,
        insertEffectCopies,
        removeEffects,
        setEffectsEnabled,
        updateEffect,
        updateEffectEqBands,
        updateEffectShaperPoints,
        reorderEffects,
        getAnalyser,
        exportMix,
        activeChannelId,
        setActiveChannelId,
    };
};

export type MixerApi = ReturnType<typeof useMixer>;
