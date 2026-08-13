#!/usr/bin/env bash
# =============================================================================
# build-local.sh — 本地 APK 构建脚本（ARM64 / QEMU 转发方案，与 LexiCull 相同）
#
# 步骤: 1) build-web.sh → dist/desktop.bundle.html
#       2) minify-bundle.js → dist/desktop.bundle.min.html
#       3) 复制 min 产物 → android/app/src/main/assets/index.html
#       4) ./gradlew assembleDebug
#       5) 归档 APK 到 /workspace/AAA 安装包/
#
# 构建顺序不可变：build-web.sh → minify-bundle.js → Gradle（P0 铁律）
# 依赖: QEMU user-mode + x86_64 sysroot + Android SDK（见 LexiCull probe-build.sh）
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ANDROID_SDK_ROOT="${ANDROID_HOME:-/opt/android-sdk}"
BUILD_TOOLS_VERSION="34.0.0"
X86_64_SYSROOT="/opt/x86_64-sysroot"
AAA_DIR="/workspace/AAA 安装包"
APK_SRC="$SCRIPT_DIR/app/build/outputs/apk/debug/app-debug.apk"

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

# ── 步骤 1+2: 构建前端（顺序不可变） ──
info "步骤 1/5: build-web.sh"
bash "$PROJECT_DIR/tools/build-web.sh"

info "步骤 2/5: minify-bundle.js"
node "$PROJECT_DIR/tools/minify-bundle.js"

# ── 步骤 3: 同步产物到 assets ──
info "步骤 3/5: 同步产物到 assets"
ASSETS_DIR="$SCRIPT_DIR/app/src/main/assets"
mkdir -p "$ASSETS_DIR"
if [ -f "$PROJECT_DIR/dist/desktop.bundle.min.html" ]; then
  cp "$PROJECT_DIR/dist/desktop.bundle.min.html" "$ASSETS_DIR/index.html"
  ok "assets/index.html ← desktop.bundle.min.html ($(wc -c < "$ASSETS_DIR/index.html") bytes)"
else
  cp "$PROJECT_DIR/dist/desktop.bundle.html" "$ASSETS_DIR/index.html"
  ok "assets/index.html ← desktop.bundle.html ($(wc -c < "$ASSETS_DIR/index.html") bytes)"
fi

# ── 步骤 4: QEMU 包装器 + Gradle 构建 ──
info "步骤 4/5: Gradle 构建"
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
./gradlew assembleDebug --no-daemon

# ── 步骤 5: 归档 APK ──
info "步骤 5/5: 归档 APK"
if [ ! -f "$APK_SRC" ]; then
  fail "APK 未生成: $APK_SRC"
fi
mkdir -p "$AAA_DIR"
APK_NAME="Desktop_v0.1.0_$(date +%Y%m%d_%H%M%S).apk"
cp "$APK_SRC" "$AAA_DIR/$APK_NAME"
ok "已归档: $AAA_DIR/$APK_NAME"

echo ""
echo "══════════════════════════════"
echo "  构建完成"
echo "══════════════════════════════"
