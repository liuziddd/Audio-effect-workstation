import { useEffect, useState } from 'react';

/** Canvas 无法直接使用 CSS var()，从 <html> 上读取主题 token */
const read = (name: string, fallback: string): string =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export interface ThemeTokens {
    /** 画布底色 */
    canvas: string;
    /** 主网格线（轴线 / 0dB） */
    grid: string;
    /** 次级网格线 */
    gridSoft: string;
    /** 刻度文字 / 次要点 */
    tick: string;
    /** 强调色（曲线） */
    accent: string;
    /** 危险色（失真曲线） */
    danger: string;
    /** 控制点描边 */
    pointStroke: string;
    /** 选中点填充 */
    pointFill: string;
}

const readTokens = (): ThemeTokens => ({
    canvas: read('--surface', '#1A1A20'),
    grid: read('--surface-3', '#2C2C34'),
    gridSoft: read('--surface-2', '#222228'),
    tick: read('--text-faint', '#707070'),
    accent: read('--accent', '#2450FF'),
    danger: read('--danger', '#FF3B30'),
    pointStroke: read('--bg', '#0B0B0E'),
    pointFill: read('--text', '#ffffff'),
});

/** 订阅主题切换，返回当前 token（切主题时自动重渲染） */
export const useThemeTokens = (): ThemeTokens => {
    const [tokens, setTokens] = useState<ThemeTokens>(readTokens);

    useEffect(() => {
        const observer = new MutationObserver(() => setTokens(readTokens()));
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class'],
        });
        return () => observer.disconnect();
    }, []);

    return tokens;
};
