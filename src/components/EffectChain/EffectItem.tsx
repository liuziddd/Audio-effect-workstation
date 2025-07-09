import React, { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { EffectConfig, EffectType } from '../../types/audio';

interface EffectItemProps {
    effect: EffectConfig;
    index: number;
    onRemove: () => void;
    onToggle: () => void;
    onBypass: () => void;
    onUpdate: (parameters: Record<string, number>) => void;
}

// 每个效果器的默认参数配置
const defaultEffectParameters: Record<EffectType, Record<string, { min: number; max: number; step: number; default: number; unit: string }>> = {
    reverb: {
        roomSize: { min: 0, max: 1, step: 0.01, default: 0.5, unit: '' },
        decay: { min: 0, max: 10, step: 0.1, default: 2, unit: 's' },
        wetness: { min: 0, max: 1, step: 0.01, default: 0.3, unit: '' },
    },
    eq: {
        lowGain: { min: -20, max: 20, step: 0.5, default: 0, unit: 'dB' },
        midGain: { min: -20, max: 20, step: 0.5, default: 0, unit: 'dB' },
        highGain: { min: -20, max: 20, step: 0.5, default: 0, unit: 'dB' },
        lowFreq: { min: 20, max: 500, step: 10, default: 200, unit: 'Hz' },
        highFreq: { min: 2000, max: 20000, step: 100, default: 8000, unit: 'Hz' },
    },
    compressor: {
        threshold: { min: -60, max: 0, step: 1, default: -20, unit: 'dB' },
        ratio: { min: 1, max: 20, step: 0.5, default: 4, unit: ':1' },
        attack: { min: 0, max: 1, step: 0.001, default: 0.01, unit: 's' },
        release: { min: 0, max: 1, step: 0.01, default: 0.1, unit: 's' },
    },
    delay: {
        time: { min: 0, max: 1, step: 0.01, default: 0.25, unit: 's' },
        feedback: { min: 0, max: 0.9, step: 0.01, default: 0.3, unit: '' },
        wetness: { min: 0, max: 1, step: 0.01, default: 0.3, unit: '' },
    },
    chorus: {
        frequency: { min: 0.5, max: 10, step: 0.1, default: 2, unit: 'Hz' },
        depth: { min: 0, max: 1, step: 0.01, default: 0.3, unit: '' },
        wetness: { min: 0, max: 1, step: 0.01, default: 0.5, unit: '' },
    },
    phaser: {
        frequency: { min: 0.1, max: 10, step: 0.1, default: 1, unit: 'Hz' },
        depth: { min: 0, max: 1, step: 0.01, default: 0.5, unit: '' },
        stages: { min: 2, max: 12, step: 1, default: 6, unit: '' },
    },
    distortion: {
        drive: { min: 0, max: 1, step: 0.01, default: 0.3, unit: '' },
        curve: { min: 0, max: 100, step: 1, default: 50, unit: '' },
        oversample: { min: 1, max: 4, step: 1, default: 2, unit: 'x' },
    },
    filter: {
        frequency: { min: 20, max: 20000, step: 10, default: 1000, unit: 'Hz' },
        Q: { min: 0.1, max: 30, step: 0.1, default: 1, unit: '' },
        gain: { min: -20, max: 20, step: 0.5, default: 0, unit: 'dB' },
    },
    limiter: {
        threshold: { min: -30, max: 0, step: 0.5, default: -6, unit: 'dB' },
        release: { min: 0.001, max: 1, step: 0.001, default: 0.01, unit: 's' },
    },
    gate: {
        threshold: { min: -60, max: 0, step: 1, default: -30, unit: 'dB' },
        ratio: { min: 1, max: 100, step: 1, default: 10, unit: ':1' },
        attack: { min: 0, max: 1, step: 0.001, default: 0.001, unit: 's' },
        release: { min: 0, max: 1, step: 0.01, default: 0.1, unit: 's' },
    },
};

const effectIcons: Record<EffectType, string> = {
    reverb: '🌊',
    eq: '📊',
    compressor: '📈',
    delay: '⏰',
    chorus: '🎵',
    phaser: '🌀',
    distortion: '⚡',
    filter: '🔽',
    limiter: '🚫',
    gate: '🚪',
};

export const EffectItem: React.FC<EffectItemProps> = ({
    effect,
    index,
    onRemove,
    onToggle,
    onBypass,
    onUpdate,
}) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: effect.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    const effectParams = defaultEffectParameters[effect.type];

    const handleParameterChange = (paramName: string, value: number) => {
        const newParameters = {
            ...effect.parameters,
            [paramName]: value,
        };
        onUpdate(newParameters);
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`effect-item ${!effect.enabled ? 'disabled' : ''} ${effect.bypass ? 'bypassed' : ''} ${isDragging ? 'dragging' : ''}`}
        >
            <div className="effect-header">
                <div className="effect-drag-handle" {...attributes} {...listeners}>
                    <span className="drag-icon">⋮⋮</span>
                </div>

                <div className="effect-info">
                    <span className="effect-icon">{effectIcons[effect.type]}</span>
                    <div className="effect-details">
                        <span className="effect-name">{effect.name}</span>
                        <span className="effect-index">#{index + 1}</span>
                    </div>
                </div>

                <div className="effect-controls">
                    <button
                        className={`control-btn bypass-btn ${effect.bypass ? 'active' : ''}`}
                        onClick={onBypass}
                        title={effect.bypass ? '取消绕过' : '绕过效果器'}
                    >
                        🔄
                    </button>

                    <button
                        className={`control-btn power-btn ${effect.enabled ? 'active' : ''}`}
                        onClick={onToggle}
                        title={effect.enabled ? '关闭效果器' : '开启效果器'}
                    >
                        ⚡
                    </button>

                    <button
                        className={`control-btn expand-btn ${isExpanded ? 'active' : ''}`}
                        onClick={() => setIsExpanded(!isExpanded)}
                        title={isExpanded ? '收起参数' : '展开参数'}
                    >
                        ⚙️
                    </button>

                    <button
                        className="control-btn remove-btn"
                        onClick={onRemove}
                        title="删除效果器"
                    >
                        🗑️
                    </button>
                </div>
            </div>

            {isExpanded && (
                <div className="effect-parameters">
                    {Object.entries(effectParams).map(([paramName, paramConfig]) => {
                        const currentValue = effect.parameters[paramName] ?? paramConfig.default;
                        return (
                            <div key={paramName} className="parameter-control">
                                <label className="parameter-label">
                                    {paramName}
                                    <span className="parameter-value">
                                        {currentValue.toFixed(paramConfig.step < 1 ? 3 : 1)}{paramConfig.unit}
                                    </span>
                                </label>
                                <input
                                    type="range"
                                    min={paramConfig.min}
                                    max={paramConfig.max}
                                    step={paramConfig.step}
                                    value={currentValue}
                                    onChange={(e) => handleParameterChange(paramName, parseFloat(e.target.value))}
                                    className="parameter-slider"
                                />
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}; 