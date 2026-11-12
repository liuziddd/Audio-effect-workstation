import React, { useState } from 'react';
import { Reorder } from 'framer-motion';
import { EffectConfig, EffectType, EqBandData, ShaperPoint } from '../../types/audio';
import { EffectItem } from './EffectItem';
import './styles.css';

interface EffectChainProps {
    effects: EffectConfig[];
    onAddEffect: (effectType: EffectType) => void;
    onReorderEffects: (effects: EffectConfig[]) => void;
    onRemoveEffect: (effectId: string) => void;
    onToggleEffect: (effectId: string) => void;
    onUpdateEffect: (effectId: string, parameters: Record<string, number>) => void;
    onUpdateEffectEqBands: (effectId: string, bands: EqBandData[]) => void;
    onUpdateEffectShaperPoints: (effectId: string, points: ShaperPoint[]) => void;
}

const EFFECT_DRAG_MIME = 'application/x-effect-type';

export const EffectChain: React.FC<EffectChainProps> = ({
    effects,
    onAddEffect,
    onReorderEffects,
    onRemoveEffect,
    onToggleEffect,
    onUpdateEffect,
    onUpdateEffectEqBands,
    onUpdateEffectShaperPoints,
}) => {
    const [isDragOver, setIsDragOver] = useState(false);

    // Reorder 回调返回新顺序的 id 数组，映射回 effects 并刷新 order 字段
    const handleReorder = (newOrder: string[]) => {
        const reordered = newOrder
            .map((id) => effects.find((effect) => effect.id === id))
            .filter((effect): effect is EffectConfig => Boolean(effect));
        onReorderEffects(reordered.map((effect, index) => ({ ...effect, order: index })));
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        if (!e.dataTransfer.types.includes(EFFECT_DRAG_MIME)) return;
        e.preventDefault();
        setIsDragOver(true);
    };

    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDragOver(false);
        }
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragOver(false);
        const type = e.dataTransfer.getData(EFFECT_DRAG_MIME) as EffectType;
        if (type) onAddEffect(type);
    };

    return (
        <div
            className={`effect-chain${isDragOver ? ' drop-target' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {effects.length === 0 ? (
                <div className="empty-state">
                    <div className="empty-icon">🎛️</div>
                    <h3>效果器链为空</h3>
                    <p>从效果器库拖拽效果器到这里，或直接点击效果器添加</p>
                </div>
            ) : (
                <>
                    <div className="effect-chain-header">
                        <h3>🔄 效果器链</h3>
                        <div className="chain-info">
                            <span className="effect-count">{effects.length} 个效果器</span>
                        </div>
                    </div>

                    <Reorder.Group
                        axis="y"
                        as="div"
                        values={effects.map((effect) => effect.id)}
                        onReorder={handleReorder}
                        className="effects-list"
                    >
                        {effects.map((effect, index) => (
                            <EffectItem
                                key={effect.id}
                                effect={effect}
                                index={index}
                                onRemove={() => onRemoveEffect(effect.id)}
                                onToggle={() => onToggleEffect(effect.id)}
                                onUpdate={(parameters) => onUpdateEffect(effect.id, parameters)}
                                onUpdateEqBands={(bands) => onUpdateEffectEqBands(effect.id, bands)}
                                onUpdateShaperPoints={(points) => onUpdateEffectShaperPoints(effect.id, points)}
                            />
                        ))}
                    </Reorder.Group>
                </>
            )}
        </div>
    );
};
