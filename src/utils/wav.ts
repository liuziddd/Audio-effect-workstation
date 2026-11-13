/** 16-bit PCM WAV 编码与下载（无依赖，纯本地） */
const writeString = (view: DataView, offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
};

export const encodeWav = (left: Float32Array, right: Float32Array, sampleRate: number): Blob => {
    const length = Math.min(left.length, right.length);
    const dataSize = length * 2 * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 2, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 4, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < length; i++) {
        for (const ch of [left, right]) {
            const sample = Math.max(-1, Math.min(1, ch[i]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
            offset += 2;
        }
    }
    return new Blob([buffer], { type: 'audio/wav' });
};

/** 24-bit PCM WAV（母带交付规格，避免 16-bit 量化噪声抬高本底） */
export const encodeWav24 = (left: Float32Array, right: Float32Array, sampleRate: number): Blob => {
    const length = Math.min(left.length, right.length);
    const dataSize = length * 2 * 3;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 2, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 6, true);
    view.setUint16(32, 6, true);
    view.setUint16(34, 24, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < length; i++) {
        for (const ch of [left, right]) {
            const sample = Math.max(-1, Math.min(1, ch[i]));
            const v = Math.round(sample * 8388607);
            view.setUint8(offset, v & 0xff);
            view.setUint8(offset + 1, (v >> 8) & 0xff);
            view.setUint8(offset + 2, (v >> 16) & 0xff);
            offset += 3;
        }
    }
    return new Blob([buffer], { type: 'audio/wav' });
};

export const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
};
