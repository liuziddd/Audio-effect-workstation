import React, { useEffect, useRef, useState } from 'react';
import { Reorder } from 'framer-motion';
import { EffectConfig, EqBandData, ShaperPoint } from '../../types/audio';
import { startSweep } from '../../utils/sweepSelect';
import { EffectItem } from './EffectItem';
import './styles.css';

interface EffectChainProps {
    /** 链所属通道：拖拽投放与复制时用来标识落点 */
    channelId: string;
    effects: EffectConfig[];
    onReorderEffects: (effects: EffectConfig[]) => void;
    /** 删除：Shift 多选时一次删掉整组 */
    onRemoveEffects: (effectIds: string[]) => void;
    /** 开关：多选时整组同步成同一个状态 */
    onSetEffectsEnabled: (effectIds: string[], enabled: boolean) => void;
    onUpdateEffect: (effectId: string, parameters: Record<string, number>) => void;
    onUpdateEffectEqBands: (effectId: string, bands: EqBandData[]) => void;
    onUpdateEffectShaperPoints: (effectId: string, points: ShaperPoint[]) => void;
    /** 复制拖拽的落点：多个效果器按链里的顺序插入 */
    onCopyEffects: (effects: EffectConfig[], channelId: string, index: number) => void;
    /** 抽屉里由外层提供标题时关掉内建表头 */
    showHeader?: boolean;
    /** 按住了 Shift：整张卡片只是一个选项，内部控件全部锁住 */
    selectMode?: boolean;
}

export const EffectChain: React.FC<EffectChainProps> = ({
    channelId,
    effects,
    onReorderEffects,
    onRemoveEffects,
    onSetEffectsEnabled,
    onUpdateEffect,
    onUpdateEffectEqBands,
    onUpdateEffectShaperPoints,
    onCopyEffects,
    showHeader = true,
    selectMode = false,
}) => {
    /** Shift 选中的效果器：同名参数可以一起调，开关 / 展开 / 删除 / 复制也整组生效 */
    const [selected, setSelected] = useState<string[]>([]);
    /** 展开参数的效果器：提升到这里，多选时才能一起展开 / 收起 */
    const [expanded, setExpanded] = useState<string[]>([]);
    const rootRef = useRef<HTMLDivElement>(null);
    const selectedRef = useRef(selected);
    selectedRef.current = selected;
    const aliveRef = useRef(new Set<string>());
    aliveRef.current = new Set(effects.map((effect) => effect.id));

    useEffect(() => setSelected([]), [channelId]);
    useEffect(() => {
        const alive = new Set(effects.map((effect) => effect.id));
        setSelected((previous) => {
            const next = previous.filter((id) => alive.has(id));
            return next.length === previous.length ? previous : next;
        });
        setExpanded((previous) => {
            const next = previous.filter((id) => alive.has(id));
            return next.length === previous.length ? previous : next;
        });
    }, [effects]);

    /**
     * 和通道条同一套：单击收敛成只选这一张，它本来就是唯一选中时再点一下 = 取消。
     * Shift 单击是同一级的另一条路——按下那张当场切换、扫过哪张切哪张，见 sweepFrom。
     */
    const toggleSelect = (effectId: string) => {
        setSelected((previous) => (previous.length === 1 && previous[0] === effectId ? [] : [effectId]));
    };

    /**
     * 按住 Shift 按下某张卡片：整张卡片只是一个选项。按下那张当场切换，之后扫过哪张
     * 就切哪张——没选中的被选上、已选中的被取消，和通道条同一套、也和单击同一级。
     */
    const sweepFrom = (effectId: string) => (event: React.PointerEvent) => {
        event.preventDefault();
        const working = new Set(selectedRef.current);
        startSweep(
            effectId,
            (x, y) => {
                const hit = document.elementFromPoint(x, y)
                    ?.closest('[data-effect-id]') as HTMLElement | null;
                const id = hit?.dataset.effectId;
                // 只认本链自己的卡片：隔壁通道的链在同一屏里也算得着
                if (!hit || !id || !aliveRef.current.has(id) || !rootRef.current?.contains(hit)) return null;
                return id;
            },
            (id) => {
                if (working.delete(id)) {
                    setSelected([...working]);
                    return;
                }
                working.add(id);
                setSelected([...working]);
            },
        );
    };

    /** 这条效果器当前所属的操作组：多选里包含它就是整组，否则只有它自己 */
    const groupOf = (effectId: string) =>
        selected.length > 1 && selected.includes(effectId) ? selected : [effectId];

    /** 展开 / 收起：多选时整组一起开，已经全开就整组关 */
    const toggleExpanded = (effectId: string) => {
        const group = groupOf(effectId);
        const allOpen = group.every((id) => expanded.includes(id));
        setExpanded((previous) => (allOpen
            ? previous.filter((id) => !group.includes(id))
            : [...new Set([...previous, ...group])]));
    };

    // Reorder 回调返回新顺序的 id 数组，映射回 effects 并刷新 order 字段
    const handleReorder = (newOrder: string[]) => {
        const reordered = newOrder
            .map((id) => effects.find((effect) => effect.id === id))
            .filter((effect): effect is EffectConfig => Boolean(effect));
        onReorderEffects(reordered.map((effect, index) => ({ ...effect, order: index })));
    };

    return (
        <div
            ref={rootRef}
            className={`effect-chain ${selectMode ? 'select-mode' : ''}`}
            data-effect-dropzone
            data-channel-id={channelId}
        >
            {effects.length === 0 ? (
                <div className="empty-state">
                    <div className="empty-icon">🎛️</div>
                    <h3>效果器链为空</h3>
                    <p>从左侧效果器库拖拽到这里，或点击效果器直接添加</p>
                </div>
            ) : (
                <>
                    {showHeader && (
                        <div className="effect-chain-header">
                            <h3>🔄 效果器链</h3>
                            <div className="chain-info">
                                <span className="effect-count">{effects.length} 个效果器</span>
                            </div>
                        </div>
                    )}

                    <Reorder.Group
                        axis="y"
                        as="div"
                        values={effects.map((effect) => effect.id)}
                        onReorder={handleReorder}
                        className="effects-list"
                    >
                        {effects.map((effect, index) => {
                            const group = groupOf(effect.id);
                            const groupEffects = group
                                .map((id) => effects.find((item) => item.id === id))
                                .filter((item): item is EffectConfig => Boolean(item));
                            return (
                                <EffectItem
                                    key={effect.id}
                                    effect={effect}
                                    index={index}
                                    selected={selected.includes(effect.id)}
                                    expanded={expanded.includes(effect.id)}
                                    onSweep={sweepFrom(effect.id)}
                                    onSelect={() => toggleSelect(effect.id)}
                                    onToggleExpanded={() => toggleExpanded(effect.id)}
                                    onSetEnabled={() => onSetEffectsEnabled(group, !effect.enabled)}
                                    onRemove={() => onRemoveEffects(group)}
                                    onUpdate={(parameters) => onUpdateEffect(effect.id, parameters)}
                                    onUpdateEqBands={(bands) => onUpdateEffectEqBands(effect.id, bands)}
                                    onUpdateShaperPoints={(points) => onUpdateEffectShaperPoints(effect.id, points)}
                                    copyEffects={groupEffects}
                                    onCopyDrop={(targetChannel, targetIndex) => onCopyEffects(
                                        groupEffects,
                                        targetChannel,
                                        targetIndex,
                                    )}
                                />
                            );
                        })}
                    </Reorder.Group>
                </>
            )}
        </div>
    );
};
