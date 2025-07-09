import React from 'react';
import { motion } from 'framer-motion';
import clsx from 'clsx';

interface ButtonProps {
    children: React.ReactNode;
    onClick?: () => void;
    variant?: 'blue' | 'purple' | 'green' | 'orange';
    size?: 'sm' | 'md' | 'lg';
    disabled?: boolean;
    loading?: boolean;
    className?: string;
    type?: 'button' | 'submit' | 'reset';
}

export const Button: React.FC<ButtonProps> = ({
    children,
    onClick,
    variant = 'blue',
    size = 'md',
    disabled = false,
    loading = false,
    className = '',
    type = 'button'
}) => {
    const baseClasses = 'neon-button';

    const variantClasses = {
        blue: 'neon-button-blue',
        purple: 'neon-button-purple',
        green: 'neon-button-green',
        orange: 'neon-button-orange'
    };

    const sizeClasses = {
        sm: 'px-3 py-1.5 text-sm',
        md: 'px-6 py-3 text-base',
        lg: 'px-8 py-4 text-lg'
    };

    const buttonClasses = clsx(
        baseClasses,
        variantClasses[variant],
        sizeClasses[size],
        {
            'opacity-50 cursor-not-allowed': disabled || loading,
            'cursor-pointer': !disabled && !loading
        },
        className
    );

    return (
        <motion.button
            type={type}
            className={buttonClasses}
            onClick={onClick}
            disabled={disabled || loading}
            whileHover={!disabled && !loading ? { scale: 1.05 } : {}}
            whileTap={!disabled && !loading ? { scale: 0.95 } : {}}
            transition={{ type: 'spring', stiffness: 400, damping: 17 }}
        >
            {loading ? (
                <div className="flex items-center space-x-2">
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    <span>加载中...</span>
                </div>
            ) : (
                children
            )}
        </motion.button>
    );
}; 