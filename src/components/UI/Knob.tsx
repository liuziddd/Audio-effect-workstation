import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import clsx from 'clsx';

interface KnobProps {
    value: number;
    min: number;
    max: number;
    step?: number;
    onChange: (value: number) => void;
    label?: string;
    unit?: string;
    size?: 'sm' | 'md' | 'lg';
    color?: 'blue' | 'purple' | 'green' | 'orange';
    disabled?: boolean;
    showValue?: boolean;
    className?: string;
}

export const Knob: React.FC<KnobProps> = ({
    value,
    min,
    max,
    step = 0.01,
    onChange,
    label,
    unit = '',
    size = 'md',
    color = 'blue',
    disabled = false,
    showValue = true,
    className = ''
}) => {
    const [isDragging, setIsDragging] = useState(false);
    const [startY, setStartY] = useState(0);
    const [startValue, setStartValue] = useState(0);
    const knobRef = useRef<HTMLDivElement>(null);

    const normalizedValue = (value - min) / (max - min);
    const rotation = normalizedValue * 270 - 135; // -135° to 135° range

    const sizeClasses = {
        sm: 'w-12 h-12',
        md: 'w-16 h-16',
        lg: 'w-20 h-20'
    };

    const colorClasses = {
        blue: 'border-neon-blue',
        purple: 'border-neon-purple',
        green: 'border-neon-green',
        orange: 'border-neon-orange'
    };

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (disabled) return;

        e.preventDefault();
        setIsDragging(true);
        setStartY(e.clientY);
        setStartValue(value);
        document.body.style.cursor = 'ns-resize';
    }, [disabled, value]);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isDragging || disabled) return;

        const deltaY = startY - e.clientY;
        const sensitivity = 0.01;
        const deltaValue = deltaY * sensitivity * (max - min);
        const newValue = Math.max(min, Math.min(max, startValue + deltaValue));
        const steppedValue = Math.round(newValue / step) * step;

        onChange(steppedValue);
    }, [isDragging, disabled, startY, startValue, min, max, step, onChange]);

    const handleMouseUp = useCallback(() => {
        setIsDragging(false);
        document.body.style.cursor = '';
    }, []);

    const handleWheel = useCallback((e: React.WheelEvent) => {
        if (disabled) return;

        e.preventDefault();
        const delta = -e.deltaY * 0.01;
        const newValue = Math.max(min, Math.min(max, value + delta));
        const steppedValue = Math.round(newValue / step) * step;

        onChange(steppedValue);
    }, [disabled, value, min, max, step, onChange]);

    useEffect(() => {
        if (isDragging) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);

            return () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [isDragging, handleMouseMove, handleMouseUp]);

    const formatValue = (val: number): string => {
        if (Math.abs(val) >= 1000) {
            return (val / 1000).toFixed(1) + 'k';
        }
        return val.toFixed(step < 1 ? 2 : 0);
    };

    return (
        <div className={clsx('flex flex-col items-center space-y-2', className)}>
            {label && (
                <label className="text-xs text-gray-400 font-medium no-select">
                    {label}
                </label>
            )}

            <div className="relative">
                <motion.div
                    ref={knobRef}
                    className={clsx(
                        'knob-container relative cursor-pointer no-select',
                        sizeClasses[size]
                    )}
                    onMouseDown={handleMouseDown}
                    onWheel={handleWheel}
                    whileHover={!disabled ? { scale: 1.05 } : {}}
                    whileTap={!disabled ? { scale: 0.95 } : {}}
                >
                    <div
                        className={clsx(
                            'knob relative',
                            colorClasses[color],
                            {
                                'opacity-50 cursor-not-allowed': disabled,
                                'hover:shadow-neon': !disabled
                            }
                        )}
                        style={{
                            transform: `rotate(${rotation}deg)`,
                            transition: isDragging ? 'none' : 'transform 0.1s ease-out'
                        }}
                    >
                        {/* 指针 */}
                        <div
                            className={clsx(
                                'absolute w-0.5 h-4 rounded-full top-1 left-1/2 transform -translate-x-1/2',
                                `bg-${color === 'blue' ? 'neon-blue' : color === 'purple' ? 'neon-purple' : color === 'green' ? 'neon-green' : 'neon-orange'}`
                            )}
                        />

                        {/* 中心点 */}
                        <div className="absolute w-2 h-2 bg-gray-800 rounded-full top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2" />
                    </div>

                    {/* 刻度标记 */}
                    <div className="absolute inset-0">
                        {Array.from({ length: 11 }, (_, i) => {
                            const angle = -135 + (i * 27); // 每27度一个刻度
                            return (
                                <div
                                    key={i}
                                    className="absolute w-0.5 h-1 bg-gray-600"
                                    style={{
                                        top: '10%',
                                        left: '50%',
                                        transformOrigin: '50% 200%',
                                        transform: `translateX(-50%) rotate(${angle}deg)`
                                    }}
                                />
                            );
                        })}
                    </div>
                </motion.div>

                {/* 拖拽指示器 */}
                {isDragging && (
                    <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 text-xs text-neon-blue bg-gray-900 px-2 py-1 rounded">
                        {formatValue(value)}{unit}
                    </div>
                )}
            </div>

            {showValue && (
                <div className="text-xs text-center text-gray-300 no-select min-w-[3rem]">
                    {formatValue(value)}{unit}
                </div>
            )}
        </div>
    );
}; 