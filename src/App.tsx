import { useState } from 'react';
import { motion } from 'framer-motion';
import { Home } from './pages/Home';
import { Editor } from './pages/Editor';
import { MorphLogo } from './components/MorphLogo';

type Page = 'home' | 'editor';
type Origin = { x: number; y: number };
type Phase = 'idle' | 'cover' | 'uncover';

/** Logo 中心点（fixed left-4 top-4，尺寸 44） */
const LOGO_ORIGIN: Origin = { x: 38, y: 38 };

function App() {
    const [page, setPage] = useState<Page>('home');
    const [target, setTarget] = useState<Page>('home');
    const [origin, setOrigin] = useState<Origin>(LOGO_ORIGIN);
    const [phase, setPhase] = useState<Phase>('idle');

    const navigate = (next: Page, o: Origin) => {
        if (phase !== 'idle') return;
        setOrigin(o);
        setTarget(next);
        setPhase('cover');
    };

    const togglePage = () => {
        navigate(page === 'home' ? 'editor' : 'home', LOGO_ORIGIN);
    };

    const handleRevealComplete = () => {
        if (phase === 'cover') {
            setPage(target);
            setPhase('uncover');
        } else if (phase === 'uncover') {
            setPhase('idle');
        }
    };

    const radius = phase === 'cover' ? '150%' : '0%';
    const clipPath = `circle(${radius} at ${origin.x}px ${origin.y}px)`;

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white font-sans">
            {page === 'home' ? (
                <Home onStart={(o) => navigate('editor', o)} />
            ) : (
                <Editor />
            )}

            {/* 圆形遮罩揭示转场（位于 Logo 下方） */}
            <motion.div
                className="fixed inset-0 z-[100] pointer-events-none"
                initial={false}
                animate={{ clipPath }}
                transition={{ duration: 0.55, ease: [0.76, 0, 0.24, 1] }}
                onAnimationComplete={handleRevealComplete}
            >
                <div
                    className="w-full h-full"
                    style={{ background: 'linear-gradient(135deg, #0a0a14 0%, #12122a 50%, #0a0a14 100%)' }}
                />
            </motion.div>

            {/* 全局固定 Logo（始终在遮罩上方，提供视觉固定；点击返回首页） */}
            <div className="fixed left-4 top-4 z-[110]">
                <MorphLogo onClick={togglePage} active={phase !== 'idle'} />
            </div>
        </div>
    );
}

export default App;
