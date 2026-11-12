import { motion } from 'framer-motion';

interface MorphLogoProps {
    onClick?: () => void;
    size?: number;
    /** 转场进行中时由圆角方形切换为圆形 */
    active?: boolean;
}

/** 左上角固定 Logo：默认圆角方形静止，悬停时仅外框旋转，点击转场时切换为圆形；中间的 ♪ 始终固定方向 */
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
                background: 'linear-gradient(135deg, #00d4ff 0%, #b84cff 55%, #39ff73 100%)',
                boxShadow: '0 0 26px rgba(0, 212, 255, 0.55)',
            }}
            animate={{ borderRadius: active ? '50%' : '26%' }}
            whileHover={{ rotate: 90 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        />
        <span
            className="relative font-black text-white select-none"
            style={{ fontSize: size * 0.42, lineHeight: 1 }}
        >
            ♪
        </span>
    </motion.button>
);
