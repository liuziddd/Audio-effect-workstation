/**
 * 风格画像与曲目库。
 *
 * 和声不再是「六个骨架模板随机拼」：每种风格收录自己真实的进行（`idioms`），
 * 每个进行按「一小节一个和弦」写成罗马数字，质量和扩展音写进记号里
 * （`IVmaj7`、`V7`、`iii7`、`iiø7`、`bVII7`…），由 composer.ts 解析成和弦。
 *
 * 收进来的都是各自语汇里站得住的东西：
 * - 流行：四和弦轴心、50 年代进行、Axis、1625；
 * - 日系：王道进行（IVmaj7–V7–iii7–vi7，4536）、小室进行（vi–IV–V–I，6451）、卡农句；
 * - 爵士：ii–V–I、回转、节奏变化 A 段、后门 ii–V、三全音替代；
 * - 摇滚：混合利底亚 I–bVII–IV、小调 i–bVI–bIII–bVII、安达卢西亚终止；
 * - 蓝调：12 小节曲式（含 quick change）；
 * - R&B / Neo Soul：七和弦 ii–V–I 循环、下行四度、bVI 中音关系；
 * - 电影感：小调史诗 i–bVI–bIII–bVII 与 i–bVII–bVI–V。
 *
 * 音型库只描述节奏与走向，不含和弦。
 */

export type Mode = 'major' | 'minor';
export type MoodId = 'bright' | 'warm' | 'sad' | 'tense';
export type StyleId = 'pop' | 'rock' | 'ballad' | 'hiphop' | 'rnb' | 'neosoul' | 'jazz' | 'anime' | 'blues' | 'cinematic';
/** 声部排列：close 密集 / upper 无根音上层 / drop2 降二声部 / power 强力和弦 */
export type VoicingKind = 'close' | 'upper' | 'drop2' | 'power';
/** 织体：arp 分解 / riff 固定音型 / line 副线 */
export type TextureId = 'arp' | 'riff' | 'line';

export interface Idiom {
    /** 进行在乐理里的叫法，导出与悬停时显示 */
    name: string;
    /** 大调写法：每项一小节，罗马数字 + 后缀决定质量与扩展音 */
    major?: string[];
    minor?: string[];
}

export interface StyleConfig {
    label: string;
    voicing: VoicingKind;
    /** 低音落点（MIDI），用来定整首歌的音域 */
    bass: number;
    /** 上层和声跨度（半音）：15 大约一个八度出头，24 是两个八度 */
    spread: number[];
    /* ===== 和弦色彩：每张卡统一掷一次 ===== */
    seventh: number;
    ninth: number;
    sus: number;
    /** 属七和弦上再叠变化九音（b9 / #9）的倾向，由情绪另行加权 */
    alt: number;
    /* ===== 和声写作倾向 ===== */
    /** 副属和弦（V7/x）出现的倾向 */
    secondary: number;
    /** 借用同名大小调（iv / bVI / bVII / bIII）的倾向 */
    mixture: number;
    /** 三全音替代（用 bII7 顶替 V7）的倾向 */
    tritone: number;
    /** 转位倾向：低音不一定踩根音，让低音线走起来 */
    inversion: number;
    /** 乐句长度候选（小节）；进行本身多长就用多长，这里只决定 4 小节进行要不要铺成 8 小节 */
    phrases: number[];
    /** 这个风格常用的进行 */
    idioms: Idiom[];
    /* ===== 织体音型库：只是节奏与行进方式，不含和弦 ===== */
    arp: number[][];
    arpStep: number;
    riff: number[][];
    line: number[][];
}

