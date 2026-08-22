# Gifski Web UI

高质量 GIF 转换器，基于 [gifski-wasm](https://github.com/jamsinclair/gifski-wasm) 技术。

## 功能特性

- 🎬 支持视频和图片序列转换为 GIF
- 🎨 高质量 GIF 编码，每帧支持数千种颜色
- ⚙️ 可调节质量、宽度、帧率参数
- 📱 响应式设计，支持移动端
- 🌙 支持深色模式（跟随系统）
- 💾 一键下载生成的 GIF

## 技术栈

- **前端**: 原生 HTML/CSS/JavaScript
- **编码引擎**: gifski-wasm (WebAssembly)
- **设计系统**: 复用 Adesktop 设计 token

## 快速开始

### 1. 安装依赖
```bash
cd gifski-web
npm install
```

### 2. 本地开发
```bash
npm run dev
# 访问 http://localhost:8080
```

### 3. 构建 Android APK
```bash
cd ../android
bash build-gifski.sh
```

## 文件结构

```
gifski-web/
├── index.html          # 主界面
├── package.json        # 依赖配置
└── README.md          # 本文档
```

## 设计规范

### 颜色系统
- 主背景: `#f5f6f8`
- 卡片背景: `#ffffff`
- 主文字: `#1a1d21`
- 次要文字: `#6b7280`
- 强调色: `#3b82f6` (蓝色)

### 字体栈
```css
-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif
```

### 间距系统
- `--space-xs`: 4px
- `--space-sm`: 8px
- `--space-md`: 16px
- `--space-lg`: 24px
- `--space-xl`: 32px

### 圆角系统
- `--radius-sm`: 8px
- `--radius-md`: 12px
- `--radius-lg`: 16px

## 浏览器支持

- Chrome 57+
- Firefox 52+
- Safari 11+
- Edge 16+

## 许可证

MIT License - 详见 [gifski-wasm 许可证](https://github.com/jamsinclair/gifski-wasm/blob/main/LICENSE)