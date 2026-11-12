import { EffectType } from '../../types/audio';
import './styles.css';

interface EffectLibraryProps {
    onAddEffect: (effectType: EffectType) => void;
}

interface EffectInfo {
    type: EffectType;
    name: string;
    category: string;
}

const effectsLibrary: EffectInfo[] = [
    { type: 'reverb', name: '混响', category: '空间效果' },
    { type: 'eq', name: '均衡器', category: '滤波器' },
    { type: 'filter', name: '滤波器', category: '滤波器' },
    { type: 'compressor', name: '压缩器', category: '动态处理' },
    { type: 'limiter', name: '限制器', category: '动态处理' },
    { type: 'gate', name: '噪声门', category: '动态处理' },
    { type: 'delay', name: '延迟', category: '时间效果' },
    { type: 'chorus', name: '合唱', category: '调制效果' },
    { type: 'phaser', name: '相位器', category: '调制效果' },
    { type: 'distortion', name: '失真', category: '失真' },
];

const CATEGORY_COLORS: Record<string, string> = {
    空间效果: '#00d4ff',
    滤波器: '#b84cff',
    动态处理: '#ff9f43',
    时间效果: '#39ff73',
    调制效果: '#ff5ecf',
    失真: '#ff5252',
};

const categories = Array.from(new Set(effectsLibrary.map((e) => e.category)));

export const EffectLibrary: React.FC<EffectLibraryProps> = ({ onAddEffect }) => (
    <div className="effect-library-sidebar">
        {categories.map((category, ci) => {
            const color = CATEGORY_COLORS[category] ?? '#00d4ff';
            const items = effectsLibrary.filter((e) => e.category === category);
            return (
                <div key={category} className="effect-category">
                    <h4 style={{ color }}>{category}</h4>
                    <div className="library-list">
                        {items.map((effect, i) => (
                            <button
                                key={effect.type}
                                className="effect-button"
                                draggable
                                onDragStart={(e) => {
                                    e.dataTransfer.setData('application/x-effect-type', effect.type);
                                    e.dataTransfer.effectAllowed = 'copy';
                                }}
                                onClick={() => onAddEffect(effect.type)}
                                title={`${effect.name}（点击或拖拽到效果器链）`}
                                style={{ '--accent': color, animationDelay: `${ci * 0.05 + i * 0.03}s` } as React.CSSProperties}
                            >
                                <span className="effect-accent" />
                                <span className="effect-name">{effect.name}</span>
                                <span className="effect-arrow">›</span>
                            </button>
                        ))}
                    </div>
                </div>
            );
        })}
    </div>
);
