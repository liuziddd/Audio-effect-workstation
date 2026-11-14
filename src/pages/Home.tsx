import { useEffect, useRef, useState } from 'react';
import { motion, easeInOut, useMotionValueEvent, useScroll, useSpring, useTransform } from 'framer-motion';
import { Activity, ArrowUpRight, BookOpen, Coffee, Download, Github, Layers, Mic2, Music2, SlidersHorizontal, Sparkles } from 'lucide-react';

type FeatureTool = 'inspector' | 'separator' | 'master';
type Origin = { x: number; y: number };

interface HomeProps {
    onStart: (origin: Origin) => void;
    onFeature: (origin: Origin, tool?: FeatureTool) => void;
}

interface Feature {
    title: string;
    tag: string;
    desc: string;
    color: string;
    icon: React.ReactNode;
    tool?: FeatureTool;
}

/** 联系方式与站点：右上角只放项目仓库，其余入口收在个人信息卡里 */
const CONTACT = {
    repo: 'https://github.com/liuziddd/Audio-effect-workstation',
    github: 'https://github.com/liuziddd',
    beats: 'https://liuyx.my.canvasite.cn/beat',
    blog: 'https://www.lyxblog.click',
};

/** 圆形图标按钮：右上角与个人信息卡共用一套外观 */
const ICON_BTN =
    'flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/70 backdrop-blur-md transition-colors duration-200 hover:border-neon-blue hover:bg-neon-blue/15 hover:text-neon-blue';

const WechatIcon = () => (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
        <path d="M8.69 4C4.99 4 2 6.58 2 9.76c0 1.83 1 3.45 2.56 4.5l-.64 1.92 2.22-1.11c.5.14 1.02.22 1.55.22.2 0 .4-.01.6-.03-.14-.42-.21-.86-.21-1.32 0-3.18 3.02-5.76 6.75-5.76.25 0 .49.01.73.03C15.06 5.61 12.14 4 8.69 4zM6.6 7.1c.42 0 .76.34.76.76s-.34.76-.76.76-.76-.34-.76-.76.34-.76.76-.76zm4.18 0c.42 0 .76.34.76.76s-.34.76-.76.76-.76-.34-.76-.76.34-.76.76-.76z" />
        <path d="M22 14.24c0-2.66-2.6-4.82-5.81-4.82s-5.81 2.16-5.81 4.82 2.6 4.82 5.81 4.82c.5 0 .99-.06 1.45-.17l1.95.98-.56-1.68c1.55-.99 2.97-2.35 2.97-3.95zm-7.61-.74c.34 0 .61.27.61.61s-.27.61-.61.61-.61-.27-.61-.61.27-.61.61-.61zm3.59 0c.34 0 .61.27.61.61s-.27.61-.61.61-.61-.27-.61-.61.27-.61.61-.61z" />
    </svg>
);

