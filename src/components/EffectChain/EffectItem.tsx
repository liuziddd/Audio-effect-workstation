import React, { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { EffectConfig, EffectType } from '../../types/audio';
import { effectParameterDefinitions } from '../../utils/audioUtils';

interface EffectItemProps {
    effect: EffectConfig;
    index: number;
    onRemove: () => void;
    onToggle: () => void;
    onBypass: () => void;
    onUpdate: (parameters: Record<string, number>) => void;
}

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

    const effectParams = effectParameterDefinitions[effect.type];

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
                                    {paramConfig.label}
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