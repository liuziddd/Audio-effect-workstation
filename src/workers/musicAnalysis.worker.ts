/// <reference lib="webworker" />
/**
 * 音乐特征分析 Worker：谱通量节拍检测 + HPCP 调性检测都在独立线程跑，
 * 长音频不会阻塞 UI。PCM 以 transfer 方式零拷贝移交。
 */
import { analyzeMusic, type MusicAnalysis } from '../utils/musicFeatures';

type Request = {
    type: 'analyze';
    left: Float32Array;
    right: Float32Array;
    sampleRate: number;
};

type Response =
    | { type: 'stage'; progress: number; text: string }
    | { type: 'done'; result: MusicAnalysis }
    | { type: 'failed' };

const post = (message: Response) => self.postMessage(message);

self.addEventListener('message', (event: MessageEvent<Request>) => {
    const { type, left, right, sampleRate } = event.data;
    if (type !== 'analyze') return;
    post({ type: 'stage', progress: 0.15, text: '正在提取节拍与调性特征…' });
    try {
        const result = analyzeMusic(left, right, sampleRate);
        post({ type: 'done', result });
    } catch {
        post({ type: 'failed' });
    }
});