/** 微信：不复制号码，悬停 / 聚焦弹出好友二维码 */
const WechatQr = () => (
    <span className="group relative inline-flex">
        <button type="button" className={ICON_BTN} aria-label="微信二维码">
            <WechatIcon />
        </button>
        <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-3 w-[176px] -translate-x-1/2 rounded-2xl border border-white/15 bg-[#0b0e13]/95 p-3 opacity-0 shadow-[0_20px_50px_rgba(0,0,0,0.6)] backdrop-blur-xl transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
            <img src="/MyWechat.png" alt="微信二维码" className="w-full rounded-lg bg-white" />
            <span className="mt-2 block text-center text-[11px] text-white/50">扫码加我微信</span>
        </span>
    </span>
);

/** 打赏：右侧收款码 */
const RewardCard = () => (
    <div className="mx-auto flex w-[204px] flex-col items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 md:mx-0">
        <p className="flex items-center gap-1.5 text-[11px] tracking-[0.16em] text-white/40">
            <Coffee className="h-3.5 w-3.5" />
            微信打赏
        </p>
        <img src="/WechatReward.png" alt="微信打赏二维码" className="w-[136px] rounded-xl bg-white p-1.5" />
        <p className="text-center text-[11px] leading-relaxed text-white/35">如果它有帮到你，欢迎投喂辣条🥳</p>
    </div>
);

/* ===== 滚动相位（progress 0 → 1）=====
   标题移到左上并缩小 → 第一波文字介绍 → 第二波第一行卡片 → 第三波第二行卡片 → 路标浮现；
   走完轨道后离开钉住状态，个人信息作为普通段落接在下面 */
const TITLE_IN: [number, number] = [0.03, 0.26];
const TEXT_IN: [number, number] = [0.28, 0.42];
const ROW1_IN: [number, number] = [0.46, 0.6];
const ROW2_IN: [number, number] = [0.62, 0.76];
const CUE_IN: [number, number] = [0.8, 0.88];

/** 标题停靠位置：与容器 px-6 的内容边界、顶部留白对齐（px） */
const DOCK_X = 24;
const DOCK_Y = 96;
/** 停靠后约为 128 × 0.38 ≈ 49px，与原稿的四字标题停靠尺寸一致 */
const DOCK_SCALE = 0.38;
/** 副标题停靠在标题正下方，留出的小间距（px） */
const TAGLINE_GAP = 6;
/** 副标题停靠后缩到原尺寸的 78%：和缩小后的标题比例才对 */
const TAGLINE_SCALE = 0.78;
/** 主按钮停靠在舞台底边、路标上方 */
const CTA_BOTTOM = 92;

/** 滚动层卡片的定高：矮屏按可用高度反算，保证两行卡 + 底边按钮 + 路标都不撞 */
const CARD_HEIGHT = 'clamp(96px, calc((100vh - 542px) / 2), 176px)';

/* ===== 大字逐字模糊揭示 ===== */
const BlurReveal = ({ text }: { text: string }) => (
    <span aria-label={text}>
        {text.split('').map((char, i) => (
            <motion.span
                key={i}
                className="inline-block bg-gradient-to-b from-white via-[#B8C4D8] to-neon-purple bg-clip-text text-transparent"
                initial={{ opacity: 0, y: 30, filter: 'blur(14px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                transition={{ delay: 0.35 + i * 0.07, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            >
                {char}
            </motion.span>
        ))}
    </span>
);

/* ===== 磁吸按钮 ===== */
const MagneticButton = ({ onClick, children }: { onClick: (origin: Origin) => void; children: React.ReactNode }) => {
    const ref = useRef<HTMLButtonElement>(null);
    const [offset, setOffset] = useState({ x: 0, y: 0 });

    const handleMove = (e: React.MouseEvent) => {
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return;
        setOffset({ x: (e.clientX - rect.left - rect.width / 2) * 0.35, y: (e.clientY - rect.top - rect.height / 2) * 0.35 });
    };

    return (
        <motion.button
            ref={ref}
            onMouseMove={handleMove}
            onMouseLeave={() => setOffset({ x: 0, y: 0 })}
            onClick={(e) => onClick({ x: e.clientX, y: e.clientY })}
            animate={{ x: offset.x, y: offset.y }}
            transition={{ type: 'spring', stiffness: 180, damping: 14 }}
            className="group relative px-12 py-4 rounded-full font-bold text-lg overflow-hidden shadow-[0_0_40px_rgba(36,80,255,0.4)]"
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.96 }}
        >
            <motion.span
                className="absolute inset-0"
                style={{
                    background: 'linear-gradient(90deg, #2450FF, #7B9CFF, #5B7BFF, #2450FF)',
                    backgroundSize: '300% 100%',
                }}
                animate={{ backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }}
                transition={{ duration: 5, repeat: Infinity, ease: 'linear' }}
            />
            <span className="relative z-10 tracking-wide" style={{ color: '#ffffff' }}>{children}</span>
            <span className="absolute inset-0 -translate-x-full group-hover:translate-x-0 transition-transform duration-700 bg-gradient-to-r from-transparent via-white/30 to-transparent" />
        </motion.button>
    );
};

/* ===== 功能卡片 ===== */
const FEATURES: Feature[] = [
    {
        title: '多通道混音台',
        tag: 'MIXER',
        desc: '八条通道起步、可随时增加。每条通道独立控制音量、声像与静音独奏，波形随播放实时滚动。',
        color: '#2450FF',
        icon: <SlidersHorizontal className="w-5 h-5" />,
    },
    {
        title: '实时效果器链',
        tag: 'EFFECTS',
        desc: '每条通道可挂 10 种效果器，点击通道条即可展开，拖拽调整顺序，均衡与失真都带可视化曲线。',
        color: '#5B7BFF',
        icon: <Layers className="w-5 h-5" />,
    },
    {
        title: 'AI 音轨分离',
        tag: 'STEMS',
        desc: '把人声、鼓、贝斯与其他声部拆成独立音轨，模型在本地运行，音频不出浏览器。',
        color: '#7B9CFF',
        icon: <Mic2 className="w-5 h-5" />,
        tool: 'separator',
    },
    {
        title: 'AI 自动母带',
        tag: 'MASTERING',
        desc: '通篇分析作品后生成母带处理链，统一响度与动态，导出前先听到成品的样子。',
        color: '#A6FF00',
        icon: <Sparkles className="w-5 h-5" />,
        tool: 'master',
    },
    {
        title: '音频检测',
        tag: 'ANALYSIS',
        desc: '频谱、响度、动态范围与调性一次看清，给每一个混音决定一个客观依据。',
        color: '#FFC53D',
        icon: <Activity className="w-5 h-5" />,
        tool: 'inspector',
    },
    {
        title: '离线渲染导出',
        tag: 'EXPORT',
        desc: '整台混音连同全部效果器离线渲染成 16-bit WAV，不经过实时播放链路。',
        color: '#FF3B30',
        icon: <Download className="w-5 h-5" />,
    },
];

const CARD_SHELL =
    'group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] backdrop-blur-md text-left transition-colors duration-300 hover:border-white/25';

/** 卡片外观（滚动层与静态层共用） */
const FeatureCardInner = ({ feature, spacious }: { feature: Feature; spacious?: boolean }) => {
    const ref = useRef<HTMLDivElement>(null);

    const handleMove = (event: React.MouseEvent) => {
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return;
        ref.current?.style.setProperty('--mx', `${event.clientX - rect.left}px`);
        ref.current?.style.setProperty('--my', `${event.clientY - rect.top}px`);
    };

    return (
        <div ref={ref} onMouseMove={handleMove} className={`relative flex h-full flex-col ${spacious ? 'p-6' : 'p-4'}`}>
            {/* 跟随指针的高光 */}
            <span
                className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{ background: `radial-gradient(${spacious ? 340 : 260}px circle at var(--mx, 50%) var(--my, 50%), ${feature.color}26, transparent 68%)` }}
            />
            {/* 顶部细光带 */}
            <span
                className="pointer-events-none absolute inset-x-5 top-0 h-px opacity-40 group-hover:opacity-90 transition-opacity duration-300"
                style={{ background: `linear-gradient(90deg, transparent, ${feature.color}, transparent)` }}
            />

            <div className="relative flex items-center justify-between">
                <div
                    className={`${spacious ? 'w-11 h-11' : 'w-9 h-9'} rounded-xl flex items-center justify-center flex-shrink-0`}
                    style={{
                        background: `linear-gradient(135deg, ${feature.color}30, ${feature.color}0a)`,
                        border: `1px solid ${feature.color}44`,
                        color: feature.color,
                        boxShadow: `0 8px 24px ${feature.color}22`,
                    }}
                >
                    {feature.icon}
                </div>
                <span className="text-[10px] font-semibold tracking-[0.18em] text-white/25 group-hover:text-white/45 transition-colors duration-300">
                    {feature.tag}
                </span>
            </div>

            <div className="relative mt-auto pt-5">
                <h3 className={`text-white font-bold ${spacious ? 'text-lg mb-2' : 'text-base mb-1.5'}`}>{feature.title}</h3>
                <p
                    className={`text-white/40 group-hover:text-white/60 transition-colors duration-300 ${
                        spacious ? 'text-sm leading-relaxed' : 'text-[12.5px] leading-[1.7] line-clamp-3'
                    }`}
                >
                    {feature.desc}
                </p>
            </div>

            <ArrowUpRight
                className="absolute bottom-4 right-4 w-3.5 h-3.5 opacity-0 group-hover:opacity-70 transition-opacity duration-300"
                style={{ color: feature.color }}
            />
        </div>
    );
};

