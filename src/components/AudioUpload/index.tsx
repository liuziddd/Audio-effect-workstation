import React, { useState, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { Upload, Music, FileAudio, X } from 'lucide-react';
import clsx from 'clsx';
import { validateAudioFile, formatFileSize, testAudioPlayability } from '../../utils/audioUtils';
import { dragBridge } from '../../utils/dragBridge';
import { Button } from '../UI/Button';

interface AudioUploadProps {
    onFileLoad: (file: File) => void;
    className?: string;
    disabled?: boolean;
    maxSize?: number; // in bytes
    supportedFormats?: string[];
}

export const AudioUpload: React.FC<AudioUploadProps> = ({
    onFileLoad,
    className = '',
    disabled = false,
    maxSize = 50 * 1024 * 1024, // 50MB
    supportedFormats = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/webm', 'audio/flac']
}) => {
    const [isDragOver, setIsDragOver] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFile = useCallback(async (file: File) => {
        setIsLoading(true);
        if (validateAudioFile(file) && await testAudioPlayability(file)) {
            setSelectedFile(file);
            onFileLoad(file);
        }
        setIsLoading(false);
    }, [onFileLoad]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);

        if (disabled || isLoading) return;

        const files = Array.from(e.dataTransfer.files);
        const file = files[0] ?? dragBridge.peek();
        if (file) {
            handleFile(file);
        }
    }, [disabled, isLoading, handleFile]);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        if (!disabled && !isLoading) {
            setIsDragOver(true);
        }
    }, [disabled, isLoading]);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
    }, []);

    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            handleFile(files[0]);
        }
    }, [handleFile]);

    const handleClick = useCallback(() => {
        if (disabled || isLoading) return;
        fileInputRef.current?.click();
    }, [disabled, isLoading]);

    const handleRemoveFile = useCallback(() => {
        setSelectedFile(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }, []);

    const formatSupportedFormats = (): string => {
        // 创建一个去重的格式列表，优先显示常见格式
        const formatMap = new Map([
            ['audio/mpeg', 'MP3'],
            ['audio/mp3', 'MP3'],
            ['audio/wav', 'WAV'],
            ['audio/ogg', 'OGG'],
            ['audio/mp4', 'M4A'],
            ['audio/aac', 'AAC'],
            ['audio/webm', 'WebM'],
            ['audio/flac', 'FLAC']
        ]);

        const uniqueFormats = new Set<string>();
        supportedFormats.forEach(format => {
            const displayFormat = formatMap.get(format);
            if (displayFormat) {
                uniqueFormats.add(displayFormat);
            }
        });

        return Array.from(uniqueFormats).join(', ');
    };

    return (
        <div className={clsx('w-full', className)}>
            {/* 文件上传区域 */}
            <motion.div
                className={clsx(
                    'drop-zone relative',
                    {
                        'drag-over': isDragOver,
                        'opacity-50 cursor-not-allowed': disabled || isLoading,
                        'cursor-pointer': !disabled && !isLoading
                    }
                )}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={handleClick}
                whileHover={!disabled && !isLoading ? { scale: 1.02 } : {}}
                whileTap={!disabled && !isLoading ? { scale: 0.98 } : {}}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept={supportedFormats.join(',')}
                    onChange={handleFileSelect}
                    className="hidden"
                    disabled={disabled || isLoading}
                    aria-label="选择音频文件上传"
                />

                <div className="flex flex-col items-center space-y-4">
                    {/* 图标 */}
                    <motion.div
                        className={clsx(
                            'p-6 rounded-full',
                            isDragOver ? 'bg-neon-blue bg-opacity-20' : 'bg-gray-800'
                        )}
                        animate={isDragOver ? { scale: 1.1 } : { scale: 1 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    >
                        {isLoading ? (
                            <motion.div
                                className="w-12 h-12 border-4 border-neon-blue border-t-transparent rounded-full"
                                animate={{ rotate: 360 }}
                                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                            />
                        ) : (
                            <Upload className={clsx(
                                'w-12 h-12',
                                isDragOver ? 'text-neon-blue' : 'text-gray-400'
                            )} />
                        )}
                    </motion.div>

                    {/* 文字 */}
                    <div className="text-center space-y-2">
                        <h3 className="text-lg font-semibold text-white">
                            {isLoading ? '正在处理文件...' :
                                selectedFile ? '文件已加载' : '上传音频文件'}
                        </h3>

                        {!selectedFile && !isLoading && (
                            <>
                                <p className="text-gray-400">
                                    拖拽文件到此处或 <span className="text-neon-blue">点击选择</span>
                                </p>
                                <p className="text-sm text-gray-500">
                                    支持格式: {formatSupportedFormats()} | 最大 {formatFileSize(maxSize)}
                                </p>
                            </>
                        )}
                    </div>

                    {/* 文件信息 */}
                    {selectedFile && !isLoading && (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex items-center space-x-3 bg-dark-surface rounded-lg p-4 border border-dark-border"
                        >
                            <FileAudio className="w-8 h-8 text-neon-green" />
                            <div className="flex-1 min-w-0">
                                <p className="text-white font-medium truncate">{selectedFile.name}</p>
                                <p className="text-gray-400 text-sm">
                                    {formatFileSize(selectedFile.size)} • {selectedFile.type.split('/')[1].toUpperCase()}
                                </p>
                            </div>
                            <Button
                                variant="orange"
                                size="sm"
                                onClick={handleRemoveFile}
                                className="flex-shrink-0"
                            >
                                <X className="w-4 h-4" />
                            </Button>
                        </motion.div>
                    )}
                </div>
            </motion.div>

            {/* 上传提示 */}
            {!selectedFile && (
                <div className="mt-4 p-4 bg-neon-blue bg-opacity-5 border border-neon-blue border-opacity-30 rounded-lg">
                    <div className="flex items-start space-x-2">
                        <Music className="w-5 h-5 text-neon-blue flex-shrink-0 mt-0.5" />
                        <div className="text-sm text-gray-300">
                            <p className="font-medium text-white mb-1">小贴士:</p>
                            <ul className="space-y-1 text-gray-400">
                                <li>• <strong>完全支持MP3格式</strong> - 兼容性最佳的选择</li>
                                <li>• 推荐使用高质量的音频文件 (WAV, FLAC) 获得最佳效果</li>
                                <li>• 文件加载后可以立即开始添加效果器</li>
                                <li>• 支持实时预览所有音频处理效果</li>
                            </ul>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}; 