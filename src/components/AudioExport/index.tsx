import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Download, FileAudio, Music } from 'lucide-react';
import { Button } from '../UI/Button';

interface AudioExportProps {
    onExport: (filename?: string) => Promise<void>;
    isEnabled: boolean;
    className?: string;
}

export const AudioExport: React.FC<AudioExportProps> = ({
    onExport,
    isEnabled,
    className = ''
}) => {
    const [customFilename, setCustomFilename] = useState('');
    const [isExporting, setIsExporting] = useState(false);

    const handleExport = async () => {
        if (!isEnabled) return;

        try {
            setIsExporting(true);
            const filename = customFilename.trim() || undefined;
            await onExport(filename);
            console.log('✅ WAV导出完成');
        } catch (error) {
            console.error('导出失败:', error);
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <motion.div
            className={`audio-export bg-gradient-to-br from-gray-900 to-gray-800 border border-gray-700 rounded-xl p-6 shadow-2xl ${className}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
        >
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold bg-gradient-to-r from-neon-green to-neon-blue bg-clip-text text-transparent flex items-center gap-2">
                    <Download className="w-6 h-6 text-neon-green" />
                    音频导出 (WAV格式)
                </h3>
                <div className="text-sm text-gray-400">
                    {isEnabled ? '✅ 已就绪' : '⏳ 等待音频'}
                </div>
            </div>

            {/* 格式说明 */}
            <div className="mb-6 p-4 bg-neon-blue bg-opacity-10 border border-neon-blue border-opacity-30 rounded-lg">
                <div className="flex items-center gap-3">
                    <span className="text-2xl">🎧</span>
                    <div>
                        <div className="font-semibold text-white">WAV 无损格式</div>
                        <div className="text-sm text-gray-400">高品质音频，适合专业制作</div>
                    </div>
                </div>
            </div>

            {/* 文件名输入 */}
            <div className="mb-6">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                    自定义文件名 (可选)
                </label>
                <div className="relative">
                    <input
                        type="text"
                        value={customFilename}
                        onChange={(e) => setCustomFilename(e.target.value)}
                        placeholder="例如: 我的音频作品.wav"
                        className="w-full px-4 py-3 bg-dark-surface border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:border-neon-blue focus:ring-1 focus:ring-neon-blue transition-colors"
                        disabled={!isEnabled}
                        aria-label="导出文件名"
                    />
                    <FileAudio className="absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-500" />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                    留空将使用默认命名：audio_export_时间戳.wav
                </p>
            </div>

            {/* 导出按钮 */}
            <motion.div
                whileHover={isEnabled ? { scale: 1.02 } : {}}
                whileTap={isEnabled ? { scale: 0.98 } : {}}
            >
                <Button
                    variant="green"
                    size="lg"
                    onClick={handleExport}
                    disabled={!isEnabled || isExporting}
                    className="w-full py-4 text-lg font-semibold"
                >
                    {isExporting ? (
                        <div className="flex items-center justify-center gap-3">
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            <span>正在导出...</span>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center gap-3">
                            <Download className="w-5 h-5" />
                            <span>导出为 WAV</span>
                        </div>
                    )}
                </Button>
            </motion.div>

            {/* 提示信息 */}
            <div className="mt-4 p-3 bg-neon-green bg-opacity-5 border border-neon-green border-opacity-30 rounded-lg">
                <div className="flex items-start gap-2">
                    <Music className="w-4 h-4 text-neon-green flex-shrink-0 mt-0.5" />
                    <div className="text-xs text-gray-300">
                        <p className="font-medium text-white mb-1">导出说明:</p>
                        <ul className="space-y-1 text-gray-400">
                            <li>• <strong>WAV格式</strong>: 无损音质，保持最高品质</li>
                            <li>• 导出的音频包含当前添加的所有效果器处理</li>
                            <li>• 大文件导出可能需要几秒钟时间</li>
                            <li>• 适合专业音频制作和后期处理</li>
                        </ul>
                    </div>
                </div>
            </div>
        </motion.div>
    );
}; 