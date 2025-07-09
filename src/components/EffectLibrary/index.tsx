import React from 'react';
import { EffectType } from '../../types/audio';
import './styles.css';

interface EffectLibraryProps {
    onAddEffect: (effectType: EffectType) => void;
}

interface EffectInfo {
    type: EffectType;
    name: string;
    description: string;
    icon: string;
    category: string;
}

const effectsLibrary: EffectInfo[] = [
    {
        type: 'reverb',
        name: '混响',
        description: '添加空间感和深度',
        icon: '🌊',
        category: '空间效果'
    },
    {
        type: 'eq',
        name: '均衡器',
        description: '调节频率响应',
        icon: '📊',
        category: '滤波器'
    },
    {
        type: 'compressor',
        name: '压缩器',
        description: '控制动态范围',
        icon: '📈',
        category: '动态处理'
    },
    {
        type: 'delay',
        name: '延迟',
        description: '回声和延迟效果',
        icon: '⏰',
        category: '时间效果'
    },
    {
        type: 'chorus',
        name: '合唱',
        description: '增加厚度和宽度',
        icon: '🎵',
        category: '调制效果'
    },
    {
        type: 'phaser',
        name: '相位器',
        description: '旋转相位效果',
        icon: '🌀',
        category: '调制效果'
    },
    {
        type: 'distortion',
        name: '失真',
        description: '增加谐波失真',
        icon: '⚡',
        category: '失真'
    },
    {
        type: 'filter',
        name: '滤波器',
        description: '频率过滤',
        icon: '🔽',
        category: '滤波器'
    },
    {
        type: 'limiter',
        name: '限制器',
        description: '防止音频过载',
        icon: '🚫',
        category: '动态处理'
    },
    {
        type: 'gate',
        name: '噪声门',
        description: '减少背景噪声',
        icon: '🚪',
        category: '动态处理'
    }
];

const categories = Array.from(new Set(effectsLibrary.map(effect => effect.category)));

export const EffectLibrary: React.FC<EffectLibraryProps> = ({ onAddEffect }) => {
    return (
        <div className="effect-library-sidebar">
            <div className="effect-categories">
                {categories.map(category => (
                    <div key={category} className="effect-category">
                        <h4>{category}</h4>
                        <div className="effects-grid">
                            {effectsLibrary
                                .filter(effect => effect.category === category)
                                .map(effect => (
                                    <button
                                        key={effect.type}
                                        className="effect-button"
                                        onClick={() => onAddEffect(effect.type)}
                                        title={effect.description}
                                    >
                                        <span className="effect-icon">{effect.icon}</span>
                                        <span className="effect-name">{effect.name}</span>
                                    </button>
                                ))
                            }
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}; 