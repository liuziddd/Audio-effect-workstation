import React, { useState } from 'react';
import { Reorder, useDragControls, AnimatePresence, motion } from 'framer-motion';
import { Power, ChevronDown, ChevronUp } from 'lucide-react';
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

const effectColors: Record<EffectType, string> = {
    reverb: '#7B9CFF',
    eq: '#3D5BFF',
    compressor: '#9CA3AF',
    delay: '#A6FF00',
    chorus: '#2450FF',
    phaser: '#7B9CFF',
    distortion: '#FF3B30',
    filter: '#2450FF',
    limiter: '#A6FF00',
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
                boxShadow: '0 12px 35px rgba(0, 0, 0, 0.6), 0 0 30px rgba(36, 80, 255, 0.3)',
            }}
            transition={{ type: 'spring', stiffness: 500, damping: 40 }}
            className={`effect-item ${!effect.enabled ? 'disabled' : ''}`}
            style={{ position: 'relative' }}
        >
            {/* 头部：未展开时的全部区域，除按钮外均可拖拽 */}
            <div className="effect-header" onPointerDown={(e) => dragControls.start(e)}>
                <div className="effect-info">
                    <span className="effect-index">#{index + 1}</span>
                    <span className="effect-name">{effect.name}</span>
                </div>

                <div className="effect-controls" onPointerDown={(e) => e.stopPropagation()}>
                    <button
                        className={`control-btn power-btn ${effect.enabled ? 'active' : ''}`}
                        onClick={onToggle}
                        title={effect.enabled ? '关闭效果器' : '开启效果器'}
                    >
                        <Power className="w-4 h-4" />
                    </button>
                    <button
                        className={`control-btn expand-btn ${isExpanded ? 'active' : ''}`}
                        onClick={() => setIsExpanded(!isExpanded)}
                        title={isExpanded ? '收起参数' : '展开参数'}
                    >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                    <button className="control-btn remove-btn" onClick={onRemove} title="删除效果器">
                        🗑️
                    </button>
                </div>
            </div>

            {/* 展开参数：高度渐显动画 */}
            <AnimatePresence initial={false}>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ height: { duration: 0.3, ease: [0.4, 0, 0.2, 1] }, opacity: { duration: 0.22 } }}
                        style={{ overflow: 'hidden' }}
                    >
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
                    </motion.div>
                )}
            </AnimatePresence>
        </Reorder.Item>
    );
};
