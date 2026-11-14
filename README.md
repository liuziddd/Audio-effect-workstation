# 声屿 · Sound Isle

**在线访问：[https://www.audiolyx.cn](https://www.audiolyx.cn)**

一间跑在浏览器里的录音棚：多轨混音、实时效果器与通道路由、AI 音轨分离、自动母带，以及按风格曲目库写和声与乐句的 MIDI 生成。
**全部处理在浏览器内完成，音频不上传服务器。**

## 功能

### 混音台

- 默认 8 条通道，可增删，通道条可横向拖动排序；每条通道独立的效果链、推子、声像、旁通 / 静音 / 独奏。
- 波形区即上传入口（点击或拖入文件），波形读的是分析器里的实时采样：推子推过 0 dB、加失真、削波平顶都会原样显示。
- 推子是 dB 分段标度（0 dB 在 80% 行程，顶端 +12 dB），推子后有一级 0 dBFS 硬削波，电平表是 -60~0 dBFS 的 dB 峰值表，过载时削波灯与波形同时标红。
- 通道间可建立单向路由：从通道条底部的路由点拖到另一条即可连线，信号会经过下游通道的推子与效果器；反向与环路会被拒绝，断线可连点两下清空或在该通道的路由输入窗里逐条断开。路由线跟随源通道的颜色，未上色时暗色主题为白线、亮色主题为黑线。
- 通道可命名、上色（30 色，整条通道条随颜色变化）、分组，也可固定在左侧不随滚动移出。
- 按住 Ctrl 拖动通道排序；按住 Shift 进入多选（参数锁定，按住扫过即逐条切换：没选中的选上、已选中的取消），选中后音量 / 声像按比例联动、旁通 / 静音 / 独奏同步，可整组分组或固定。
- 推子、声像、旋钮与滑块读数双击即可直接输入数值。
- 统一 transport、循环播放、导出 16-bit WAV 混音。

### 效果器（10 种）

混响、均衡器、滤波器、压缩器、限制器、噪声门、延迟、合唱、相位器、失真。
参数用旋钮调节，双击回默认值；EQ 有可交互频响曲线（点击加点、拖动调参、滚轮调 Q），失真有多点曲线编辑器，压缩 / 限制 / 噪声门有响应曲线。
效果器卡片可点击或拖拽加入效果链；按住 Shift 整张卡片进入多选（内部控件锁定，按住扫过即逐条切换选中），不按修饰键拖卡片头部即可排序。

### 实用工具（左侧栏，四个独立面板）

| 工具 | 说明 |
| --- | --- |
| 音频检测 | 文件规格、波形与频谱、客观指标（响度 / 真峰值 / 动态 / 削波 / 相位）与专业评价打分；BPM 与调性检测附置信度、备选结果与音级剖面 |
| AI 音轨分离 | HTDemucs 分离人声 / 鼓 / 贝斯 / 其他四轨，可逐轨试听与下载（180MB 模型首次使用时下载并缓存） |
| AI 自动母带 | DSP 与 ITO-Master 神经母带双引擎，自带上传；按 BS.1770-4 测量 LUFS-I、真峰值与 LRA，两遍归一化后导出 24-bit WAV |
| MIDI 生成 | 和声取自按风格收录的真实进行（王道 4536 / 小室 6451 / 卡农 / ii–V–I / 后门 ii–V / 12 小节蓝调 / 安达卢西亚…），四小节进行按「再现 + 终止式」铺成八小节，副属 / 借用 / 三全音替代按功能和声受约束地加花；和弦卡片一小节一个和弦整小节铺开、只交代走向，织体另按「动机 → 重复 → 模进 → 收束」写句，分分解 / 音型 / 副线三种，可试听、改速度、循环、导出 MIDI |

### 界面

单页锚定的首页（标题上移 → 功能卡浮现 → 个人信息）、明暗主题、可拖拽调宽的侧边栏、编辑页实时等高线背景与多层玻璃面板。
左上角常驻使用说明入口：点开从页面中心浮现操作指南，背景虚化，点外部 / Esc / 关闭键收起。

## 技术栈

React 18 · TypeScript 5 · Vite 4 · Tailwind CSS 3 · framer-motion 10 · Tone.js 14 / Web Audio ·
onnxruntime-web 1.31（WebGPU → WASM）· Web Worker · tonal

## 本地运行

```bash
npm install
npm run dev          # http://localhost:3000
npx tsc --noEmit     # 类型检查
npm run build        # 生产构建
npm run preview      # 预览构建产物
```

`vite.config.ts` 的 `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` 响应头是必需的：
onnxruntime-web 的多线程 WASM 依赖 `SharedArrayBuffer`（`crossOriginIsolated`）。如果你用自己的服务器托管构建产物，同样需要补上这两个头。

建议使用最新版 Chrome / Edge：AI 推理优先走 WebGPU，没有显卡时走 CPU（可用但明显更慢）。

## 目录结构

```
src/
  pages/        Home（首页）、Editor（编辑页与其玻璃样式）
  components/   Mixer（混音台 / 通道条 / 波形）、EffectLibrary、EffectChain、FileBrowser、
                AudioInspector、StemSeparator、AutoMaster、ProgressionLab、effects（背景与加载动效）
  hooks/        useMixer：多通道节点图、transport、效果链、声像、离线导出
  utils/        audioEffects、audioAnalysis、musicFeatures、autoMaster、loudness、itoDsp、
                modelDownload、progression（和声与织体引擎）、midi、wav
  workers/      分离推理、母带（神经 + DSP）、BPM / 调性分析
```

## 模型与许可

仓库不预置模型，首次使用时由浏览器下载并缓存到 Cache Storage，可多源回退、分片断点续传：

- AI 音轨分离：HTDemucs ONNX（约 180MB），遵循上游许可。
- 神经母带：ITO-Master 双 ONNX（`fxencoder` + `mastering_tcn`，约 368MB）。
  **权重与配套 DSP 实现为 CC BY-NC 4.0，仅限非商业使用**；DSP 智能母带引擎无此限制。

三个文件自托管在 ModelScope 公开仓库，作为首选源走境内 CDN；上游 hf-mirror 与 Hugging Face 原仓库作为兜底。
源地址写在 `src/utils/modelDownload.ts`，不依赖构建环境变量。

## 部署

Vercel 导入仓库即可，`vercel.json` 已配好构建命令与 COOP/COEP 响应头。
