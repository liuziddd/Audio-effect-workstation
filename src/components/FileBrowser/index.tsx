import { useState, useCallback, useRef } from 'react';
import './styles.css';

interface AudioEntry {
    name: string;
    handle: FileSystemFileHandle;
    file: File | null;
}

const AUDIO_RE = /\.(mp3|wav|ogg|m4a|aac|flac|webm|mp4)$/i;

interface FileBrowserProps {
    onLoadFile: (file: File) => void;
}

export const FileBrowser = ({ onLoadFile }: FileBrowserProps) => {
    const [entries, setEntries] = useState<AudioEntry[]>([]);
    const [dirName, setDirName] = useState('');
    const [message, setMessage] = useState('');
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
        // 并行预取 File 对象，供拖拽携带真实文件
        await Promise.all(list.map(async (item) => {
            try { item.file = await item.handle.getFile(); } catch { /* 忽略单个文件失败 */ }
        }));
        setEntries([...list]);
    }, []);

    const pickDirectory = async () => {
        try {
            const handle = await (window as any).showDirectoryPicker();
            dirHandleRef.current = handle;
            setDirName(handle.name);
            setMessage('');
            await scanDir(handle);
        } catch (error) {
            if ((error as any)?.name !== 'AbortError') {
                setMessage('无法访问该文件夹，请重试或换一个文件夹。');
            }
        }
    };

    const refresh = async () => {
        if (!dirHandleRef.current) return;
        setMessage('');
        await scanDir(dirHandleRef.current);
    };

    const handleDragStart = (e: React.DragEvent, entry: AudioEntry) => {
        if (!entry.file) return;
        e.dataTransfer.setData('application/x-audio-name', entry.name);
        try { e.dataTransfer.items.add(entry.file); } catch { /* 某些环境不支持 items.add */ }
        e.dataTransfer.effectAllowed = 'copy';
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

            {message && <p className="fb-message">{message}</p>}

            {entries.length > 0 && (
                <ul className="fb-list">
                    {entries.map((entry) => (
                        <li
                            key={entry.name}
                            className="fb-item"
                            draggable={!!entry.file}
                            onDragStart={(e) => handleDragStart(e, entry)}
                            onClick={() => entry.file && onLoadFile(entry.file)}
                            title={`${entry.name}（点击加载 / 拖拽到中间）`}
                        >
                            <span className="fb-icon">🎵</span>
                            <span className="fb-name">{entry.name}</span>
                        </li>
                    ))}
                </ul>
            )}

            {dirName && entries.length === 0 && !message && (
                <p className="fb-empty">该文件夹内没有可用的音频文件。</p>
            )}

            {!dirName && (
                <p className="fb-hint">选择一个本地文件夹，即可浏览其中的音频文件，点击或拖拽到中间加载。</p>
            )}
        </div>
    );
};
