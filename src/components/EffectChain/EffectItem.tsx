import React, { useState } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { EffectConfig, EffectType, EqBandData, ShaperPoint } from '../../types/audio';
import { effectParameterDefinitions } from '../../utils/audioUtils';
import { Knob } from '../UI/Knob';
import { EqGraph } from './EqGraph';
import { ShaperGraph } from './ShaperGraph';
import { DynamicsGraph } from './DynamicsGraph';

interface EffectItemProps {
    effect: EffectConfig;
    index: number;
    onRemove: () => void;
    onToggle: () => void;
    onUpdate: (parameters: Record<string, number>) => void;
    onUpdateEqBands: (bands: EqBandData[]) => void;
    onUpdateShaperPoints: (points: ShaperPoint[]) => void;
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

const effectColors: Record<EffectType, string> = {
    reverb: '#4facfe',
    eq: '#39ff73',
    compressor: '#ff6b35',
    delay: '#b84cff',
    chorus: '#00d4ff',
    phaser: '#ff4fd8',
    distortion: '#ff453a',
    filter: '#00d4ff',
    limiter: '#ffd60a',
    gate: '#8a8f9d',
};

export const EffectItem: React.FC<EffectItemProps> = ({
    effect,
    index,
    onRemove,
    onToggle,
    onUpdate,
    onUpdateEqBands,
    onUpdateShaperPoints,
}) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const dragControls = useDragControls();

    const effectParams = effectParameterDefinitions[effect.type];
    const params = Object.entries(effectParams);
    const knobParams = params.filter(([, c]) => !c.control || c.control === 'knob');
    const otherParams = params.filter(([, c]) => c.control === 'slider' || c.control === 'select');

    const setParam = (name: string, value: number) => onUpdate({ ...effect.parameters, [name]: value });

    return (
        <Reorder.Item
            value={effect.id}
            dragListener={false}
            dragControls={dragControls}
            whileDrag={{
                scale: 1.02,
                zIndex: 1000,
                boxShadow: '0 12px 35px rgba(0, 0, 0, 0.6), 0 0 30px rgba(0, 212, 255, 0.3)',
            }}
            transition={{ type: 'spring', stiffness: 500, damping: 40 }}
            className={`effect-item ${!effect.enabled ? 'disabled' : ''}`}
            style={{ position: 'relative' }}
        >
            <div className="effect-header">
                <div className="effect-drag-handle" onPointerDown={(e) => dragControls.start(e)}>
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
                    <button className="control-btn remove-btn" onClick={onRemove} title="删除效果器">
                        🗑️
                    </button>
                </div>
            </div>

            {isExpanded && (
                <div className="effect-parameters">
                    {effect.type === 'eq' && (
                        <EqGraph
                            bands={effect.eqBands ?? []}
                            onChange={onUpdateEqBands}
                        />
                    )}
                    {effect.type === 'distortion' && (
                        <ShaperGraph
                            points={effect.shaperPoints ?? []}
                            onChange={onUpdateShaperPoints}
                        />
                    )}
                    {effect.type === 'compressor' && (
                        <DynamicsGraph
                            threshold={effect.parameters.threshold ?? -18}
                            ratio={effect.parameters.ratio ?? 3}
                            knee={effect.parameters.knee ?? 12}
                            color={effectColors.compressor}
                        />
                    )}
                    {effect.type === 'limiter' && (
                        <DynamicsGraph
                            threshold={effect.parameters.threshold ?? -3}
                            ratio={20}
                            knee={0}
                            color={effectColors.limiter}
                        />
                    )}

                    {effect.type !== 'eq' && (
                        <>
                            {knobParams.length > 0 && (
                                <div className="knob-grid">
                                    {knobParams.map(([name, cfg]) => (
                                        <Knob
                                            key={name}
                                            value={effect.parameters[name] ?? cfg.default}
                                            min={cfg.min}
                                            max={cfg.max}
                                            step={cfg.step}
                                            defaultValue={cfg.default}
                                            onChange={(v) => setParam(name, v)}
                                            label={cfg.label}
                                            unit={cfg.unit}
                                            color={effectColors[effect.type]}
                                        />
                                    ))}
                                </div>
                            )}
                            {otherParams.length > 0 && (
                                <div className="param-list">
                                    {otherParams.map(([name, cfg]) => {
                                        const currentValue = effect.parameters[name] ?? cfg.default;
                                        if (cfg.control === 'select') {
                                            return (
                                                <div key={name} className="parameter-control">
                                                    <label className="parameter-label">{cfg.label}</label>
                                                    <select
                                                        className="parameter-select"
                                                        value={currentValue}
                                                        onChange={(e) => setParam(name, parseInt(e.target.value, 10))}
                                                    >
                                                        {cfg.options?.map((opt, i) => (
                                                            <option key={i} value={i}>
                                                                {opt}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                            );
                                        }
                                        return (
                                            <div key={name} className="parameter-control">
                                                <label className="parameter-label">
                                                    {cfg.label}
                                                    <span className="parameter-value">
                                                        {currentValue.toFixed(cfg.step < 1 ? 1 : 0)}{cfg.unit}
                                                    </span>
                                                </label>
                                                <input
                                                    type="range"
                                                    min={cfg.min}
                                                    max={cfg.max}
                                                    step={cfg.step}
                                                    value={currentValue}
                                                    onChange={(e) => setParam(name, parseFloat(e.target.value))}
                                                    className="parameter-slider"
                                                />
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </Reorder.Item>
    );
};
