# Audio Effect Workstation

浏览器端音频工作站：加载本地音频、串联实时效果器、AI 音轨分离、自动母带与 WAV 导出。全部处理在浏览器内完成，音频不上传服务器。

## 功能

- **效果器链**：均衡、压缩、失真等效果器拖拽排序、旁路、逐项调参（Tone.js / Web Audio）。
- **AI 音轨分离**：HTDemucs 分离人声、鼓、贝斯、其他乐器四轨，可逐轨试听与导出。
- **自动母带**：DSP 与 ITO-Master 神经母带双引擎；按 BS.1770-4 测量 LUFS-I、真峰值与 LRA，两遍归一化后导出 24-bit WAV。
- **音频分析**：BPM 与调性检测，附置信度、备选结果与音级分布。
- **界面**：明暗主题、可拖拽分隔线、编辑页实时等高线背景。

## 技术栈

React 18 · TypeScript · Vite · Tailwind CSS · framer-motion · Tone.js / Web Audio · onnxruntime-web（WebGPU → WASM）· Web Worker

## 本地运行

```bash
npm install
npm run dev        # http://localhost:3000
npm run build
```

COOP/COEP 响应头用于启用 `SharedArrayBuffer`，是多线程 WASM 推理的必要条件（`vite.config.ts` 与 `vercel.json` 均已配置）。

## 模型与许可

仓库不预置模型，首次使用时由浏览器下载并缓存：AI 音轨分离用 HTDemucs，神经母带用 ITO-Master 双 ONNX（`fxencoder` + `mastering_tcn`）。设置构建环境变量 `VITE_MODELSCOPE_REPO=owner/repo` 可指定国内模型源。

ITO-Master 权重与配套 DSP 实现为 **CC BY-NC 4.0，仅限非商业使用**；HTDemucs 遵循上游许可。

## 部署

Vercel 导入仓库即可；修改环境变量后需重新部署（Vite 在构建时注入）。
