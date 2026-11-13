import { useState, useCallback, useRef } from 'react';
import { dragBridge } from '../../utils/dragBridge';
import './styles.css';

interface AudioEntry {
    name: string;
    handle: FileSystemFileHandle;
    file: File | null;
}

const AUDIO_RE = /\.(mp3|wav|ogg|m4a|aac|flac|webm|mp4)$/i;

export const FileBrowser = () => {
    const [entries, setEntries] = useState<AudioEntry[]>([]);
    const [dirName, setDirName] = useState('');
    const dirHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
    const supported = typeof (window as any).showDirectoryPicker === 'function';

    const scanDir = useCallback(async (handle: FileSystemDirectoryHandle) => {
        const list: AudioEntry[] = [];
        for await (const [name, entry] of (handle as any).entries()) {
            if (entry.kind === 'file' && AUDIO_RE.test(name)) {
                list.push({ name, handle: entry as FileSystemFileHandle, file: null });
            }
        }
        list.sort((a, b) => a.name.localeCompare(b.name));
        setEntries(list);
        await Promise.all(list.map(async (item) => {
            item.file = await item.handle.getFile();
        }));
        setEntries([...list]);
    }, []);

    const pickDirectory = async () => {
        const handle = await (window as any).showDirectoryPicker();
        dirHandleRef.current = handle;
        setDirName(handle.name);
        await scanDir(handle);
    };

    const refresh = async () => {
        if (!dirHandleRef.current) return;
        await scanDir(dirHandleRef.current);
    };

    const handleDragStart = (e: React.DragEvent, entry: AudioEntry) => {
        if (!entry.file) return;
        // 真实文件通过内存桥接暂存（dataTransfer 无法传递 File System Access API 的 File）
        dragBridge.set(entry.file);
        // 附带文件名作为拖拽标识，供上传区读取提示
        e.dataTransfer.setData('application/x-audio-name', entry.name);
        e.dataTransfer.effectAllowed = 'copy';
    };

    const handleDragEnd = () => {
        // drop 事件先于 dragend 触发；用微任务延迟清除，确保上传区已读走文件
        setTimeout(() => dragBridge.clear(), 0);
    };

    if (!supported) {
        return (
            <div className="file-browser">
                <p className="fb-message">
                    当前浏览器不支持访问本地文件夹，请直接将音频文件拖拽到中间的音频上传区域。
                </p>
            </div>
        );
    }

    return (
        <div className="file-browser">
            <div className="fb-toolbar">
                <button className="fb-btn" onClick={pickDirectory}>
                    {dirName ? `📁 ${dirName}` : '选择文件夹'}
                </button>
                {dirName && <button className="fb-btn ghost" onClick={refresh}>↻ 刷新</button>}
            </div>

            {entries.length > 0 && (
                <ul className="fb-list">
                    {entries.map((entry) => (
                        <li
                            key={entry.name}
                            className="fb-item"
                            draggable={!!entry.file}
                            onDragStart={(e) => handleDragStart(e, entry)}
                            onDragEnd={handleDragEnd}
                            title={`${entry.name}（拖拽到上传区域加载）`}
                        >
                            <span className="fb-icon">🎵</span>
                            <span className="fb-name">{entry.name}</span>
                        </li>
                    ))}
                </ul>
            )}

            {dirName && entries.length === 0 && (
                <p className="fb-empty">该文件夹内没有可用的音频文件。</p>
            )}

            {!dirName && (
                <p className="fb-hint">选择一个本地文件夹，即可浏览其中的音频文件，拖拽到中间上传区域加载。</p>
            )}
        </div>
    );
};
