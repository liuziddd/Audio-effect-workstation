import { useState } from 'react';
import { motion } from 'framer-motion';

interface MorphLogoProps {
    onClick?: () => void;
    size?: number;
    /** 转场进行中：图标复位成圆形，与遮罩的圆形揭示对齐 */
    active?: boolean;
}

/** 波形柱：x / y / height（宽 3、圆头 1.5，左右严格镜像，包围盒 48×48 保持 1:1） */
const BARS: [number, number, number][] = [
    [26.0, 47.6, 4.8],
    [31.625, 43.76, 12.48],
    [37.25, 37.52, 24.96],
    [42.875, 30.8, 38.4],
    [48.5, 26.0, 48.0],
    [54.125, 30.8, 38.4],
    [59.75, 37.52, 24.96],
    [65.375, 43.76, 12.48],
    [71.0, 47.6, 4.8],
];

/** 左上角 Logo：圆形底 + 内圈细环 + 居中波形（黑白随主题反色），悬停时外轮廓变圆角方形并旋转 */
export const MorphLogo = ({ onClick, size = 44, active = false }: MorphLogoProps) => {
    const [hovered, setHovered] = useState(false);
    const square = hovered && !active;

    return (
        <motion.button
            onClick={onClick}
            className="relative flex items-center justify-center"
            style={{ width: size, height: size }}
            whileTap={{ scale: 0.9 }}
            aria-label="切换页面"
        >
            <motion.div
                className="absolute inset-0"
                style={{
                    background: 'var(--text)',
                    boxShadow: '0 2px 10px rgba(0, 0, 0, 0.28)',
                }}
                onHoverStart={() => setHovered(true)}
                onHoverEnd={() => setHovered(false)}
                animate={{ borderRadius: square ? '26%' : '50%', rotate: square ? 90 : 0 }}
                transition={{ type: 'spring', stiffness: 320, damping: 22 }}
            />
            <svg viewBox="0 0 100 100" className="relative w-full h-full pointer-events-none" aria-hidden="true">
                <circle
                    cx="50"
                    cy="50"
                    r="31"
                    fill="none"
                    stroke="var(--bg)"
                    strokeOpacity={0.3}
                    strokeWidth={2}
                />
                {BARS.map(([x, y, height]) => (
                    <rect key={x} x={x} y={y} width={3} height={height} rx={1.5} fill="var(--bg)" />
                ))}
            </svg>
        </motion.button>
    );
};
