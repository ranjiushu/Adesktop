#!/usr/bin/env bash
# =============================================================================
# build-gifski.sh — 本地 APK 构建脚本（Gifski Web 版本）
#
# 步骤: 1) 安装 gifski-web 依赖
#       2) 复制 gifski-web 产物 → android/app/src/main/assets/
#       3) ./gradlew assembleRelease（R8 裁剪 + debug keystore 签名）
#       4) 归档 APK 到 /workspace/AAA 安装包/（tools/collect-apk.sh，滚动保留最新 10 个 + R8 mapping）
#       5) COS bundle 周期备份（tools/cos-bundle-check.sh，每累计 25 个提交上传一次，幂等）
#
# 构建顺序：gifski-web → Gradle（P0 铁律）
# 依赖: QEMU user-mode + x86_64 sysroot + Android SDK（见 LexiCull probe-build.sh）
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ANDROID_SDK_ROOT="${ANDROID_HOME:-/opt/android-sdk}"
BUILD_TOOLS_VERSION="34.0.0"
X86_64_SYSROOT="/opt/x86_64-sysroot"

RED=''; GREEN=''; YELLOW=''; CYAN=''; NC=''
if [[ -t 1 ]]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
fi
info() { echo -e "${CYAN}[INFO]${NC} $1"; }
ok()   { echo -e "${GREEN}[OK]${NC}   $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }

# ── 步骤 0: 架构检查 ──
ARCH=$(uname -m)
if [ "$ARCH" != "aarch64" ]; then
  # x86_64 环境直接原生构建，无需 QEMU
  if [ "$ARCH" = "x86_64" ]; then
    ok "x86_64 原生构建"
  else
    fail "不支持的架构: $ARCH"
  fi
fi

# ── 步骤 1: 构建 gifski-web 模块 ──
info "步骤 1/5: 构建 gifski-web 模块"
GIFSKI_WEB_DIR="$PROJECT_DIR/gifski-web"

if [ ! -d "$GIFSKI_WEB_DIR" ]; then
  fail "gifski-web 目录不存在: $GIFSKI_WEB_DIR"
fi

cd "$GIFSKI_WEB_DIR"

# 安装依赖（如果 node_modules 不存在或 package.json 有更新）
if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules" ]; then
  info "  安装 npm 依赖"
  npm install --production
  ok "  npm 依赖安装完成"
else
  ok "  npm 依赖已是最新"
fi

# ── 步骤 2: 同步产物到 assets ──
info "步骤 2/5: 同步 gifski-web 到 assets"
ASSETS_DIR="$SCRIPT_DIR/app/src/main/assets"
mkdir -p "$ASSETS_DIR"

# 复制 gifski-web 的所有文件到 assets
cp -r "$GIFSKI_WEB_DIR"/* "$ASSETS_DIR/"
ok "  gifski-web 文件已复制到 assets"

# 确保 index.html 存在
if [ ! -f "$ASSETS_DIR/index.html" ]; then
  fail "index.html 不存在于 assets 目录"
fi

ok "assets/index.html 已就绪 ($(wc -c < "$ASSETS_DIR/index.html") bytes)"

# ── 步骤 3: QEMU 包装器 + Gradle 构建 ──
info "步骤 3/5: Gradle 构建"
cd "$SCRIPT_DIR"

# local.properties
if [ ! -f "$SCRIPT_DIR/local.properties" ]; then
  echo "sdk.dir=$ANDROID_SDK_ROOT" > "$SCRIPT_DIR/local.properties"
  ok "  创建 local.properties"
fi

# aapt2 覆盖（防止 AGP 下载不存在的 ARM64 版本）
AAPT2="$ANDROID_SDK_ROOT/build-tools/$BUILD_TOOLS_VERSION/aapt2"
if [ -f "$AAPT2" ] && ! grep -q "aapt2FromMavenOverride" "$SCRIPT_DIR/gradle.properties" 2>/dev/null; then
  echo "android.aapt2FromMavenOverride=$AAPT2" >> "$SCRIPT_DIR/gradle.properties"
  ok "  已添加 aapt2FromMavenOverride"
fi

# QEMU 包装器（仅 ARM64 且工具为 x86_64 二进制时需要）
if [ "$ARCH" = "aarch64" ] && [ -d "$ANDROID_SDK_ROOT/build-tools/$BUILD_TOOLS_VERSION" ]; then
  cd "$ANDROID_SDK_ROOT/build-tools/$BUILD_TOOLS_VERSION"
  for tool in aapt2 aapt zipalign; do
    if [ -f "$tool" ] && [ ! -f "$tool.real" ] && ! file "$tool" 2>/dev/null | grep -q "ELF.*ARM"; then
      mv "$tool" "$tool.real"
      cat > "$tool" << WRAPPER
#!/bin/bash
exec /usr/bin/qemu-x86_64-static -L $X86_64_SYSROOT ${ANDROID_SDK_ROOT}/build-tools/${BUILD_TOOLS_VERSION}/${tool}.real "\$@"
WRAPPER
      chmod +x "$tool"
      ok "  $tool: QEMU 包装器已创建"
    fi
  done
fi

cd "$SCRIPT_DIR"
./gradlew assembleRelease --no-daemon

# ── 步骤 4: 归档 APK（滚动保留最新 10 个 + R8 mapping） ──
info "步骤 4/5: 归档 APK"
bash "$SCRIPT_DIR/../tools/collect-apk.sh"

# ── 步骤 5: COS bundle 周期备份（每累计 25 个提交上传一次，幂等） ──
info "步骤 5/5: COS bundle 周期备份（每 25 个提交）"
bash "$SCRIPT_DIR/../tools/cos-bundle-check.sh"

echo ""
echo "══════════════════════════════"
echo "  Gifski APK 构建完成"
echo "══════════════════════════════"
echo "APK 位置: /workspace/AAA 安装包/"