import { motion } from 'framer-motion';

interface MorphLogoProps {
    onClick?: () => void;
    size?: number;
    /** 转场进行中时由圆角方形切换为圆形 */
    active?: boolean;
}

/** 左上角固定 Logo：黑白反色（暗色主题白底黑符、亮色主题黑底白符），无渐变 */
export const MorphLogo = ({ onClick, size = 44, active = false }: MorphLogoProps) => (
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
            animate={{ borderRadius: active ? '50%' : '26%' }}
            whileHover={{ rotate: 90 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        />
        <span
            className="relative font-black select-none"
            style={{ fontSize: size * 0.42, lineHeight: 1, color: 'var(--bg)' }}
        >
            ♪
        </span>
    </motion.button>
);
