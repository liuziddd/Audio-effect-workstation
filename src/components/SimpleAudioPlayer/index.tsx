import React from 'react';
import { motion } from 'framer-motion';
import { AudioFile } from '../../types/audio';
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
    seek: (time: number) => void;
    setVolume: (volume: number) => void;
}

interface SimpleAudioPlayerProps {
    audioFile: AudioFile | null;
    controls?: AudioControls;
    className?: string;
    onClearAudio?: () => void;
    onSelectNewFile?: () => void;
}

const formatTime = (seconds: number): string => {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export const SimpleAudioPlayer: React.FC<SimpleAudioPlayerProps> = ({
    audioFile,
    controls,
    className = '',
    onClearAudio,
    onSelectNewFile
}) => {
    // 调试信息 - 显示时长信息
    React.useEffect(() => {
        if (audioFile && controls) {
            console.log('🎵 播放器时长信息:', {
                '原始文件时长': audioFile.duration,
                '控制器时长': controls.duration,
                '当前时间': controls.currentTime,
                '是否加载': controls.isLoaded
            });
        }
    }, [audioFile, controls]);

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

    // 优先使用控制器的时长（已经过修复），回退到原始文件时长
    const displayDuration = controls?.duration || audioFile.duration || 0;
    const displayCurrentTime = controls?.currentTime || 0;

    return (
        <motion.div
            className={`simple-audio-player ${className}`}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
        >
            {/* 文件信息 */}
            <div className="audio-info">
                <div className="file-icon">🎵</div>
                <div className="file-details">
                    <h3 className="file-name">{audioFile.name}</h3>
                    <p className="file-meta">
                        {(audioFile.size / (1024 * 1024)).toFixed(1)} MB •
                        {displayDuration ? ` ${formatTime(displayDuration)}` : ' 未知时长'}
                    </p>
                </div>
            </div>

            {/* 自定义音频播放器 */}
            {controls ? (
                <div className="custom-player">
                    {/* 播放控制按钮 */}
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
                    </div>

                    {/* 进度条 */}
                    <div className="progress-section">
                        <span className="time-display current-time">
                            {formatTime(displayCurrentTime)}
                        </span>

                        <div className="progress-bar-container">
                            <input
                                type="range"
                                min={0}
                                max={displayDuration || 0}
                                value={displayCurrentTime}
                                onChange={(e) => controls.seek(parseFloat(e.target.value))}
                                disabled={!controls.isLoaded}
                                className="progress-bar"
                                aria-label="音频播放进度控制"
                                title="拖动调整播放位置"
                            />
                        </div>

                        <span className="time-display total-time">
                            {formatTime(displayDuration)}
                        </span>
                    </div>

                    {/* 音量控制 */}
                    <div className="volume-section">
                        <span className="volume-icon">🔊</span>
                        <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={controls.volume}
                            onChange={(e) => controls.setVolume(parseFloat(e.target.value))}
                            className="volume-slider"
                            aria-label="音量控制"
                            title="调整播放音量"
                        />
                        <span className="volume-display">
                            {Math.round(controls.volume * 100)}%
                        </span>
                    </div>

                    {/* 状态指示器和文件操作 */}
                    <div className="status-section">
                        <div className="status-indicators">
                            {!controls.isLoaded && (
                                <span className="status loading">⏳ 加载中...</span>
                            )}
                            {controls.isLoaded && !controls.isPlaying && (
                                <span className="status ready">
                                    ✅ 就绪
                                </span>
                            )}
                            {controls.isPlaying && (
                                <span className="status playing">
                                    🎵 播放中
                                </span>
                            )}
                        </div>

                        {/* 文件操作按钮 */}
                        {(onClearAudio || onSelectNewFile) && (
                            <motion.div
                                className="file-actions"
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.3 }}
                            >
                                {onClearAudio && (
                                    <button
                                        onClick={onClearAudio}
                                        className="action-btn clear-btn"
                                        title="移除文件"
                                    >
                                        🗑️ 移除文件
                                    </button>
                                )}
                                {onSelectNewFile && (
                                    <button
                                        onClick={onSelectNewFile}
                                        className="action-btn select-btn"
                                        title="选择其他文件"
                                    >
                                        📁 选择其他文件
                                    </button>
                                )}
                            </motion.div>
                        )}
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