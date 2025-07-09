import React from 'react';
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
import { EffectConfig } from '../../types/audio';
import { EffectItem } from './EffectItem';
import './styles.css';

interface EffectChainProps {
    effects: EffectConfig[];
    onReorderEffects: (effects: EffectConfig[]) => void;
    onRemoveEffect: (effectId: string) => void;
    onToggleEffect: (effectId: string) => void;
    onBypassEffect: (effectId: string) => void;
    onUpdateEffect: (effectId: string, parameters: Record<string, number>) => void;
}

export const EffectChain: React.FC<EffectChainProps> = ({
    effects,
    onReorderEffects,
    onRemoveEffect,
    onToggleEffect,
    onBypassEffect,
    onUpdateEffect,
}) => {
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
                // 更新order字段
                const updatedEffects = reorderedEffects.map((effect, index) => ({
                    ...effect,
                    order: index,
                }));
                onReorderEffects(updatedEffects);
            }
        }
    };

    if (effects.length === 0) {
        return (
            <div className="effect-chain-empty">
                <div className="empty-state">
                    <div className="empty-icon">🎛️</div>
                    <h3>效果器链为空</h3>
                    <p>从左侧效果器库中添加效果器开始制作音乐</p>
                </div>
            </div>
        );
    }

    return (
        <div className="effect-chain">
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
                                onBypass={() => onBypassEffect(effect.id)}
                                onUpdate={(parameters) => onUpdateEffect(effect.id, parameters)}
                            />
                        ))}
                    </div>
                </SortableContext>
            </DndContext>
        </div>
    );
}; 