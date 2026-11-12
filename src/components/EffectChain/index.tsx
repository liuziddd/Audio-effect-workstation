import React, { useState } from 'react';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
    restrictToVerticalAxis,
    restrictToParentElement,
} from '@dnd-kit/modifiers';
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

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            const oldIndex = effects.findIndex((effect) => effect.id === active.id);
            const newIndex = effects.findIndex((effect) => effect.id === over.id);

            if (oldIndex !== -1 && newIndex !== -1) {
                const reorderedEffects = arrayMove(effects, oldIndex, newIndex);
                const updatedEffects = reorderedEffects.map((effect, index) => ({
                    ...effect,
                    order: index,
                }));
                onReorderEffects(updatedEffects);
            }
        }
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
                    <p>从右侧效果器库拖拽效果器到这里，或直接点击效果器添加</p>
                </div>
            ) : (
                <>
                    <div className="effect-chain-header">
                        <h3>🔄 效果器链</h3>
                        <div className="chain-info">
                            <span className="effect-count">{effects.length} 个效果器</span>
                        </div>
                    </div>

                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                    >
                        <SortableContext
                            items={effects.map(effect => effect.id)}
                            strategy={verticalListSortingStrategy}
                        >
                            <div className="effects-list">
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
                            </div>
                        </SortableContext>
                    </DndContext>
                </>
            )}
        </div>
    );
};
