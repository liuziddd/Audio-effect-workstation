/// <reference types="vite/client" />

declare module 'demucs-web' {
    export const CONSTANTS: {
        SAMPLE_RATE: number;
        TRACKS: string[];
        DEFAULT_MODEL_URL: string;
        [key: string]: unknown;
    };

    export class DemucsProcessor {
        constructor(options: {
            ort: unknown;
            modelPath?: string;
            sessionOptions?: Record<string, unknown>;
            onProgress?: (info: { progress: number; currentSegment: number; totalSegments: number }) => void;
            onLog?: (phase: string, message: string) => void;
            onDownloadProgress?: (loaded: number, total: number) => void;
        });
        loadModel(pathOrBuffer?: string | ArrayBuffer): Promise<unknown>;
        separate(left: Float32Array, right: Float32Array): Promise<Record<string, { left: Float32Array; right: Float32Array }>>;
    }
}
