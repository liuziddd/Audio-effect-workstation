import { useEffect, useRef } from 'react';
import { useIsMobile } from '../hooks/useIsMobile';
import { AnimatePresence, motion } from 'framer-motion';
import { BookOpen, X } from 'lucide-react';
import './HelpDialog.css';

/** 左上角说明入口：与 Logo 同尺寸的圆形按钮，夹在 Logo 与主题开关之间 */
export const HelpTrigger = ({ onClick }: { onClick: () => void }) => (
    <motion.button
        className="help-trigger"
        onClick={onClick}
        whileTap={{ scale: 0.9 }}
        aria-label="使用说明"
        title="使用说明"
    >
        <BookOpen className="w-[18px] h-[18px]" />
    </motion.button>
);

const SHORTCUTS: { keys: string; text: string }[] = [
    { keys: 'Shift + 拖动', text: '调整通道顺序（多选时整段一起移动）' },
    { keys: 'Ctrl', text: '按住进入多选：参数锁定，扫过逐条切换选中' },
    { keys: 'G', text: '给选中的通道分组上色；已分组时再按一次即退出分组' },
    { keys: 'T', text: '把选中的通道固定在左侧（已固定时再按取消）' },
    { keys: '双击数值', text: '直接输入音量、声像或效果器参数' },
    { keys: '滚轮', text: '通道区横移（上下滚 = 左右移）' },
];

interface Section {
    title: string;
    items: string[];
}

const SECTIONS: Section[] = [
    {
        title: '开始混音',
        items: [
            '把音频文件拖到通道条上，或点击通道里的波形区选择文件。',
            '左侧「本地文件」可以浏览本机目录，拖出来同样是加到通道。',
            '推子调音量、下方细条调声像，双击读数可以输入具体数值。',
            'BYP 旁通该通道全部效果器，M 静音，S 独奏。',
        ],
    },
    {
        title: '效果器与路由',
        items: [
            '点通道条上的「效果器」展开这条通道的效果链，多条通道可以同时展开。',
            '左侧「效果器库」点一下加到当前通道，拖拽则以落点通道为准。',
            '效果器卡片左侧的复制按钮长按拖到任意链的任意位置，连参数一起复制。',
            '通道底部的圆点拖到另一条通道即建立路由，连点两下断开这条通道的全部出线。',
            '路由线跟随通道颜色；未上色的通道在暗色主题下是白线，亮色主题下是黑线。',
        ],
    },
    {
        title: '批量操作',
        items: [
            '按住 Ctrl 进入多选：通道参数暂时锁定，按住鼠标横向扫过即可连续选中。',
            '选中多条后调音量 / 声像，其余通道按同一比例跟随；BYP / M / S 同步成当前状态。',
            '效果器链里 Ctrl 多选后，开关、展开、删除、复制都作用于整组。',
            '选中多条后拖任意一条的路由点，会为它们同时拉出到落点通道的连线。',
        ],
    },
    {
        title: '分组',
        items: [
            '选中两条以上通道，点工具条的图层按钮或按 G 选颜色即成组；不相邻的通道会先自动聚拢成一段。',
            '选中一条已分组的通道，图层按钮会亮起该组颜色；再点一次就退出分组，通道恢复默认颜色。',
            '组名写在组首通道条上方、颜色与组色一致，点一下即可改名，回车提交、Esc 放弃。',
            '组名前面那枚小色块点开可以直接换整组颜色，组内通道会一起变。',
            '把通道拖进组内、或在图层按钮下面点一个已有分组，都会直接并入那个组；组与组之间只隔一条细分隔线。',
            '把通道拖出分隔线也会退出分组，只影响被拖走的那条，同组其余通道保持原样。',
        ],
    },
    {
        title: '工具面板',
        items: [
            '音频检测：BPM、调性、响度与频谱等指标。',
            'AI 音轨分离：人声、鼓、贝斯、其他四轨拆开。',
            'AI 自动母带：DSP 与神经母带两种引擎，导出母带级成品。',
            'MIDI 生成：按调性、风格、情绪写和声进行与织体，和弦只交代走向不做切分，可试听、改速度、导出 MIDI。',
        ],
    },
];

export const HelpDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
    const panelRef = useRef<HTMLDivElement>(null);
    const isMobile = useIsMobile();

    // 打开时把焦点移到说明书上，Esc 关闭；背景滚动一并锁住
    useEffect(() => {
        if (!open) return;
        panelRef.current?.focus();
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => {
            document.body.style.overflow = previous;
            window.removeEventListener('keydown', onKey);
        };
    }, [open, onClose]);

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className="help-overlay"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.22 }}
                    onPointerDown={(event) => {
                        if (event.target === event.currentTarget) onClose();
                    }}
                >
                    <motion.div
                        ref={panelRef}
                        className="help-panel"
                        tabIndex={-1}
                        role="dialog"
                        aria-modal="true"
                        aria-label="使用说明"
                        initial={{ opacity: 0, scale: 0.94, y: 14 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: 8 }}
                        transition={{ type: 'spring', stiffness: 320, damping: 30, mass: 0.8 }}
                    >
                        <div className="help-head">
                            <div>
                                <span className="help-kicker">SOUND ISLE</span>
                                <h2>使用说明</h2>
                            </div>
                            <button className="help-close" onClick={onClose} aria-label="关闭说明">
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="help-body">
                            {isMobile && (
                                <p className="help-mobile-note">
                                    手机端提供四个实用工具；混音台、效果器与本地文件请在 PC 上使用。以下为完整说明。
                                </p>
                            )}
                            {SECTIONS.map((section) => (
                                <section key={section.title} className="help-section">
                                    <h3>{section.title}</h3>
                                    <ul>
                                        {section.items.map((item) => (
                                            <li key={item}>{item}</li>
                                        ))}
                                    </ul>
                                </section>
                            ))}

                            <section className="help-section">
                                <h3>快捷键</h3>
                                <div className="help-keys">
                                    {SHORTCUTS.map((item) => (
                                        <div key={item.keys} className="help-key-row">
                                            <kbd>{item.keys}</kbd>
                                            <span>{item.text}</span>
                                        </div>
                                    ))}
                                </div>
                            </section>

                            <p className="help-foot">
                                所有处理都在本机浏览器里完成，音频不会离开你的设备。
                            </p>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
