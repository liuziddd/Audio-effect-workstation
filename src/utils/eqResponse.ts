import { EqBandType } from '../types/audio';

/** 均衡器频段参数（用于频响计算） */
interface EqBand {
    type: EqBandType;
    freq: number;
    gain: number;
    q: number;
}

/** 计算单个双二阶滤波器的幅度响应（dB），基于 Audio EQ Cookbook 系数 */
const biquadResponse = (band: EqBand, sampleRate: number, f: number): number => {
    const A = Math.pow(10, band.gain / 40);
    const w0 = (2 * Math.PI * band.freq) / sampleRate;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * band.q);
    const sqrtA = Math.sqrt(A);

    let b0 = 0, b1 = 0, b2 = 0, a0 = 0, a1 = 0, a2 = 0;

    switch (band.type) {
        case 'lowpass':
            b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2;
            a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
            break;
        case 'highpass':
            b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
            a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
            break;
        case 'bandpass':
            b0 = alpha; b1 = 0; b2 = -alpha;
            a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
            break;
        case 'notch':
            b0 = 1; b1 = -2 * cos; b2 = 1;
            a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
            break;
        case 'peaking':
            b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A;
            a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
            break;
        case 'lowshelf':
            b0 = A * ((A + 1) - (A - 1) * cos + 2 * sqrtA * alpha);
            b1 = 2 * A * ((A - 1) - (A + 1) * cos);
            b2 = A * ((A + 1) - (A - 1) * cos - 2 * sqrtA * alpha);
            a0 = (A + 1) + (A - 1) * cos + 2 * sqrtA * alpha;
            a1 = -2 * ((A - 1) + (A + 1) * cos);
            a2 = (A + 1) + (A - 1) * cos - 2 * sqrtA * alpha;
            break;
        case 'highshelf':
            b0 = A * ((A + 1) + (A - 1) * cos + 2 * sqrtA * alpha);
            b1 = -2 * A * ((A - 1) + (A + 1) * cos);
            b2 = A * ((A + 1) + (A - 1) * cos - 2 * sqrtA * alpha);
            a0 = (A + 1) - (A - 1) * cos + 2 * sqrtA * alpha;
            a1 = 2 * ((A - 1) - (A + 1) * cos);
            a2 = (A + 1) - (A - 1) * cos - 2 * sqrtA * alpha;
            break;
    }

    b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;

    const w = (2 * Math.PI * f) / sampleRate;
    const cw = Math.cos(w);
    const cw2 = Math.cos(2 * w);
    const sw = Math.sin(w);
    const sw2 = Math.sin(2 * w);

    const reB = b0 + b1 * cw + b2 * cw2;
    const imB = -b1 * sw - b2 * sw2;
    const reA = 1 + a1 * cw + a2 * cw2;
    const imA = -a1 * sw - a2 * sw2;

    const magB = Math.sqrt(reB * reB + imB * imB);
    const magA = Math.sqrt(reA * reA + imA * imA);
    return 20 * Math.log10(magB / magA);
};

/** 计算多个频段叠加后的频率响应（dB），freqs 为采样频率数组 */
export const computeEqResponse = (bands: EqBand[], sampleRate: number, freqs: number[]): number[] =>
    freqs.map((f) => bands.reduce((sum, band) => sum + biquadResponse(band, sampleRate, f), 0));