export const STYLES: Record<StyleId, StyleConfig> = {
    pop: {
        label: '流行',
        voicing: 'close',
        bass: 43,
        spread: [15, 19, 24],
        seventh: 0.22,
        ninth: 0.1,
        sus: 0.14,
        alt: 0.04,
        secondary: 0.26,
        mixture: 0.3,
        tritone: 0,
        inversion: 0.3,
        phrases: [4, 8],
        idioms: [
            { name: '四和弦轴心', major: ['I', 'V', 'vi', 'IV'], minor: ['i', 'VI', 'III', 'VII'] },
            { name: '50 年代进行', major: ['I', 'vi', 'IV', 'V'], minor: ['i', 'VI', 'iv', 'V'] },
            { name: 'Axis 进行', major: ['vi', 'IV', 'I', 'V'], minor: ['i', 'VII', 'VI', 'VII'] },
            { name: '1625 回转', major: ['I', 'vi', 'ii7', 'V7'], minor: ['i', 'VI', 'iiø7', 'V7'] },
            { name: '主—三级—下属', major: ['I', 'iii', 'IV', 'V'], minor: ['i', 'III', 'iv', 'V'] },
            { name: '上行四度', major: ['I', 'IV', 'vi', 'V'], minor: ['i', 'iv', 'VII', 'III'] },
            { name: '旋转三和弦', major: ['IV', 'I', 'V', 'vi'], minor: ['VI', 'III', 'VII', 'i'] },
            { name: '双属收束', major: ['I', 'V', 'IV', 'V'], minor: ['i', 'VII', 'iv', 'V'] },
            { name: '平行动机', major: ['I', 'IV', 'I', 'V'], minor: ['i', 'iv', 'i', 'V'] },
            { name: '小调下行', major: ['vi', 'ii', 'V', 'I'], minor: ['i', 'VII', 'VI', 'V'] },
        ],
        arp: [[0, 1, 2, 3, 2, 1], [0, 2, 1, 3], [0, 1, 2, 3]],
        arpStep: 0.5,
        riff: [[0, 2, 4, 6, 8, 10, 12, 14], [0, 2, 4, 6, 8, 11, 12, 14]],
        line: [[0, 4, 8, 12], [0, 6, 8, 14]],
    },
    rock: {
        label: '摇滚',
        voicing: 'power',
        bass: 40,
        spread: [12, 15, 19],
        seventh: 0.05,
        ninth: 0,
        sus: 0.08,
        alt: 0,
        secondary: 0.18,
        mixture: 0.42,
        tritone: 0,
        inversion: 0.1,
        phrases: [4, 8],
        idioms: [
            // 混合利底亚：bVII 是摇滚的骨架音
            { name: '混合利底亚', major: ['I', 'bVII', 'IV', 'I'], minor: ['i', 'VII', 'VI', 'V7'] },
            { name: '强拍循环', major: ['I', 'IV', 'V', 'IV'], minor: ['i', 'iv', 'VII', 'III'] },
            { name: '三和弦轴心', major: ['I', 'V', 'vi', 'IV'], minor: ['i', 'VI', 'III', 'VII'] },
            { name: 'bIII 借用', major: ['I', 'bIII', 'bVII', 'IV'], minor: ['i', 'III', 'VII', 'IV'] },
            { name: '安达卢西亚', major: ['vi', 'V', 'IV', 'III'], minor: ['i', 'VII', 'VI', 'V7'] },
            { name: '双和弦推进', major: ['I', 'IV', 'I', 'V'], minor: ['i', 'VI', 'VII', 'i'] },
            { name: '低音下行', major: ['I', 'V', 'bVII', 'IV'], minor: ['i', 'VII', 'VI', 'VII'] },
        ],
        arp: [[0, 1, 2, 1], [0, 2, 1, 2]],
        arpStep: 0.5,
        riff: [[0, 2, 4, 6, 8, 10, 12, 14], [0, 1, 2, 4, 6, 8, 10, 12]],
        line: [[0, 4, 8, 12], [0, 7, 8, 14]],
    },
    ballad: {
        label: '抒情',
        voicing: 'upper',
        bass: 43,
        spread: [19, 24],
        seventh: 0.5,
        ninth: 0.18,
        sus: 0.18,
        alt: 0.05,
        secondary: 0.28,
        mixture: 0.24,
        tritone: 0,
        inversion: 0.38,
        phrases: [8],
        idioms: [
            // 卡农句：低音一路级进下行
            { name: '卡农进行', major: ['I', 'V', 'vi', 'iii', 'IV', 'I', 'IV', 'V'], minor: ['i', 'VII', 'VI', 'III', 'iv', 'i', 'iv', 'V7'] },
            { name: '卡农收束', major: ['I', 'V', 'vi', 'iii', 'IV', 'I', 'ii7', 'V7'], minor: ['i', 'VII', 'VI', 'III', 'iv', 'i', 'iiø7', 'V7'] },
            { name: '抒情四和弦', major: ['I', 'vi', 'IV', 'V'], minor: ['i', 'VI', 'III', 'VII'] },
            { name: '主—三级—六级', major: ['I', 'iii', 'vi', 'IV'], minor: ['i', 'III', 'VI', 'iv'] },
            { name: '下行四度', major: ['IV', 'iii', 'ii7', 'I'], minor: ['VI', 'V', 'iv', 'i'] },
            { name: '小调抒情', major: ['vi', 'IV', 'I', 'V'], minor: ['i', 'iv', 'V', 'i'] },
        ],
        arp: [[0, 1, 2, 3], [0, 1, 2, 3, 2, 1], [0, 2, 1, 3, 2, 3]],
        arpStep: 0.5,
        riff: [[0, 4, 8, 12], [0, 3, 8, 11]],
        line: [[0, 6, 8, 14], [0, 8, 12]],
    },
    anime: {
        label: '日系',
        voicing: 'close',
        bass: 43,
        spread: [15, 19, 24],
        seventh: 0.55,
        ninth: 0.2,
        sus: 0.1,
        alt: 0.06,
        secondary: 0.3,
        mixture: 0.34,
        tritone: 0,
        inversion: 0.3,
        phrases: [4, 8],
        idioms: [
            // 王道进行 4536：V 不落回 I，而是滑到 iii
            { name: '王道进行 4536', major: ['IVmaj7', 'V7', 'iii7', 'vi7'] },
            { name: '王道收束', major: ['IVmaj7', 'V7', 'I', 'vi'] },
            // 王道进行接 ii–V–I，一条完整的下行五度圈
            { name: '王道接 251', major: ['IVmaj7', 'V7', 'iii7', 'vi7', 'ii7', 'V7', 'I'] },
            // 小室进行 6451
            { name: '小室进行 6451', major: ['vi', 'IV', 'V', 'I'], minor: ['i', 'VI', 'VII', 'III'] },
            { name: '6453 悬置', major: ['vi', 'IV', 'V', 'iii'], minor: ['i', 'VI', 'VII', 'v'] },
            { name: '卡农句', major: ['I', 'V', 'vi', 'iii', 'IV', 'I', 'IV', 'V'] },
            { name: '副歌上行', major: ['IV', 'V', 'I', 'vi'], minor: ['VI', 'VII', 'III', 'i'] },
            { name: '日系小调', major: ['vi', 'IV', 'V', 'I'], minor: ['i', 'iv', 'VI', 'V7'] },
        ],
        arp: [[0, 1, 2, 3, 2, 1], [0, 2, 3, 2, 1, 2]],
        arpStep: 0.25,
        riff: [[0, 2, 4, 6, 8, 10, 12, 14], [0, 2, 3, 4, 6, 8, 10, 12, 14]],
        line: [[0, 4, 6, 8, 12], [0, 2, 6, 8, 12, 14]],
    },
    jazz: {
        label: '爵士',
        voicing: 'drop2',
        bass: 40,
        spread: [19, 24],
        seventh: 1,
        ninth: 0.5,
        sus: 0.08,
        alt: 0.22,
        secondary: 0.55,
        mixture: 0.18,
        tritone: 0.28,
        inversion: 0.5,
        phrases: [4, 8],
        idioms: [
            { name: '回转 1625', major: ['Imaj7', 'vi7', 'ii7', 'V7'], minor: ['im7', 'VI7', 'iiø7', 'V7'] },
            { name: '三段五度圈', major: ['iii7', 'vi7', 'ii7', 'V7'], minor: ['im7', 'iv7', 'iiø7', 'V7'] },
            { name: '节奏变化 A 段', major: ['Imaj7', 'vi7', 'ii7', 'V7', 'iii7', 'VI7', 'ii7', 'V7'], minor: ['im7', 'VI7', 'iiø7', 'V7', 'im7', 'iv7', 'iiø7', 'V7'] },
            { name: 'ii–V–I', major: ['ii7', 'V7', 'Imaj7', 'vi7'], minor: ['iiø7', 'V7', 'im7', 'iv7'] },
            { name: '后门 ii–V', major: ['iv7', 'bVII7', 'Imaj7', 'vi7'], minor: ['iv7', 'VII7', 'im7', 'iv7'] },
            { name: '三全音替代', major: ['ii7', 'bII7', 'Imaj7', 'vi7'], minor: ['iiø7', 'bII7', 'im7', 'VI7'] },
            { name: '副属链', major: ['Imaj7', 'VI7', 'II7', 'V7'], minor: ['im7', 'VI7', 'II7', 'V7'] },
            { name: '思念终止', major: ['IVmaj7', 'iv7', 'Imaj7', 'V7'], minor: ['iv7', 'VII7', 'im7', 'V7'] },
        ],
        arp: [[0, 1, 2, 3], [0, 2, 3, 1]],
        arpStep: 0.5,
        riff: [[0, 3, 4, 6, 8, 11, 13], [0, 2, 4, 6, 8, 10, 12, 15]],
        line: [[0, 3, 6, 10, 13], [0, 4, 6, 10, 12]],
    },
    rnb: {
        label: 'R&B',
        voicing: 'upper',
        bass: 40,
        spread: [19, 24],
        seventh: 0.85,
        ninth: 0.4,
        sus: 0.15,
        alt: 0.12,
        secondary: 0.4,
        mixture: 0.3,
        tritone: 0.1,
        inversion: 0.42,
        phrases: [4, 8],
        idioms: [
            { name: '回转 1625', major: ['Imaj7', 'vi7', 'ii7', 'V7'], minor: ['im7', 'VImaj7', 'iiø7', 'V7'] },
            { name: '五度圈下行', major: ['ii7', 'V7', 'Imaj7', 'vi7'], minor: ['iiø7', 'V7', 'im7', 'iv7'] },
            { name: '三级上行', major: ['Imaj7', 'iii7', 'vi7', 'IVmaj7'], minor: ['im7', 'IIImaj7', 'VImaj7', 'iv7'] },
            { name: '下行四度', major: ['IVmaj7', 'iii7', 'ii7', 'Imaj7'], minor: ['iv7', 'IIImaj7', 'iiø7', 'im7'] },
            { name: '小调起手', major: ['vi7', 'ii7', 'V7', 'Imaj7'], minor: ['im7', 'iv7', 'VII7', 'IIImaj7'] },
            { name: '中音关系', major: ['Imaj7', 'bVImaj7', 'IVmaj7', 'Imaj7'], minor: ['im7', 'VImaj7', 'IIImaj7', 'im7'] },
        ],
        arp: [[0, 1, 2, 3, 2, 1], [0, 2, 3, 1, 0, 3]],
        arpStep: 0.25,
        riff: [[0, 3, 4, 7, 8, 11, 12, 15], [0, 2, 4, 7, 9, 12, 14]],
        line: [[0, 3, 6, 10, 12], [0, 4, 7, 12]],
    },
    neosoul: {
        label: 'Neo Soul',
        voicing: 'upper',
        bass: 40,
        spread: [19, 24],
        seventh: 0.95,
        ninth: 0.65,
        sus: 0.2,
        alt: 0.18,
        secondary: 0.45,
        mixture: 0.42,
        tritone: 0.16,
        inversion: 0.5,
        phrases: [4, 8],
        idioms: [
            { name: '后门 ii–V', major: ['iv7', 'bVII7', 'Imaj7', 'iii7'], minor: ['iv7', 'VII7', 'im7', 'IIImaj7'] },
            { name: '下行四度', major: ['IVmaj7', 'iii7', 'ii7', 'Imaj7'], minor: ['iv7', 'IIImaj7', 'iiø7', 'im7'] },
            { name: '三级上行', major: ['Imaj7', 'iii7', 'vi7', 'ii7'], minor: ['im7', 'IIImaj7', 'VImaj7', 'VII7'] },
            { name: '中音关系', major: ['Imaj7', 'bVImaj7', 'IVmaj7', 'iii7'], minor: ['im7', 'VImaj7', 'iv7', 'im7'] },
            { name: '回转', major: ['vi7', 'ii7', 'V7', 'Imaj7'], minor: ['im7', 'VI7', 'iiø7', 'V7'] },
        ],
        arp: [[0, 1, 2, 3, 2, 1, 2, 3], [0, 3, 1, 2]],
        arpStep: 0.25,
        riff: [[0, 1, 3, 4, 6, 7, 10, 11, 14], [0, 2, 3, 6, 8, 10, 11, 14]],
        line: [[0, 2, 5, 8, 11, 14], [0, 3, 6, 9, 12, 15]],
    },
    hiphop: {
        label: '说唱',
        voicing: 'close',
        bass: 40,
        spread: [15, 19],
        seventh: 0.4,
        ninth: 0.2,
        sus: 0.1,
        alt: 0.06,
        secondary: 0.18,
        mixture: 0.35,
        tritone: 0.05,
        inversion: 0.2,
        phrases: [4, 8],
        idioms: [
            { name: '小调循环', major: ['vi', 'IV', 'I', 'V'], minor: ['i', 'VI', 'III', 'VII'] },
            { name: '小调下行', major: ['I', 'vi', 'ii', 'V'], minor: ['i', 'iv', 'VII', 'III'] },
            { name: '混合利底亚', major: ['I', 'bVII', 'IV', 'I'], minor: ['i', 'VI', 'VII', 'i'] },
            { name: '说唱四和弦', major: ['I', 'IV', 'vi', 'V'], minor: ['i', 'VII', 'VI', 'v'] },
            { name: '七和弦循环', major: ['Imaj7', 'iii7', 'vi7', 'ii7'], minor: ['im7', 'iv7', 'VIImaj7', 'IIImaj7'] },
        ],
        arp: [[0, 2, 3, 2], [0, 1, 3, 1]],
        arpStep: 0.25,
        riff: [[0, 3, 6, 8, 11, 14], [0, 2, 6, 8, 10, 14]],
        line: [[0, 4, 8, 12], [0, 3, 8, 11]],
    },
    blues: {
        label: '蓝调',
        voicing: 'close',
        bass: 40,
        spread: [15, 19],
        seventh: 1,
        ninth: 0.15,
        sus: 0.05,
        alt: 0.1,
        secondary: 0.12,
        mixture: 0.08,
        tritone: 0.08,
        inversion: 0.2,
        phrases: [12],
        idioms: [
            // 12 小节曲式，第九小节走 V–IV–I–V 的转身
            {
                name: '12 小节蓝调',
                major: ['I7', 'I7', 'I7', 'I7', 'IV7', 'IV7', 'I7', 'I7', 'V7', 'IV7', 'I7', 'V7'],
                minor: ['i7', 'i7', 'i7', 'i7', 'iv7', 'iv7', 'i7', 'i7', 'VI7', 'V7', 'i7', 'V7'],
            },
            {
                name: '12 小节蓝调 · quick change',
                major: ['I7', 'IV7', 'I7', 'I7', 'IV7', 'IV7', 'I7', 'I7', 'V7', 'IV7', 'I7', 'V7'],
                minor: ['i7', 'iv7', 'i7', 'i7', 'iv7', 'iv7', 'i7', 'i7', 'VI7', 'V7', 'i7', 'V7'],
            },
            // 转身换成 V7/ii：最后一个和弦直接牵回下一遍的 ii
            {
                name: '12 小节蓝调 · 上行转身',
                major: ['I7', 'I7', 'I7', 'I7', 'IV7', 'IV7', 'I7', 'I7', 'V7', 'IV7', 'I7', 'VI7'],
                minor: ['i7', 'i7', 'i7', 'i7', 'iv7', 'iv7', 'i7', 'i7', 'VI7', 'V7', 'i7', 'VII7'],
            },
            // 不收转身，停在 I 上收尾（慢板蓝调常用）
            {
                name: '12 小节蓝调 · 收在主音',
                major: ['I7', 'I7', 'I7', 'I7', 'IV7', 'IV7', 'I7', 'I7', 'V7', 'IV7', 'I7', 'I7'],
                minor: ['i7', 'i7', 'i7', 'i7', 'iv7', 'iv7', 'i7', 'i7', 'VI7', 'V7', 'i7', 'i7'],
            },
        ],
        arp: [[0, 1, 2, 1], [0, 2, 1, 2]],
        arpStep: 0.5,
        riff: [[0, 3, 4, 7, 8, 11, 12, 15], [0, 2, 4, 6, 8, 10, 12, 15]],
        line: [[0, 3, 6, 8, 11, 14], [0, 4, 8, 11, 14]],
    },
    cinematic: {
        label: '电影感',
        voicing: 'close',
        bass: 36,
        spread: [19, 24],
        seventh: 0.45,
        ninth: 0.22,
        sus: 0.3,
        alt: 0.05,
        secondary: 0.18,
        mixture: 0.5,
        tritone: 0.05,
        inversion: 0.25,
        phrases: [4, 8],
        idioms: [
            { name: '小调史诗', major: ['I', 'bVI', 'bVII', 'I'], minor: ['i', 'VI', 'III', 'VII'] },
            { name: '安达卢西亚', major: ['vi', 'bVII', 'bVI', 'V7'], minor: ['i', 'VII', 'VI', 'V7'] },
            { name: '铺底四和弦', major: ['I', 'V', 'vi', 'IV'], minor: ['i', 'VI', 'III', 'VII'] },
            { name: '小调终止', major: ['IV', 'iii', 'ii7', 'V7'], minor: ['i', 'iv', 'VI', 'V7'] },
            { name: '中音关系', major: ['I', 'bVImaj7', 'IV', 'I'], minor: ['i', 'VImaj7', 'iv', 'i'] },
        ],
        arp: [[0, 1, 2, 3], [0, 3, 1, 2]],
        arpStep: 0.5,
        riff: [[0, 6, 8, 14], [0, 4, 8, 12]],
        line: [[0, 8], [0, 6, 12]],
    },
};

export const MOODS: Record<MoodId, { label: string; register: number; seventh: number; ninth: number; sus: number; alt: number }> = {
    bright: { label: '明亮', register: 2, seventh: -0.15, ninth: 0.05, sus: -0.05, alt: 0 },
    warm: { label: '温暖', register: 0, seventh: 0.1, ninth: 0.05, sus: 0.05, alt: 0.05 },
    sad: { label: '忧郁', register: -2, seventh: 0.1, ninth: -0.05, sus: 0.12, alt: 0 },
    tense: { label: '紧张', register: 1, seventh: 0.05, ninth: 0.05, sus: 0.1, alt: 0.35 },
};

export const KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export const TEXTURES: Record<TextureId, string> = {
    arp: '分解',
    riff: '音型',
    line: '副线',
};
