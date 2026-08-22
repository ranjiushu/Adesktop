#!/bin/bash
# =============================================================================
# verify-setup.sh — 验证 Gifski Web 环境设置
# =============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()   { echo -e "${GREEN}[OK]${NC}   $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }

echo "========================================"
echo "  Gifski Web 环境验证"
echo "========================================"
echo ""

# 1. 检查 Node.js
info "检查 Node.js..."
if command -v node &> /dev/null; then
  NODE_VERSION=$(node --version)
  ok "Node.js 已安装: $NODE_VERSION"
else
  fail "Node.js 未安装"
fi

# 2. 检查 npm
info "检查 npm..."
if command -v npm &> /dev/null; then
  NPM_VERSION=$(npm --version)
  ok "npm 已安装: $NPM_VERSION"
else
  fail "npm 未安装"
fi

# 3. 检查目录结构
info "检查目录结构..."
if [ -d "gifski-web" ]; then
  ok "gifski-web 目录存在"
else
  fail "gifski-web 目录不存在"
fi

if [ -f "gifski-web/index.html" ]; then
  ok "index.html 存在"
else
  fail "index.html 不存在"
fi

if [ -f "gifski-web/package.json" ]; then
  ok "package.json 存在"
else
  fail "package.json 不存在"
fi

# 4. 检查 node_modules
info "检查 npm 依赖..."
if [ -d "gifski-web/node_modules" ]; then
  ok "node_modules 存在"
  
  # 检查 gifski-wasm
  if [ -d "gifski-web/node_modules/gifski-wasm" ]; then
    ok "gifski-wasm 已安装"
  else
    warn "gifski-wasm 未安装，运行: cd gifski-web && npm install"
  fi
else
  warn "node_modules 不存在，运行: cd gifski-web && npm install"
fi

# 5. 检查 Android 项目
info "检查 Android 项目..."
if [ -d "android" ]; then
  ok "android 目录存在"
  
  if [ -f "android/gradlew" ]; then
    ok "gradlew 存在"
  else
    warn "gradlew 不存在"
  fi
  
  if [ -f "android/build-gifski.sh" ]; then
    ok "build-gifski.sh 存在"
  else
    warn "build-gifski.sh 不存在"
  fi
else
  fail "android 目录不存在"
fi

# 6. 检查 Android SDK
info "检查 Android SDK..."
if [ -n "$ANDROID_HOME" ]; then
  ok "ANDROID_HOME 已设置: $ANDROID_HOME"
  
  if [ -d "$ANDROID_HOME/platforms" ]; then
    ok "Android SDK 平台存在"
  else
    warn "Android SDK 平台不存在"
  fi
else
  warn "ANDROID_HOME 未设置"
fi

# 7. 运行 gifski-wasm 测试
info "测试 gifski-wasm..."
if [ -f "gifski-web/test-gifski.js" ]; then
  cd gifski-web
  if node test-gifski.js; then
    ok "gifski-wasm 测试通过"
  else
    fail "gifski-wasm 测试失败"
  fi
  cd ..
else
  warn "test-gifski.js 不存在"
fi

echo ""
echo "========================================"
echo "  验证完成"
echo "========================================"
echo ""
echo "下一步操作:"
echo "1. 如果有警告，请先解决依赖问题"
echo "2. 运行本地测试: cd gifski-web && node test-server.js"
echo "3. 构建 Android APK: cd android && bash build-gifski.sh"
echo ""