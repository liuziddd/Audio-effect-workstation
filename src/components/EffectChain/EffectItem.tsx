import React from 'react';
import { Reorder, useDragControls, AnimatePresence, motion } from 'framer-motion';
import { Power, CopyPlus, ChevronDown, ChevronUp } from 'lucide-react';
import { EffectConfig, EffectType, EqBandData, ShaperPoint } from '../../types/audio';
import { effectParameterDefinitions } from '../../utils/audioUtils';
import { startEffectCopyDrag } from '../../utils/effectDrag';
import { Knob } from '../UI/Knob';
import { ValueEdit } from '../UI/ValueEdit';
import { EqGraph } from './EqGraph';
import { ShaperGraph } from './ShaperGraph';
import { DynamicsGraph } from './DynamicsGraph';

interface EffectItemProps {
    effect: EffectConfig;
    index: number;
    /** 被 Shift 选中：可与其他选中的效果器一起调参数、一起开关 / 展开 / 删除 / 复制 */
    selected: boolean;
    /** 参数是否展开（由链统一管理，多选时才能整组开合） */
    expanded: boolean;
    /** 按住卡片拖动扫选 */
    onSweep: (event: React.PointerEvent) => void;
    /** 普通单击：收敛成只选这一张 / 再点一下取消 */
    onSelect: () => void;
    onToggleExpanded: () => void;
    /** 点开关按钮：整组同步成取反后的状态 */
    onSetEnabled: () => void;
    onRemove: () => void;
    onUpdate: (parameters: Record<string, number>) => void;
    onUpdateEqBands: (bands: EqBandData[]) => void;
    onUpdateShaperPoints: (points: ShaperPoint[]) => void;
    /** 拖拽复制时要带走的效果器（多选时是整组） */
    copyEffects: EffectConfig[];
    /** 复制拖拽的落点：目标通道 + 插入位置 */
    onCopyDrop: (channelId: string, index: number) => void;
}

/* 效果器标识色：整站强调色是荧光绿，这里只做同一色系的深浅区分；
   失真保留红色，它是唯一「出错」语义。SVG / Canvas 用不了 var()，只能写死 */
const effectColors: Record<EffectType, string> = {
    reverb: '#C6FF4D',
    eq: '#8FE000',
    compressor: '#9CA3AF',
    delay: '#A6FF00',
    chorus: '#A6FF00',
    phaser: '#E2FFA0',
    distortion: '#FF3B30',
    filter: '#8FE000',
    limiter: '#A6FF00',
    gate: '#8a8f9d',
};

export const EffectItem: React.FC<EffectItemProps> = ({
    effect,
    index,
    selected,
    expanded: isExpanded,
    onSweep,
    onSelect,
    onToggleExpanded,
    onSetEnabled,
    onRemove,
    onUpdate,
    onUpdateEqBands,
    onUpdateShaperPoints,
    copyEffects,
    onCopyDrop,
}) => {
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
                boxShadow: '0 12px 35px rgba(0, 0, 0, 0.6), 0 0 30px rgba(166, 255, 0, 0.28)',
            }}
            transition={{ type: 'spring', stiffness: 500, damping: 40 }}
            className={`effect-item ${!effect.enabled ? 'disabled' : ''} ${selected ? 'selected' : ''}`}
            data-effect-id={effect.id}
            style={{ position: 'relative' }}
            onPointerDown={(event) => {
                // 按住 Shift：整张卡片只是一个选项，按下即切换并可扫选。
                // 判定看这次事件自己的修饰键，全局状态只负责锁子控件。
                if (event.shiftKey || event.metaKey) onSweep(event);
            }}
        >
            {/* 头部：未展开时的全部区域，除按钮外均可拖拽；Shift 按下交给卡片自己切换选中 */}
            <div
                className="effect-header"
                onPointerDown={(e) => {
                    // 按住 Shift 由整张卡片接管（切换选中 / 扫选），Ctrl 交给通道级拖动
                    if (e.shiftKey || e.metaKey || e.ctrlKey) return;
                    onSelect();
                    dragControls.start(e);
                }}
            >
                <div className="effect-info">
                    <span className="effect-index">#{index + 1}</span>
                    <span className="effect-name">{effect.name}</span>
                </div>

                <div className="effect-controls" onPointerDown={(e) => e.stopPropagation()}>
                    <button
                        className="control-btn copy-btn"
                        onPointerDown={(e) => startEffectCopyDrag(
                            e,
                            {
                                effects: copyEffects,
                                color: effectColors[effect.type],
                                label: copyEffects.length > 1
                                    ? `复制 · ${copyEffects.length} 个效果器`
                                    : `复制 · ${effect.name}`,
                            },
                            onCopyDrop,
                        )}
                        title="长按拖到任意通道的效果器链，复制相同参数的效果器"
                    >
                        <CopyPlus className="w-4 h-4" />
                    </button>
                    <button
                        className={`control-btn power-btn ${effect.enabled ? 'active' : ''}`}
                        onClick={onSetEnabled}
                        title={effect.enabled ? '关闭效果器' : '开启效果器'}
                    >
                        <Power className="w-4 h-4" />
                    </button>
                    <button
                        className={`control-btn ${isExpanded ? 'active' : ''}`}
                        onClick={onToggleExpanded}
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
                                                            <ValueEdit
                                                                className="parameter-value"
                                                                display={`${currentValue.toFixed(cfg.step < 1 ? 1 : 0)}${cfg.unit}`}
                                                                editText={String(currentValue)}
                                                                value={currentValue}
                                                                min={cfg.min}
                                                                max={cfg.max}
                                                                step={cfg.step}
                                                                onChange={(next) => setParam(name, next)}
                                                                width={48}
                                                            />
                                                        </label>
                                                        <input
                                                            type="range"
                                                            min={cfg.min}
                                                            max={cfg.max}
                                                            step={cfg.step}
                                                            value={currentValue}
                                                            onChange={(e) => setParam(name, parseFloat(e.target.value))}
                                                            onDoubleClick={() => setParam(name, cfg.default)}
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
