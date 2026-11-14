import { useEffect, useRef, useState } from 'react';

interface ValueEditProps {
    /** 当前真实值，双击进入编辑时作为输入框初值 */
    value: number;
    min: number;
    max: number;
    step?: number;
    /** 非编辑状态下显示的文本（含单位） */
    display: string;
    onChange: (value: number) => void;
    /** 自定义文本解析：返回 null 表示这次输入作废 */
    parse?: (text: string) => number | null;
    /** 输入框里初值的写法，默认取 value 本身 */
    editText?: string;
    className?: string;
    title?: string;
    /** 输入框宽（px） */
    width?: number;
}

/**
 * 数值读数：平时是一行小字，双击原地变成输入框。
 * 单位不参与输入，回车 / 失焦提交，Esc 放弃。
 */
export const ValueEdit = ({
    value,
    min,
    max,
    step = 0.01,
    display,
    onChange,
    parse,
    editText,
    className,
    title = '双击输入数值',
    width = 44,
}: ValueEditProps) => {
    const [editing, setEditing] = useState(false);
    const [text, setText] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!editing) return;
        const node = inputRef.current;
        node?.focus();
        node?.select();
    }, [editing]);

    const start = () => {
        setText(editText ?? String(Number(value.toFixed(3))));
        setEditing(true);
    };

    const commit = () => {
        const parsed = parse ? parse(text) : Number(text.trim());
        setEditing(false);
        if (parsed === null || !Number.isFinite(parsed)) return;
        const clamped = Math.min(max, Math.max(min, parsed));
        onChange(Math.round(clamped / step) * step);
    };

    if (editing) {
        return (
            <input
                ref={inputRef}
                className={`value-edit ${className ?? 'value-text'}`}
                style={{ width }}
                value={text}
                inputMode="decimal"
                spellCheck={false}
                onChange={(event) => setText(event.target.value)}
                onBlur={commit}
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') commit();
                    if (event.key === 'Escape') setEditing(false);
                }}
            />
        );
    }

    return (
        <span
            className={className ?? 'value-text'}
            title={title}
            onDoubleClick={(event) => {
                event.stopPropagation();
                start();
            }}
        >
            {display}
        </span>
    );
};
