import { useEffect, useState } from 'react';

/**
 * 手机端判定：宽度小于 768（竖屏）或高度小于 600（横屏手机）都算手机。
 * 只看宽度的话，844×390 的横屏手机会被当成桌面，露出整套混音台。
 */
const QUERY = '(max-width: 767px), (max-height: 599px)';

/**
 * 用来切「编辑页精简布局」与工具面板的定位 / 动效：
 * 这些差异牵涉 inline style 与 framer-motion 的初始值，纯 CSS 覆盖不了。
 */
export const useIsMobile = () => {
    const [mobile, setMobile] = useState(() => window.matchMedia(QUERY).matches);

    useEffect(() => {
        const media = window.matchMedia(QUERY);
        const update = () => setMobile(media.matches);
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, []);

    return mobile;
};
