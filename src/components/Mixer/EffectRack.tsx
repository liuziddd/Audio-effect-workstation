import { X } from 'lucide-react';
import { EffectConfig, EqBandData, ShaperPoint } from '../../types/audio';
import { MixerChannel } from '../../hooks/useMixer';
import { EffectChain } from '../EffectChain';

interface EffectRackProps {
    channel: MixerChannel;
    onClose: () => void;
    onReorderEffects: (effects: EffectConfig[]) => void;
    onRemoveEffects: (effectIds: string[]) => void;
    onSetEffectsEnabled: (effectIds: string[], enabled: boolean) => void;
    onUpdateEffect: (effectId: string, parameters: Record<string, number>) => void;
    onUpdateEffectEqBands: (effectId: string, bands: EqBandData[]) => void;
    onUpdateEffectShaperPoints: (effectId: string, points: ShaperPoint[]) => void;
    /** 复制拖拽落到本通道时的处理 */
    onCopyEffects: (effects: EffectConfig[], channelId: string, index: number) => void;
    /** 按住了 Ctrl：链里的卡片只做多选 */
    selectMode: boolean;
    /** 动一下这个面板，就把侧栏效果器库的投放目标切到本通道 */
    onFocus: () => void;
}

/** 通道效果器面板：作为通道条的内联邻居向右展开，与通道条同高、内部滚动 */
export const EffectRack = ({
    channel,
    onClose,
    onReorderEffects,
    onRemoveEffects,
    onSetEffectsEnabled,
    onUpdateEffect,
    onUpdateEffectEqBands,
    onUpdateEffectShaperPoints,
    onCopyEffects,
    selectMode,
    onFocus,
}: EffectRackProps) => (
    <div className="mixer-rack" onPointerDown={onFocus}>
        <div className="mixer-rack-head">
            <div className="mixer-rack-title">
                <strong>{channel.label}</strong>
                <span className="mixer-rack-track">
                    {channel.trackName || '未加载音频'} · {channel.effects.length} 个效果器
                </span>
            </div>
            <button className="strip-kill" style={{ opacity: 1 }} onClick={onClose} title="收起">
                <X className="w-4 h-4" />
            </button>
        </div>

        <div className="mixer-rack-chain">
            <EffectChain
                channelId={channel.id}
                effects={channel.effects}
                showHeader={false}
                onReorderEffects={onReorderEffects}
                onRemoveEffects={onRemoveEffects}
                onSetEffectsEnabled={onSetEffectsEnabled}
                onUpdateEffect={onUpdateEffect}
                onUpdateEffectEqBands={onUpdateEffectEqBands}
                onUpdateEffectShaperPoints={onUpdateEffectShaperPoints}
                onCopyEffects={onCopyEffects}
                selectMode={selectMode}
            />
        </div>
    </div>
);
