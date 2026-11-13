/**
 * 应用内文件拖拽桥接。
 *
 * 背景：浏览器原生 HTML5 拖拽的 dataTransfer 无法传递通过 File System Access API
 * （FileSystemFileHandle.getFile()）得到的 File 对象——在 dragstart 里 items.add(File)
 * 添加的条目，drop 端通过 dataTransfer.files 读不到（返回空）。
 *
 * 因此侧边栏文件管理器拖出文件时，把真实 File 暂存到这里，上传位置 drop 时回读。
 * 外部文件（从操作系统文件管理器拖入）仍走 dataTransfer.files，不受影响。
 */
let pendingFile: File | null = null;

export const dragBridge = {
    /** 拖拽开始时暂存文件 */
    set(file: File) {
        pendingFile = file;
    },
    /** 读取当前拖拽中的文件（不清除，清除交由 dragend 统一处理） */
    peek(): File | null {
        return pendingFile;
    },
    /** 拖拽结束后清除 */
    clear() {
        pendingFile = null;
    },
};
