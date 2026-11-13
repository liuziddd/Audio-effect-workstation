import React, { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { AudioFile } from '../../types/audio';
import { dragBridge } from '../../utils/dragBridge';
import { HorizontalGauge } from '../UI/HorizontalGauge';
import './styles.css';

interface AudioControls {
    isPlaying: boolean;
    isLoaded: boolean;
    currentTime: number;
    duration: number;
    volume: number;
    play: () => Promise<void>;
    pause: () => void;
    stop: () => void;
    beginSeek: () => void;
    previewSeek: (time: number) => void;
    seek: (time: number) => void;
    setVolume: (volume: number) => void;
}

interface SimpleAudioPlayerProps {
    audioFile: AudioFile | null;
    controls?: AudioControls;
    className?: string;
    onClearAudio?: () => void;
    onReplaceFile?: (file: File) => void;
}

const formatTime = (seconds: number): string => {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const isAudioFile = (file: File) =>
    file.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac|webm|mp4)$/i.test(file.name);

export const SimpleAudioPlayer: React.FC<SimpleAudioPlayerProps> = ({
    audioFile,
    controls,
    className = '',
    onClearAudio,
    onReplaceFile,
}) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const progressRef = useRef<HTMLDivElement>(null);
    const seekingRef = useRef(false);
    const [isDragOver, setIsDragOver] = useState(false);

    const pickFile = () => fileInputRef.current?.click();

    const handleFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) onReplaceFile?.(file);
        event.target.value = '';
    };

    const handleDrop = (event: React.DragEvent) => {
        event.preventDefault();
        event.stopPropagation();
        setIsDragOver(false);
        const file = Array.from(event.dataTransfer.files).find(isAudioFile) ?? dragBridge.peek();
        if (file) onReplaceFile?.(file);
    };

    if (!audioFile) {
        return (
            <motion.div
                className={`simple-audio-player ${className}`}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
            >
                <div className="no-audio-message">
                    <div className="icon">🎵</div>
                    <h3>等待音频文件</h3>
                    <p>请先上传一个音频文件来开始播放</p>
                </div>
            </motion.div>
        );
    }

    const displayDuration = controls?.duration || audioFile.duration || 0;
    const displayCurrentTime = controls?.currentTime || 0;
    const progressRatio = displayDuration > 0 ? Math.min(1, Math.max(0, displayCurrentTime / displayDuration)) : 0;

    // 根据指针 x 坐标换算为播放时间（0 ~ duration）
    const timeFromClientX = (clientX: number) => {
        const el = progressRef.current;
        if (!el || !displayDuration) return 0;
        const rect = el.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        return ratio * displayDuration;
    };

    const onProgressPointerDown = (e: React.PointerEvent) => {
        if (!controls?.isLoaded) return;
        seekingRef.current = true;
        controls.beginSeek();
        controls.previewSeek(timeFromClientX(e.clientX));
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };

    const onProgressPointerMove = (e: React.PointerEvent) => {
        if (!seekingRef.current || !controls) return;
        controls.previewSeek(timeFromClientX(e.clientX));
    };

    const onProgressPointerUp = (e: React.PointerEvent) => {
        if (!seekingRef.current || !controls) return;
        seekingRef.current = false;
        controls.seek(timeFromClientX(e.clientX));
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        }
    };

    return (
        <motion.div
            className={`simple-audio-player ${className}`}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
        >
            <input
                ref={fileInputRef}
                type="file"
                accept="audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/mp4,audio/aac,audio/webm,audio/flac,.mp3,.wav,.ogg,.m4a,.aac,.webm,.flac"
                onChange={handleFileInput}
                className="hidden"
            />

            {/* 上传位置：音频信息区，可拖拽文件到此处替换，或点击选择文件 */}
            <div
                className={`audio-info upload-zone${isDragOver ? ' drag-over' : ''}`}
                onClick={pickFile}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }}
                onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false);
                }}
                onDrop={handleDrop}
                title="拖拽音频文件到此处替换，或点击选择其他文件"
            >
                <div className="file-icon">🎵</div>
                <div className="file-details">
                    <h3 className="file-name">{audioFile.name}</h3>
                    <p className="file-meta">
                        {(audioFile.size / (1024 * 1024)).toFixed(1)} MB •
                        {displayDuration ? ` ${formatTime(displayDuration)}` : ' 未知时长'}
                    </p>
                </div>
                <span className="replace-hint">🔄 拖拽/点击替换</span>
            </div>

            {/* 自定义音频播放器 */}
            {controls ? (
                <div className="custom-player">
                    {/* 播放控制按钮 + 状态 + 移除文件 */}
                    <div className="player-controls">
                        <button
                            onClick={controls.stop}
                            disabled={!controls.isLoaded}
                            className="control-btn stop-btn"
                            title="停止"
                        >
                            ⏹️
                        </button>

                        <button
                            onClick={controls.isPlaying ? controls.pause : controls.play}
                            disabled={!controls.isLoaded}
                            className="control-btn play-btn"
                            title={controls.isPlaying ? "暂停" : "播放"}
                        >
                            {controls.isPlaying ? '⏸️' : '▶️'}
                        </button>

                        {!controls.isLoaded && (
                            <span className="status loading">⏳ 加载中...</span>
                        )}
                        {controls.isLoaded && !controls.isPlaying && (
                            <span className="status ready">✅ 就绪</span>
                        )}
                        {controls.isPlaying && (
                            <span className="status playing">🎵 播放中</span>
                        )}

                        {onClearAudio && (
                            <button
                                onClick={onClearAudio}
                                className="remove-file-btn"
                                title="移除文件"
                            >
                                🗑️ 移除文件
                            </button>
                        )}
                    </div>

                    {/* 进度条：CallChip 风格胶囊 + 从左侧擦过的填充层 */}
                    <div className="progress-section">
                        <span className="time-display current-time">
                            {formatTime(displayCurrentTime)}
                        </span>

                        <div
                            ref={progressRef}
                            className="progress-track"
                            onPointerDown={onProgressPointerDown}
                            onPointerMove={onProgressPointerMove}
                            onPointerUp={onProgressPointerUp}
                            onPointerCancel={onProgressPointerUp}
                            role="slider"
                            aria-label="音频播放进度控制"
                            aria-valuemin={0}
                            aria-valuemax={Math.round(displayDuration)}
                            aria-valuenow={Math.round(displayCurrentTime)}
                            title="拖动调整播放位置"
                        >
                            <span className="progress-fill" style={{ transform: `scaleX(${progressRatio})` }} />
                        </div>

                        <span className="time-display total-time">
                            {formatTime(displayDuration)}
                        </span>
                    </div>

                    {/* 音量控制：横版液体 gauge（细长） */}
                    <div className="volume-section">
                        <span className="volume-icon">🔊</span>
                        <HorizontalGauge
                            value={Math.round(controls.volume * 100)}
                            onChange={(v) => controls.setVolume(v / 100)}
                            liquidColor="var(--accent)"
                            glassColor="var(--surface-3)"
                            width={180}
                            height={16}
                            radius={8}
                            ariaLabel="音量控制"
                        />
                        <span className="volume-display">
                            {Math.round(controls.volume * 100)}%
                        </span>
                    </div>
                </div>
            ) : (
                /* 回退到基础播放器 */
                <div className="basic-player">
                    <audio
                        src={audioFile.url}
                        controls
                        className="basic-audio-element"
                    />
                </div>
            )}

            {/* 播放提示 */}
            <div className="play-hint">
                <p>💡 提示：调整效果器参数可以实时听到变化</p>
            </div>
        </motion.div>
    );
};
