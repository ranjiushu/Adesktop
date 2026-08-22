# Gifski Android 打包指南

## 概述

本指南将帮助你将 gifski 打包成独立的 Android 应用程序。我们采用 **WebView + WebAssembly** 方案，最大程度复用现有 Adesktop 项目的架构和构建流程。

## 架构优势

### 🎯 方案对比
| 方案 | 开发时间 | 性能 | 复杂度 | 复用性 |
|------|----------|------|--------|--------|
| **WebView + gifski-wasm** | **2-3 小时** | ⭐⭐⭐⭐ | ⭐ | ⭐⭐⭐⭐⭐ |
| 原生 JNI | 8-12 小时 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| 命令行打包 | 4-6 小时 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐ |

### ✅ 选择 WebView 方案的理由
1. **零 JNI 复杂度**：避免交叉编译 Rust → Android .so
2. **性能接近原生**：WebAssembly 多线程版本
3. **复用现有架构**：直接套用 Adesktop 的 WebView 壳
4. **跨平台一致**：同一套 Web 代码可在浏览器、Android、iOS 运行
5. **维护简单**：Web 技术栈，调试方便

## 前提条件

### 1. 开发环境
- **Node.js** ≥ 16.x
- **Android SDK** (已安装)
- **Android NDK** (可选，用于原生编译)
- **Rust 工具链** (可选，用于编译 gifski-wasm)

### 2. 现有项目
- **Adesktop 项目**：提供 WebView 壳和构建流程
- **gifski-web 模块**：本目录包含 Web 界面

## 快速开始

### 步骤 1：安装依赖
```bash
cd /workspace/Adesktop/gifski-web
npm install
```

### 步骤 2：本地测试
```bash
# 启动测试服务器
node test-server.js

# 访问 http://localhost:8080 测试功能
```

### 步骤 3：构建 Android APK
```bash
cd /workspace/Adesktop/android
bash build-gifski.sh
```

### 步骤 4：安装测试
```bash
# APK 位置
ls -la /workspace/AAA\ 安装包/

# 安装到设备
adb install /workspace/AAA\ 安装包/Adesktop-gifski-*.apk
```

## 项目结构

```
Adesktop/
├── gifski-web/                    # Gifski Web 模块
│   ├── index.html                # 主界面 (33KB)
│   ├── package.json              # 依赖配置
│   ├── test-server.js            # 本地测试服务器
│   ├── test-gifski.js            # gifski-wasm 测试
│   ├── README.md                 # 模块文档
│   └── PACKAGING_GUIDE.md        # 本文档
│
├── android/                      # Android 项目
│   ├── build-gifski.sh           # Gifski 专用构建脚本
│   ├── build-local.sh            # 原 Adesktop 构建脚本
│   └── app/src/main/assets/      # Web 资源目录
│
└── tools/                        # 构建工具
    ├── build-web.sh              # Web 构建脚本
    ├── collect-apk.sh            # APK 归档脚本
    └── cos-bundle-check.sh       # 备份脚本
```

## 技术细节

### 1. Web 技术栈
- **HTML5**: 语义化标签，响应式布局
- **CSS3**: 设计 token 系统，深色模式支持
- **JavaScript ES6+**: 模块化，异步处理
- **WebAssembly**: gifski-wasm 高性能编码

### 2. 设计系统
复用 Adesktop 设计 token：
```css
:root {
  --color-bg: #f5f6f8;
  --color-surface: #ffffff;
  --color-text: #1a1d21;
  --color-accent: #3b82f6;
  --space-md: 16px;
  --radius-md: 12px;
}
```

### 3. Android 集成
- **WebView 配置**: 启用 JavaScript，DOM 存储
- **文件访问**: 通过 Android 文件选择器
- **权限管理**: 仅存储权限（可选）
- **性能优化**: 硬件加速，内存管理

## 构建流程

### 详细步骤
1. **安装 npm 依赖**
   ```bash
   npm install --production
   ```

2. **复制 Web 资源**
   ```bash
   cp -r gifski-web/* android/app/src/main/assets/
   ```

3. **Gradle 构建**
   ```bash
   ./gradlew assembleRelease
   ```

