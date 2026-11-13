/**
 * 迭代 radix-2 FFT 与常用窗函数。
 * 频谱显示、频谱质心、节拍/调性分析共用同一实现，避免重复定义。
 */
export const fft = (re: Float32Array, im: Float32Array): void => {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            const tr = re[i]; re[i] = re[j]; re[j] = tr;
            const ti = im[i]; im[i] = im[j]; im[j] = ti;
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = (-2 * Math.PI) / len;
        const wRe = Math.cos(ang);
        const wIm = Math.sin(ang);
        const half = len >> 1;
        for (let i = 0; i < n; i += len) {
            let cr = 1;
            let ci = 0;
            for (let k = 0; k < half; k++) {
                const a = i + k;
                const b = a + half;
                const vRe = re[b] * cr - im[b] * ci;
                const vIm = re[b] * ci + im[b] * cr;
                re[b] = re[a] - vRe;
                im[b] = im[a] - vIm;
                re[a] += vRe;
                im[a] += vIm;
                const nr = cr * wRe - ci * wIm;
                ci = cr * wIm + ci * wRe;
                cr = nr;
            }
        }
    }
};

export const hann = (n: number): Float32Array => {
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    return w;
};

/** 4 项 Blackman-Harris（约 −92dB 旁瓣），谱峰挑选时能压住强峰泄漏 */
export const blackmanHarris = (n: number): Float32Array => {
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const x = (2 * Math.PI * i) / (n - 1);
        w[i] = 0.35875 - 0.48829 * Math.cos(x) + 0.14128 * Math.cos(2 * x) - 0.01168 * Math.cos(3 * x);
    }
    return w;
};
