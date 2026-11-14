import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Home } from './pages/Home';
import { Editor } from './pages/Editor';
import { MorphLogo } from './components/MorphLogo';
import { ThemeToggle } from './components/ThemeToggle';
import { HelpDialog, HelpTrigger } from './components/HelpDialog';

type Page = 'home' | 'editor';
type Origin = { x: number; y: number };
type Phase = 'idle' | 'cover' | 'uncover';
type EditorTool = 'inspector' | 'separator' | 'master';

/** Logo 中心点（fixed left-4 top-4，尺寸 44） */
const LOGO_ORIGIN: Origin = { x: 38, y: 38 };

const THEME_KEY = 'aew-theme';

const getInitialTheme = (): 'dark' | 'light' =>
    localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';

function App() {
    const [page, setPage] = useState<Page>('home');
    const [target, setTarget] = useState<Page>('home');
    const [origin, setOrigin] = useState<Origin>(LOGO_ORIGIN);
    const [phase, setPhase] = useState<Phase>('idle');
    const [tool, setTool] = useState<EditorTool | undefined>();
    const [theme, setTheme] = useState<'dark' | 'light'>(getInitialTheme);
    const [helpOpen, setHelpOpen] = useState(false);

    // 主题切换：html 上增删 light class（暗色为默认），并持久化
    useEffect(() => {
        const root = document.documentElement;
        root.classList.toggle('light', theme === 'light');
        root.classList.toggle('dark', theme === 'dark');
        localStorage.setItem(THEME_KEY, theme);
    }, [theme]);

    // 换页时回到顶部（首页是纵向锚定轨道，离开前可能停在任意段落）
    useEffect(() => {
        window.scrollTo(0, 0);
    }, [page]);

    const navigate = (next: Page, o: Origin, nextTool?: EditorTool) => {
        if (phase !== 'idle') return;
        setOrigin(o);
        setTarget(next);
        setTool(nextTool);
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
        <div className="min-h-screen font-sans">
            {page === 'home' ? (
                <Home
                    onStart={(o) => navigate('editor', o)}
                    onFeature={(o, nextTool) => navigate('editor', o, nextTool)}
                />
            ) : (
                <Editor initialTool={tool} />
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
                    style={{ background: 'linear-gradient(135deg, var(--bg) 0%, var(--surface) 50%, var(--bg) 100%)' }}
                />
            </motion.div>

            {/* 左上角：页面切换按钮 + 使用说明 + 主题开关并排（叠在侧边栏顶部） */}
            <div className="fixed left-4 top-4 z-[110] flex items-center gap-3">
                <MorphLogo onClick={togglePage} active={phase !== 'idle'} />
                <HelpTrigger onClick={() => setHelpOpen(true)} />
                <ThemeToggle
                    checked={theme === 'light'}
                    onChange={(light) => setTheme(light ? 'light' : 'dark')}
                />
            </div>

            <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
        </div>
    );
}

export default App;
