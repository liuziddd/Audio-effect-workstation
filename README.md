# Audio Effect Workstation

浏览器端音频效果工作站：加载本地音频、串联实时效果器、AI 音轨分离、自动母带与响度交付。所有处理都在浏览器内完成，音频不会上传到服务器。

## 功能

- **实时效果器链**：参数均衡、压缩、失真等效果器可拖拽排序、旁路、逐项调参，基于 Tone.js 与原生 Web Audio。
- **AI 音轨分离**：HTDemucs 把一首乐曲分成人声、鼓、贝斯、其他乐器四轨，支持逐轨试听与 WAV 下载。
- **自动母带**：双引擎可选。DSP 引擎零下载即可使用；神经母带引擎由 ITO-Master 推理出 46 个参数，驱动参量 EQ、饱和、多频压缩、立体声成像与限制器链。按 ITU-R BS.1770-4 / EBU R128 测量积分响度、真峰值与响度范围，两遍归一化后导出 24-bit WAV。
- **音频分析**：BPM 与调性检测，展示置信度、备选结果和 12 音级分布。
- **播放器与导出**：胶囊进度条、指针拖动定位、横版音量、WAV 导出。
- **界面**：明暗主题、可拖拽分隔线与工具面板、编辑页实时等高线背景。

## 技术栈

React 18 · TypeScript 5 · Vite 4 · Tailwind CSS 3 · framer-motion · Tone.js / Web Audio · onnxruntime-web（WebGPU 优先、WASM 降级）· Web Worker。

## 本地运行

```bash
npm install
npm run dev        # http://localhost:3000
npx tsc --noEmit   # 类型检查
npm run build      # 生产构建
```

`vite.config.ts` 中的 `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` 响应头用于启用 `SharedArrayBuffer`，是多线程 WASM 推理的必要条件；`vercel.json` 已为线上部署配置相同的响应头。

## 模型

仓库不预置任何模型文件。AI 功能首次使用时，浏览器按需下载权重并缓存到 Cache API：

| 功能 | 模型 | 文件 |
| --- | --- | --- |
| AI 音轨分离 | HTDemucs | `htdemucs_embedded.onnx` |
| AI 神经母带 | ITO-Master | `fxencoder.onnx`、`mastering_tcn.onnx` |

下载器支持多源回退、Range 分片与分片级断点续传，下载中断后只补缺失分片。可通过构建环境变量 `VITE_MODELSCOPE_REPO`（值为 `owner/repo`）指定 ModelScope 公开仓库作为国内首选源；未配置时使用默认的 Hugging Face 源。

## 部署

在 Vercel 导入本仓库即可构建部署。若需启用国内模型源，在项目环境变量中添加 `VITE_MODELSCOPE_REPO` 后重新部署一次——Vite 在构建时注入该变量，仅重启服务不会生效。

## 许可

ITO-Master 模型权重及其配套 DSP 实现为 **CC BY-NC 4.0，仅限非商业使用**；HTDemucs 遵循其上游仓库许可。本项目为个人作品集项目，非商业用途。
