import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { BookOpen, Github, Music2 } from 'lucide-react';

interface HomeProps {
    onStart: (origin: { x: number; y: number }) => void;
}

/** 联系方式与个人站点 */
const CONTACT = {
    github: 'https://github.com/liuziddd',
    wechat: 'lyx0504210019',
    beats: 'https://liuyx.my.canvasite.cn/beat',
    blog: 'https://www.lyxblog.click',
};

/** 微信按钮：点击复制微信号 */
const WeChatButton = () => {
    const [copied, setCopied] = useState(false);

    const copyWechat = async () => {
        try {
            await navigator.clipboard.writeText(CONTACT.wechat);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            /* 剪贴板不可用时忽略 */
        }
    };

    return (
        <button
            onClick={copyWechat}
            title={copied ? '已复制' : `微信号：${CONTACT.wechat}（点击复制）`}
            className="group relative flex items-center justify-center w-10 h-10 rounded-full border border-white/15 bg-white/5 backdrop-blur-md hover:bg-neon-green/20 hover:border-neon-green transition-all duration-300"
        >
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current text-white group-hover:text-neon-green transition-colors">
                <path d="M8.69 4C4.99 4 2 6.58 2 9.76c0 1.83 1 3.45 2.56 4.5l-.64 1.92 2.22-1.11c.5.14 1.02.22 1.55.22.2 0 .4-.01.6-.03-.14-.42-.21-.86-.21-1.32 0-3.18 3.02-5.76 6.75-5.76.25 0 .49.01.73.03C15.06 5.61 12.14 4 8.69 4zM6.6 7.1c.42 0 .76.34.76.76s-.34.76-.76.76-.76-.34-.76-.76.34-.76.76-.76zm4.18 0c.42 0 .76.34.76.76s-.34.76-.76.76-.76-.34-.76-.76.34-.76.76-.76z" />
                <path d="M22 14.24c0-2.66-2.6-4.82-5.81-4.82s-5.81 2.16-5.81 4.82 2.6 4.82 5.81 4.82c.5 0 .99-.06 1.45-.17l1.95.98-.56-1.68c1.55-.99 2.97-2.35 2.97-3.95zm-7.61-.74c.34 0 .61.27.61.61s-.27.61-.61.61-.61-.27-.61-.61.27-.61.61-.61zm3.59 0c.34 0 .61.27.61.61s-.27.61-.61.61-.61-.27-.61-.61.27-.61.61-.61z" />
            </svg>
            {copied && (
                <span className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2 py-1 text-xs bg-neon-green text-black rounded whitespace-nowrap">
                    已复制
                </span>
            )}
        </button>
    );
};

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
const MagneticButton = ({ onClick, children }: { onClick: (origin: { x: number; y: number }) => void; children: React.ReactNode }) => {
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
            className="group relative mt-12 px-12 py-4 rounded-full font-bold text-lg overflow-hidden shadow-[0_0_40px_rgba(36,80,255,0.4)]"
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

export const Home = ({ onStart }: HomeProps) => {
    return (
        <div className="relative min-h-screen overflow-x-hidden" style={{ color: '#ffffff' }}>
            {/* 背景：绿色渐变壁纸（单层，暗化内建到 background-image 叠加层） */}
            <div
                className="fixed inset-0 pointer-events-none"
                style={{
                    backgroundImage: 'linear-gradient(rgba(0,0,0,0.32), rgba(0,0,0,0.32)), url(/home-bg.jpg)',
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                }}
            />

        {/* 顶栏（Logo 由全局层提供，这里只放右侧联系图标） */}
        <header className="fixed top-0 inset-x-0 z-30 flex items-center justify-end pl-6 pr-6 py-4">
            <motion.div
                className="flex items-center gap-3"
                initial={{ opacity: 0, y: -12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
            >
                {/* 微信 */}
                <WeChatButton />
                {/* GitHub */}
                <a
                    href={CONTACT.github}
                    target="_blank"
                    rel="noreferrer"
                    title="GitHub"
                    className="group flex items-center justify-center w-10 h-10 rounded-full border border-white/15 bg-white/5 backdrop-blur-md hover:bg-neon-blue/20 hover:border-neon-blue transition-all duration-300"
                >
                    <Github className="w-5 h-5 text-white group-hover:text-neon-blue transition-colors" />
                </a>
                {/* 音乐作品集 */}
                <a
                    href={CONTACT.beats}
                    target="_blank"
                    rel="noreferrer"
                    title="音乐作品集"
                    className="group flex items-center justify-center w-10 h-10 rounded-full border border-white/15 bg-white/5 backdrop-blur-md hover:bg-neon-blue/20 hover:border-neon-blue transition-all duration-300"
                >
                    <Music2 className="w-5 h-5 text-white group-hover:text-neon-blue transition-colors" />
                </a>
                {/* 个人博客 */}
                <a
                    href={CONTACT.blog}
                    target="_blank"
                    rel="noreferrer"
                    title="个人博客"
                    className="group flex items-center justify-center w-10 h-10 rounded-full border border-white/15 bg-white/5 backdrop-blur-md hover:bg-neon-blue/20 hover:border-neon-blue transition-all duration-300"
                >
                    <BookOpen className="w-5 h-5 text-white group-hover:text-neon-blue transition-colors" />
                </a>
            </motion.div>
        </header>

        {/* 主视觉 */}
        <section className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 text-center">
            <motion.p
                className="text-[11px] md:text-xs tracking-[0.5em] uppercase text-gray-400 mb-7"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.8, delay: 0.1 }}
            >
                Audio Effect Workstation
            </motion.p>

            <h1 className="text-6xl md:text-8xl font-black leading-tight">
                <BlurReveal text="音频效果工作站" />
            </h1>

            <motion.p
                className="mt-8 text-base md:text-lg text-gray-400 max-w-xl leading-relaxed"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 1.0 }}
            >
                基于 Web Audio 的在线音频处理平台——实时效果器链、无损导出与 AI 音轨分离，一切都在浏览器里完成。
            </motion.p>

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 1.2 }}
            >
                <MagneticButton onClick={onStart}>开始创造</MagneticButton>
            </motion.div>

            <motion.div
                className="absolute bottom-10 flex flex-col items-center gap-2 text-gray-500"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.6 }}
            >
                <span className="text-xs tracking-widest">关于我</span>
                <motion.span animate={{ y: [0, 6, 0] }} transition={{ duration: 1.6, repeat: Infinity }}>
                    ↓
                </motion.span>
            </motion.div>
        </section>

        {/* 个人介绍 */}
        <section className="relative z-10 max-w-3xl mx-auto px-6 pb-28">
            <motion.div
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-80px' }}
                transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                className="rounded-3xl border border-white/10 bg-white/[0.03] backdrop-blur-md p-8 md:p-12"
            >
                <p className="text-neon-purple text-sm font-semibold tracking-widest mb-3">ABOUT</p>
                <div className="flex items-center gap-4 mb-5">
                    <img
                        src="/avatar.jpg"
                        alt="NiYox"
                        className="w-14 h-14 md:w-16 md:h-16 rounded-full object-cover border border-white/20"
                    />
                    <h2 className="text-3xl md:text-4xl font-bold">NiYox</h2>
                </div>
                <p className="text-gray-300 leading-relaxed mb-6">
                    独立开发者与音乐制作人。七年音乐制作经验，
                    精通 FL Studio 等主流 DAW 全流程；擅长用代码做音频——从 Web Audio 实时效果器、AI 音轨分离，
                    到嵌入式音频硬件与全景声评价，横跨前端、算法与硬件。
                </p>
                <div className="flex flex-wrap gap-2">
                    {['音乐制作', 'AI 产品开发', '数据分析', '嵌入式硬件'].map((tag) => (
                        <span
                            key={tag}
                            className="px-3 py-1 text-xs rounded-full border border-white/15 text-gray-300 hover:border-neon-blue hover:text-neon-blue transition-colors"
                        >
                            {tag}
                        </span>
                    ))}
                </div>
            </motion.div>
        </section>
    </div>
    );
};