/** 一行三张卡：整行一起动，不拆成单张错峰 */
const FeatureRow = ({ features, onClick }: { features: Feature[]; onClick: (origin: Origin, tool?: FeatureTool) => void }) => (
    <div className="grid grid-cols-3 gap-3">
        {features.map((feature) => (
            <button
                key={feature.title}
                onClick={(event) => onClick({ x: event.clientX, y: event.clientY }, feature.tool)}
                className={CARD_SHELL}
                style={{ height: CARD_HEIGHT }}
            >
                <FeatureCardInner feature={feature} />
            </button>
        ))}
    </div>
);

/** 静态层（窄屏）里的单张卡片 */
const StaticFeatureCard = ({
    feature,
    index,
    onClick,
}: {
    feature: Feature;
    index: number;
    onClick: (origin: Origin) => void;
}) => (
    <motion.button
        initial={{ opacity: 0, y: 28 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.6, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
        whileHover={{ y: -4 }}
        whileTap={{ scale: 0.99 }}
        onClick={(event) => onClick({ x: event.clientX, y: event.clientY })}
        className={CARD_SHELL}
    >
        <FeatureCardInner feature={feature} spacious />
    </motion.button>
);

/* ===== 简介文字（第一波内容，静态层复用） ===== */
const IntroText = () => (
    <>
        <p className="text-neon-blue text-[11px] font-semibold tracking-[0.3em]">WORKSTATION</p>
        <h2 className="mt-2 text-[26px] font-bold leading-tight">六个入口，同一间棚</h2>
        <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-white/45">
            拖进一段音频，它就坐上第八条通道——混音、效果器、分轨、母带、检测，全在这张桌子上完成。
        </p>
    </>
);

/* ===== 个人信息 ===== */

const ProfileCard = ({ onStart }: { onStart: (origin: Origin) => void }) => (
    <div className="relative rounded-[28px] border border-white/10 bg-white/[0.05] backdrop-blur-2xl p-7 md:p-8">
        <span className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-neon-purple/70 to-transparent" />

        <div className="grid gap-7 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
            <div>
                <div className="mb-4 flex items-center gap-3.5">
                    <img src="/avatar.jpg" alt="NiYox" className="h-14 w-14 rounded-full object-cover border border-white/20" />
                    <div>
                        <h2 className="text-2xl font-bold leading-none">NiYox</h2>
                        <p className="mt-2 text-[11px] tracking-wide text-white/40">独立开发者 · 音乐创作者</p>
                    </div>
                </div>
                <p className="text-[13px] leading-relaxed text-white/55">
                    七年音乐制作经验，精通 FL Studio 等主流 DAW 全流程；擅长用代码做音频——从 Web Audio 实时效果器、AI 音轨分离，
                    到嵌入式音频硬件与全景声评价，横跨前端、算法与硬件。
                </p>

                <div className="mt-6 flex flex-wrap items-center gap-3">
                    <a href={CONTACT.blog} target="_blank" rel="noreferrer" title="个人博客" className={ICON_BTN}>
                        <BookOpen className="h-5 w-5" />
                    </a>
                    <a href={CONTACT.beats} target="_blank" rel="noreferrer" title="作品集网站" className={ICON_BTN}>
                        <Music2 className="h-5 w-5" />
                    </a>
                    <a href={CONTACT.github} target="_blank" rel="noreferrer" title="GitHub 主页" className={ICON_BTN}>
                        <Github className="h-5 w-5" />
                    </a>
                    <WechatQr />

                    <button
                        onClick={(event) => onStart({ x: event.clientX, y: event.clientY })}
                        className="group ml-1 inline-flex w-fit items-center gap-2 rounded-full bg-neon-blue px-6 py-3 text-sm font-bold text-white shadow-[0_0_30px_rgba(36,80,255,0.35)] transition-colors duration-300 hover:bg-[#3a64ff]"
                    >
                        进入工作站
                        <ArrowUpRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                    </button>
                </div>
            </div>

            <RewardCard />
        </div>
    </div>
);

/**
 * 只要窗口够宽就走滚动锚定。
 * 注意：不按 prefers-reduced-motion 降级 —— 很多机器默认开着「减弱动效」，
 * 一旦降级就退回普通排版，等于整段动画从未生效。
 */
const useWideStage = () => {
    const query = () => window.matchMedia('(min-width: 1024px)').matches;
    const [wide, setWide] = useState(query);

    useEffect(() => {
        const media = window.matchMedia('(min-width: 1024px)');
        const sync = () => setWide(query());
        media.addEventListener('change', sync);
        return () => media.removeEventListener('change', sync);
    }, []);

    return wide;
};

export const Home = ({ onStart, onFeature }: HomeProps) => {
    const pinned = useWideStage();

    const trackRef = useRef<HTMLDivElement>(null);
    const h1Ref = useRef<HTMLHeadingElement>(null);
    const taglineRef = useRef<HTMLParagraphElement>(null);
    const taglineLineRefs = useRef<(HTMLSpanElement | null)[]>([]);
    const ctaRef = useRef<HTMLDivElement>(null);
    /** 标题 / 副标题 / 主按钮从当前位置到停靠点所需的位移（随窗口尺寸重算） */
    const dockRef = useRef({ titleX: 0, titleY: 0, taglineX: 0, taglineY: 0, ctaY: 0 });
    /** 副标题每行要靠左对齐时需要的位移（首屏居中 → 停靠后与标题左边缘齐平） */
    const lineShiftRef = useRef([0, 0]);

    const { scrollYProgress } = useScroll({ target: trackRef, offset: ['start start', 'end end'] });
    const progress = useSpring(scrollYProgress, { stiffness: 220, damping: 40, mass: 0.35 });

    useEffect(() => {
        if (!pinned) return;
        const measure = () => {
            const title = h1Ref.current;
            const tagline = taglineRef.current;
            const cta = ctaRef.current;
            if (!title || !tagline || !cta) return;
            // 停靠后标题的视觉底边得按缩放后的高度算，副标题才贴得上
            const dockedTitleBottom = DOCK_Y + title.offsetHeight * DOCK_SCALE;
            dockRef.current = {
                titleX: DOCK_X - title.offsetLeft,
                titleY: DOCK_Y - title.offsetTop,
                taglineX: DOCK_X - tagline.offsetLeft,
                taglineY: dockedTitleBottom + TAGLINE_GAP - tagline.offsetTop,
                // 按钮落到舞台底边居中（offsetParent 就是铺满舞台的那层网格容器）
                ctaY: window.innerHeight - CTA_BOTTOM - cta.offsetHeight - cta.offsetTop,
            };
            // 首屏两行文字都居中（CSS text-center 已经替我们居中了），停靠时要把每行推回左边缘
            const blockWidth = tagline.offsetWidth;
            lineShiftRef.current = taglineLineRefs.current.map((line) => (
                line ? -Math.max(0, (blockWidth - line.offsetWidth) / 2) : 0
            ));
        };
        measure();
        document.fonts?.ready.then(measure).catch(() => undefined);
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, [pinned]);

    /* 标题位移 + 缩字 */
    const dockT = useTransform(progress, TITLE_IN, [0, 1], { ease: easeInOut });
    const titleX = useTransform(dockT, (v) => v * dockRef.current.titleX);
    const titleY = useTransform(dockT, (v) => v * dockRef.current.titleY);
    const titleScale = useTransform(dockT, [0, 1], [1, DOCK_SCALE]);
    const taglineX = useTransform(dockT, (v) => v * dockRef.current.taglineX);
    const taglineY = useTransform(dockT, (v) => v * dockRef.current.taglineY);
    const taglineScale = useTransform(dockT, [0, 1], [1, TAGLINE_SCALE]);
    const line1X = useTransform(dockT, (v) => v * (lineShiftRef.current[0] ?? 0));
    const line2X = useTransform(dockT, (v) => v * (lineShiftRef.current[1] ?? 0));
    const ctaY = useTransform(dockT, (v) => v * dockRef.current.ctaY);

    /* 首屏眉标在标题离开时淡出 */
    const copyY = useTransform(progress, [0.03, 0.12], [0, -28]);
    const eyebrowOpacity = useTransform(progress, [0.02, 0.08], [1, 0]);

    /* 三波内容依次浮现 */
    const textOpacity = useTransform(progress, TEXT_IN, [0, 1]);
    const textY = useTransform(progress, TEXT_IN, [26, 0]);
    const row1Opacity = useTransform(progress, ROW1_IN, [0, 1]);
    const row1Y = useTransform(progress, ROW1_IN, [34, 0]);
    const row2Opacity = useTransform(progress, ROW2_IN, [0, 1]);
    const row2Y = useTransform(progress, ROW2_IN, [34, 0]);
    const cueOpacity = useTransform(progress, CUE_IN, [0, 1]);

    const scrim = useTransform(progress, [0.1, 0.42], [0, 0.62]);

    /* 只有已经露出来的东西才接点击：透明层盖在上面会拦掉鼠标 */
    const [stage, setStage] = useState<'hero' | 'text' | 'row1' | 'row2'>('hero');
    const stageRef = useRef(stage);
    useMotionValueEvent(progress, 'change', (value) => {
        const next = value < 0.16 ? 'hero' : value < 0.5 ? 'text' : value < 0.66 ? 'row1' : 'row2';
        if (next !== stageRef.current) {
            stageRef.current = next;
            setStage(next);
        }
    });

    const heroCopy = (
        <>
            <motion.p
                className="text-[11px] md:text-xs tracking-[0.5em] uppercase text-white/45 mb-7"
                style={pinned ? { opacity: eyebrowOpacity, y: copyY } : undefined}
                initial={pinned ? undefined : { opacity: 0 }}
                animate={pinned ? undefined : { opacity: 1 }}
                transition={{ duration: 0.8, delay: 0.1 }}
            >
                SOUND ISLE
            </motion.p>

            <motion.h1
                ref={h1Ref}
                className="text-7xl md:text-[128px] font-black leading-[1.05]"
                style={pinned ? { x: titleX, y: titleY, scale: titleScale, transformOrigin: 'left top' } : undefined}
            >
                <BlurReveal text="声屿" />
            </motion.h1>

            <motion.p
                ref={taglineRef}
                className="mt-7 text-lg md:text-xl font-medium text-white/85"
                style={pinned ? { x: taglineX, y: taglineY, scale: taglineScale, transformOrigin: 'left top' } : undefined}
                initial={pinned ? undefined : { opacity: 0, y: 16 }}
                animate={pinned ? undefined : { opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 1.0 }}
            >
                {/* 首屏两行居中，随标题停靠时逐行推回左边缘，副标题与「声屿」左对齐 */}
                <span className={pinned ? 'block whitespace-nowrap' : 'block'}>
                    <motion.span
                        ref={(node) => { taglineLineRefs.current[0] = node; }}
                        className="inline-block"
                        style={pinned ? { x: line1X } : undefined}
                    >
                        装进浏览器的音频工作站
                    </motion.span>
                </span>
                <span className={`mt-2 block text-sm md:text-base font-normal text-white/45 ${pinned ? 'whitespace-nowrap' : ''}`}>
                    <motion.span
                        ref={(node) => { taglineLineRefs.current[1] = node; }}
                        className="inline-block"
                        style={pinned ? { x: line2X } : undefined}
                    >
                        多轨混音 · AI 分轨 · 自动母带，声音一步也不离开你的机器
                    </motion.span>
                </span>
            </motion.p>

            {/* 主按钮：首屏在副标题下方，随标题停靠到舞台底边居中，全程可点（不再淡出） */}
            <motion.div
                ref={ctaRef}
                className="relative z-20 mt-12"
                style={pinned ? { y: ctaY, pointerEvents: 'auto' } : undefined}
                initial={pinned ? undefined : { opacity: 0, y: 20 }}
                animate={pinned ? undefined : { opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 1.2 }}
            >
                <MagneticButton onClick={onStart}>开始创造</MagneticButton>
            </motion.div>
        </>
    );

    return (
        <div className="relative" style={{ color: '#ffffff' }}>
            {/* 背景：绿色渐变壁纸 + 压暗层。
                窄屏静态排版整页都压在壁纸上，压得比滚动层更暗，卡片文字才读得清 */}
            <div className="fixed inset-0 pointer-events-none">
                <div
                    className="absolute inset-0"
                    style={{ backgroundImage: 'url(/home-bg.jpg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
                />
                <div className="absolute inset-0 bg-black" style={{ opacity: pinned ? 0.32 : 0.56 }} />
            </div>

            {/* 顶栏（Logo 由全局层提供，这里只放项目仓库入口） */}
            <header className="fixed top-0 inset-x-0 z-30 flex items-center justify-end pl-6 pr-6 py-4">
                <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.2 }}>
                    <a href={CONTACT.repo} target="_blank" rel="noreferrer" title="项目仓库" className={ICON_BTN}>
                        <Github className="h-5 w-5" />
                    </a>
                </motion.div>
            </header>

            {pinned ? (
                <>
                    {/* ===== 滚动锚定：400vh 轨道，舞台钉在视口里演完三波内容 ===== */}
                    <div ref={trackRef} className="relative z-10" style={{ height: '400vh' }}>
                        <div className="sticky top-0 h-screen overflow-hidden">
                            {/* 主视觉的局部压暗：只压中间一块，壁纸的绿仍在四周，文字才立得住 */}
                            <div
                                className="pointer-events-none absolute inset-0"
                                style={{ background: 'radial-gradient(52% 44% at 50% 46%, rgba(3, 9, 11, 0.55), rgba(3, 9, 11, 0) 72%)' }}
                            />
                            {/* 随进度加深的压暗层，卡片浮上来时才有对比 */}
                            <motion.div className="pointer-events-none fixed inset-0 bg-[#06070B]" style={{ opacity: scrim }} />

                            <div className="relative mx-auto h-full max-w-6xl px-6">
                                {/* 主视觉：居中 → 标题与副标题停靠到左上角（副标题跟标题一样左对齐）
                                    z-10 是为了让停靠到舞台底边的主按钮压在内容层之上 */}
                                <div
                                    className="absolute inset-0 z-10 grid place-items-center"
                                    style={{ pointerEvents: stage === 'hero' ? 'auto' : 'none' }}
                                >
                                    <motion.div
                                        className="flex flex-col items-center text-center"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ duration: 0.7, delay: 0.1 }}
                                    >
                                        {heroCopy}
                                    </motion.div>
                                </div>

                                {/* 三波内容：文字 → 第一行卡 → 第二行卡，整行整行地浮现
                                    inset-x-6 是为了与容器 px-6 的内容边界（也就是标题停靠点）对齐；
                                    整块不接指针，免得上层的空盒子挡住停在底边的主按钮 */}
                                <div className="pointer-events-none absolute inset-x-6 top-[200px] bottom-[168px] flex flex-col justify-center">
                                    <motion.div className="pointer-events-none" style={{ opacity: textOpacity, y: textY }}>
                                        <IntroText />
                                    </motion.div>

                                    <motion.div
                                        className="mt-6"
                                        style={{ opacity: row1Opacity, y: row1Y, pointerEvents: stage === 'row1' || stage === 'row2' ? 'auto' : 'none' }}
                                    >
                                        <FeatureRow features={FEATURES.slice(0, 3)} onClick={onFeature} />
                                    </motion.div>

                                    <motion.div
                                        className="mt-3"
                                        style={{ opacity: row2Opacity, y: row2Y, pointerEvents: stage === 'row2' ? 'auto' : 'none' }}
                                    >
                                        <FeatureRow features={FEATURES.slice(3)} onClick={onFeature} />
                                    </motion.div>
                                </div>

                                {/* 路标：全部浮现完之后才出现 */}
                                <motion.div
                                    className="pointer-events-none absolute inset-x-0 bottom-8 flex flex-col items-center gap-2 text-white/40"
                                    style={{ opacity: cueOpacity }}
                                >
                                    <span className="text-[11px] tracking-[0.4em]">关于我</span>
                                    <motion.span animate={{ y: [0, 6, 0] }} transition={{ duration: 1.8, repeat: Infinity }}>
                                        ↓
                                    </motion.span>
                                </motion.div>
                            </div>
                        </div>
                    </div>

                    {/* ===== 个人信息：走完轨道后作为普通段落接上（路标已经点过题，这里不再重复标题） ===== */}
                    <section className="relative z-10 mx-auto max-w-3xl px-6 pt-20 pb-28">
                        <motion.div
                            initial={{ opacity: 0, y: 40 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true, margin: '-80px' }}
                            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                        >
                            <ProfileCard onStart={onStart} />
                        </motion.div>
                    </section>
                </>
            ) : (
                /* ===== 窄屏：常规纵向排版 ===== */
                <>
                    <section className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 text-center">{heroCopy}</section>

                    <section className="relative z-10 max-w-6xl mx-auto px-6 pb-24">
                        <motion.div
                            initial={{ opacity: 0, y: 24 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true, margin: '-80px' }}
                            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                            className="mb-8"
                        >
                            <IntroText />
                        </motion.div>

                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            {FEATURES.map((feature, index) => (
                                <StaticFeatureCard
                                    key={feature.title}
                                    feature={feature}
                                    index={index}
                                    onClick={(origin) => onFeature(origin, feature.tool)}
                                />
                            ))}
                        </div>
                    </section>

                    <section className="relative z-10 max-w-3xl mx-auto px-6 pb-28">
                        <motion.div
                            initial={{ opacity: 0, y: 40 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true, margin: '-80px' }}
                            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                        >
                            <h2 className="mb-6 text-3xl font-bold">关于我</h2>
                            <ProfileCard onStart={onStart} />
                        </motion.div>
                    </section>
                </>
            )}
        </div>
    );
};
