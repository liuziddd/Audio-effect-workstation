import React, { useState } from 'react';
import { motion } from 'framer-motion';
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
        setIsExporting(true);
        await onExport(customFilename.trim() || undefined);
        setIsExporting(false);
    };

    return (
        <motion.div
            className={`audio-export border border-white/10 rounded-3xl p-6 shadow-2xl ${className}`}
            style={{ background: 'rgba(20, 20, 26, 0.55)', backdropFilter: 'blur(24px) saturate(140%)', WebkitBackdropFilter: 'blur(24px) saturate(140%)' }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
        >
            <label className="block text-sm font-medium text-white/80 mb-2">
                自定义文件名 (可选)
            </label>
            <input
                type="text"
                value={customFilename}
                onChange={(e) => setCustomFilename(e.target.value)}
                placeholder="例如: 我的音频作品.wav"
                className="w-full px-4 py-3 bg-dark-surface border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:border-neon-blue focus:ring-1 focus:ring-neon-blue transition-colors"
                disabled={!isEnabled}
                aria-label="导出文件名"
            />
            <p className="text-xs text-gray-500 mt-1">
                留空将使用默认命名：audio_export_时间戳.wav
            </p>

            <motion.div
                className="mt-4"
                whileHover={isEnabled ? { scale: 1.02 } : {}}
                whileTap={isEnabled ? { scale: 0.98 } : {}}
            >
                <Button
                    variant="green"
                    size="lg"
                    onClick={handleExport}
                    disabled={!isEnabled || isExporting}
                    className="w-full py-3 text-base font-semibold"
                >
                    {isExporting ? (
                        <div className="flex items-center justify-center gap-3">
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            <span>正在导出...</span>
                        </div>
                    ) : (
                        '导出为 WAV'
                    )}
                </Button>
            </motion.div>
        </motion.div>
    );
};
