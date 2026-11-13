import { EffectType } from '../../types/audio';
import { startEffectDrag, shouldSuppressEffectClick } from '../../utils/effectDrag';
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
    空间效果: '#2450FF',
    滤波器: '#3D5BFF',
    动态处理: '#9CA3AF',
    时间效果: '#A6FF00',
    调制效果: '#5B7BFF',
    失真: '#FF3B30',
};

const categories = Array.from(new Set(effectsLibrary.map((e) => e.category)));

/** 判断颜色亮度，决定其上文字用深色还是白色（浅色背景配深字，深色背景配白字） */
const isLight = (hex: string) => {
    const n = parseInt(hex.replace('#', ''), 16);
    if (Number.isNaN(n)) return false;
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return (r * 299 + g * 587 + b * 114) / 1000 > 150;
};

export const EffectLibrary: React.FC<EffectLibraryProps> = ({ onAddEffect }) => (
    <div className="effect-library-sidebar">
        {categories.map((category) => {
            const color = CATEGORY_COLORS[category] ?? '#2450FF';
            const items = effectsLibrary.filter((e) => e.category === category);
            return (
                <div key={category} className="effect-category">
                    <h4 style={{ color }}>{category}</h4>
                    <div className="library-list">
                        {items.map((effect) => (
                            <button
                                key={effect.type}
                                className="effect-button"
                                onPointerDown={(e) => startEffectDrag(e, { type: effect.type, name: effect.name, color }, onAddEffect)}
                                onClick={() => { if (!shouldSuppressEffectClick()) onAddEffect(effect.type); }}
                                title={`${effect.name}（点击或拖拽到效果器链）`}
                                style={{ background: color, color: isLight(color) ? '#15161d' : '#ffffff' }}
                            >
                                {effect.name}
                            </button>
                        ))}
                    </div>
                </div>
            );
        })}
    </div>
);
