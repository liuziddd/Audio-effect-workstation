import { useState, useCallback } from 'react';
import { AudioFile } from '../types/audio';
import { validateAudioFile, testAudioPlayability } from '../utils/audioUtils';

export const useSimpleAudio = () => {
    const [audioFile, setAudioFile] = useState<AudioFile | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadAudioFile = useCallback(async (file: File) => {
        console.log('🎵 开始加载音频文件:', file.name);
        setIsLoading(true);
        setError(null);

        try {
            // 1. 基础验证
            const validation = validateAudioFile(file);
            if (!validation.valid) {
                throw new Error(validation.error);
            }

            // 2. 创建URL
            const url = URL.createObjectURL(file);

            // 3. 测试可播放性
            const playabilityTest = await testAudioPlayability(file);
            if (!playabilityTest.playable) {
                URL.revokeObjectURL(url);
                throw new Error(playabilityTest.error || '音频文件无法播放');
            }

            // 4. 设置音频文件
            const newAudioFile: AudioFile = {
                file,
                url,
                name: file.name,
                duration: playabilityTest.duration || 0,
                size: file.size
            };

            setAudioFile(newAudioFile);
            console.log('✅ 音频文件加载成功:', newAudioFile);

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : '加载失败';
            console.error('❌ 音频文件加载失败:', errorMessage);
            setError(errorMessage);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const clearAudioFile = useCallback(() => {
        if (audioFile?.url) {
            URL.revokeObjectURL(audioFile.url);
        }
        setAudioFile(null);
        setError(null);
    }, [audioFile]);

    return {
        audioFile,
        isLoading,
        error,
        loadAudioFile,
        clearAudioFile
    };
}; 