4. **APK 签名**
   - 使用 debug keystore（开发）
   - 使用 release keystore（发布）

5. **APK 优化**
   - R8 代码裁剪
   - 资源压缩
   - 对齐优化

### 构建脚本
```bash
# 完整构建流程
bash build-gifski.sh

# 仅构建 Web 部分
cd gifski-web && npm install

# 仅构建 Android 部分
cd android && ./gradlew assembleRelease
```

## 功能特性

### 1. 文件支持
- **视频格式**: MP4, MOV, AVI, MKV
- **图片格式**: PNG, JPG, JPEG, GIF, WebP
- **批量处理**: 支持多文件选择

### 2. 编码参数
- **质量**: 1-100% (默认 90%)
- **宽度**: 128-1920px (默认 480px)
- **帧率**: 1-60 FPS (默认 20 FPS)

### 3. 用户体验
- **拖放上传**: 支持文件拖放
- **实时预览**: GIF 预览和下载
- **进度显示**: 编码进度实时反馈
- **响应式设计**: 适配各种屏幕尺寸

## 性能优化

### 1. WebAssembly 优化
- **多线程支持**: 自动检测并启用
- **内存管理**: 智能内存分配
- **编码优化**: 高质量算法

### 2. Android 优化
- **WebView 配置**: 硬件加速
- **内存管理**: 及时释放资源
- **电池优化**: 后台处理控制

## 调试和测试

### 1. Web 调试
```bash
# 启动开发服务器
node test-server.js

# 浏览器开发者工具
# F12 → Console/Network/Performance
```

### 2. Android 调试
```bash
# 查看日志
adb logcat | grep -i gifski

# 调试 WebView
chrome://inspect/#devices
```

### 3. 性能测试
- **编码速度**: 测试不同参数下的编码时间
- **内存使用**: 监控内存占用
- **电池消耗**: 测试长时间使用的影响

## 发布流程

### 1. 版本管理
```bash
# 更新版本号
# android/app/build.gradle
versionCode 2
versionName "1.1.0"
```

### 2. 签名配置
```bash
# 生成 keystore
keytool -genkey -v -keystore gifski.keystore \
  -alias gifski -keyalg RSA -keysize 2048 -validity 10000

# 配置签名
# android/app/build.gradle
signingConfigs {
    release {
        storeFile file("gifski.keystore")
        storePassword "your-password"
        keyAlias "gifski"
        keyPassword "your-password"
    }
}
```

### 3. 发布构建
```bash
# 构建发布版本
./gradlew assembleRelease

# 上传到应用商店
# Google Play Console / 其他商店
```

## 常见问题

### 1. WebAssembly 加载失败
**问题**: 页面显示 "正在初始化 gifski 引擎..."
**解决**: 检查网络连接，确保 CDN 可访问

### 2. 文件选择器不工作
**问题**: 点击选择文件没有反应
**解决**: 检查 Android 权限设置

### 3. 编码速度慢
**问题**: 转换大文件耗时很长
**解决**: 降低输出分辨率或质量

### 4. 内存不足
**问题**: 处理大文件时崩溃
**解决**: 分批处理或降低帧率

## 扩展开发

### 1. 添加新功能
- **批量处理**: 同时处理多个文件
- **模板保存**: 保存常用参数组合
- **历史记录**: 查看转换历史

### 2. 性能优化
- **Web Worker**: 后台编码处理
- **流式处理**: 边读取边编码
- **缓存优化**: 智能缓存管理

### 3. 用户体验
- **主题定制**: 更多主题选项
- **手势支持**: 滑动、缩放操作
- **语音控制**: 语音命令支持

## 许可证

本项目遵循 MIT 许可证。

### 依赖许可
- **gifski-wasm**: MIT License
- **Adesktop**: MIT License
- **其他依赖**: 详见 package.json

## 联系方式

- **项目地址**: /workspace/Adesktop/gifski-web
- **文档**: 本目录下的 .md 文件
- **问题反馈**: 通过 Git 提交 issue

---

**最后更新**: 2026年8月20日
**版本**: 1.0.0