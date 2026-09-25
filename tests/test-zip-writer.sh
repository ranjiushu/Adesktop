#!/usr/bin/env bash
# ZipWriter JVM 直测：javac 编译纯 JVM 的 ZipWriter + harness，产出 zip 后双重校验
# （unzip -t 做 CRC 交叉验证 + python zipfile 解压比对，后者对非 ASCII 条目名保真）。
# 覆盖：目录递归 / 空文件 / 空目录 / 中文名 / 大文件流式 / STORED（仅存储）/ 取消 / 空源拒绝。
# 用法: bash tests/test-zip-writer.sh   （由 run-tests.sh 调用）
# ============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="$(cd "$SCRIPT_DIR/.." && pwd)"
ZIPWRITER="$PROJECT/android/app/src/main/java/com/ranjiushu/adesktop/ZipWriter.java"

RED=''; GREEN=''; NC=''
[[ -t 1 ]] && { RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'; }
ok()   { echo -e "${GREEN}[ok]${NC} $1"; }
fail() { echo -e "${RED}[fail]${NC} $1"; exit 1; }

command -v javac > /dev/null || fail "缺少 javac（zip 写出器直测需要 JDK）"
command -v unzip > /dev/null || fail "缺少 unzip（zip 产物校验需要）"
[[ -f "$ZIPWRITER" ]] || fail "找不到 ZipWriter.java: $ZIPWRITER"

TMP="$(mktemp -d /tmp/zip-writer-test.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

# ── harness（与 ZipWriter 同包，包级访问）：建 fixture → 三种场景写 zip ──
cat > "$TMP/ZipHarness.java" <<'JAVA'
package com.ranjiushu.adesktop;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.Random;

public class ZipHarness {

    /** 纯 JVM 的 Node 适配（File → ZipWriter.Node，与 ZipEngine.FileNode 同构） */
    static class FileNode extends ZipWriter.Node {
        final File f;
        FileNode(File f) { this.f = f; }
        String name() { return f.getName(); }
        boolean isDir() { return f.isDirectory(); }
        long size() { return f.isFile() ? f.length() : 0; }
        long lastModified() { return f.lastModified(); }
        InputStream open() throws IOException { return new FileInputStream(f); }
        ZipWriter.Node[] children() {
            File[] cs = f.listFiles();
            if (cs == null) return new ZipWriter.Node[0];
            ZipWriter.Node[] out = new ZipWriter.Node[cs.length];
            for (int i = 0; i < cs.length; i++) out[i] = new FileNode(cs[i]);
            return out;
        }
    }

    /** 记录型监听：进度调用计数；可配置第 N 次 progress 后抛取消 */
    static class Rec implements ZipWriter.Listener {
        int progressCalls = 0;
        int cancelAfter = -1;
        public void entryStart(String path) throws IOException { checkCancel(); }
        public void tick() throws IOException { checkCancel(); }
        public void progress(String path, long done, long total) throws IOException {
            progressCalls++;
            checkCancel();
        }
        void checkCancel() throws IOException {
            if (cancelAfter >= 0 && progressCalls > cancelAfter) throw new IOException("操作已取消");
        }
    }

    public static void main(String[] args) throws Exception {
        File work = new File(args[0]);
        File fixture = new File(work, "fixture");
        // fixture: 目录递归 + 空文件 + 空目录 + 中文名 + 大文件（流式路径）
        write(new File(fixture, "top.txt"), "hello top\n");
        write(new File(fixture, "dir1/a.txt"), "aaa 中文内容\n");
        write(new File(fixture, "dir1/sub/b.bin"), random(300 * 1024));
        write(new File(fixture, "dir2/empty.txt"), new byte[0]);
        new File(fixture, "dir3").mkdirs();                       // 空目录
        write(new File(fixture, "中文 目录/文件 名.txt"), "unicode ok\n");
        File big = new File(fixture, "dir1/big.bin");
        write(big, random(2 * 1024 * 1024 + 12345));              // 非整块尺寸

        // 场景 1：DEFLATED（标准级别）
        Rec r1 = new Rec();
        File out1 = new File(work, "out-deflated.zip");
        try (OutputStream os = new FileOutputStream(out1)) {
            ZipWriter.write(os, new ZipWriter.Node[] { new FileNode(fixture) }, 6, r1);
        }
        System.out.println("WROTE " + out1.getName() + " progress=" + r1.progressCalls);

        // 场景 2：STORED（仅存储）
        Rec r2 = new Rec();
        File out2 = new File(work, "out-stored.zip");
        try (OutputStream os = new FileOutputStream(out2)) {
            ZipWriter.write(os, new ZipWriter.Node[] { new FileNode(fixture) }, ZipWriter.LEVEL_STORE, r2);
        }
        System.out.println("WROTE " + out2.getName() + " progress=" + r2.progressCalls);

        // 场景 3：写入中取消 → 抛「操作已取消」
        Rec r3 = new Rec();
        r3.cancelAfter = 0;
        try {
            try (OutputStream os = new FileOutputStream(new File(work, "out-cancel.zip"))) {
                ZipWriter.write(os, new ZipWriter.Node[] { new FileNode(fixture) }, 6, r3);
            }
            System.out.println("CANCEL-MISS 没有抛出取消异常");
            System.exit(1);
        } catch (IOException e) {
            if ("操作已取消".equals(e.getMessage())) {
                System.out.println("CANCEL-OK");
            } else {
                System.out.println("CANCEL-WRONG " + e.getMessage());
                System.exit(1);
            }
        }

        // 场景 4：空源拒绝（不产出空归档）
        try {
            try (OutputStream os = new FileOutputStream(new File(work, "out-empty.zip"))) {
                ZipWriter.write(os, new ZipWriter.Node[0], 6, new Rec());
            }
            System.out.println("EMPTY-MISS 没有拒绝空源");
            System.exit(1);
        } catch (IOException e) {
            if ("没有可压缩的内容".equals(e.getMessage())) {
                System.out.println("EMPTY-OK");
            } else {
                System.out.println("EMPTY-WRONG " + e.getMessage());
                System.exit(1);
            }
        }
    }

    static void write(File f, String s) throws IOException {
        write(f, s.getBytes(StandardCharsets.UTF_8));
    }

    static void write(File f, byte[] b) throws IOException {
        f.getParentFile().mkdirs();
        Files.write(f.toPath(), b);
    }

    static byte[] random(int n) {
        byte[] b = new byte[n];
        new Random(42).nextBytes(b);
        return b;
    }
}
JAVA

javac -encoding UTF-8 -d "$TMP/classes" "$ZIPWRITER" "$TMP/ZipHarness.java" \
  || fail "javac 编译 ZipWriter/harness 失败"
ok "ZipWriter + harness 编译通过"

java -cp "$TMP/classes" com.ranjiushu.adesktop.ZipHarness "$TMP" > "$TMP/run.log" 2>&1 \
  || { cat "$TMP/run.log"; fail "harness 运行失败"; }
grep -q '^WROTE out-deflated.zip' "$TMP/run.log" || fail "DEFLATED 场景未产出"
grep -q '^WROTE out-stored.zip' "$TMP/run.log" || fail "STORED 场景未产出"
grep -q '^CANCEL-OK' "$TMP/run.log" || fail "取消场景未按约定中止（应抛「操作已取消」）"
grep -q '^EMPTY-OK' "$TMP/run.log" || fail "空源场景未拒绝"
ok "harness 四场景（写出/写出/取消/空源）行为符合预期"

# ── 产物校验：unzip -t（结构 + CRC 交叉验证）+ python zipfile（解压与内容比对）──
# 注意：本沙盒 Info-ZIP unzip 对非 ASCII 条目名转码失真（zip 的 UTF-8 标志位 0x800 正常，
# python zipfile 读出无损），故解压与条目断言走 python zipfile，unzip 只做 CRC 交叉验证。
for kind in deflated stored; do
  unzip -t "$TMP/out-$kind.zip" > /dev/null 2>&1 || fail "unzip -t 校验 out-$kind.zip 失败"
  rm -rf "$TMP/ext-$kind" && mkdir -p "$TMP/ext-$kind"
  python3 - "$TMP/out-$kind.zip" "$TMP/ext-$kind" <<'PY' || fail "python zipfile 解压 out-$kind.zip 失败"
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
bad = z.testzip()
assert bad is None, 'CRC 校验失败: %r' % bad
z.extractall(sys.argv[2])
PY
  # 归档顶层条目 = fixture 目录自身（工具惯例），故解压结果含 fixture/ 一层
  diff -r "$TMP/ext-$kind/fixture" "$TMP/fixture" > /dev/null 2>&1 \
    || fail "解压内容与源不一致（out-$kind.zip）"
done
ok "unzip -t + 解压 diff：两种级别产物内容均与源一致"

# ── 方法断言：STORED 全部 Stored；DEFLATED 存在 Deflated ──
python3 - "$TMP/out-deflated.zip" "$TMP/out-stored.zip" <<'PY' || fail "压缩方法与级别设置不符"
import sys, zipfile
deflated = zipfile.ZipFile(sys.argv[1])
stored = zipfile.ZipFile(sys.argv[2])
files = [i for i in deflated.infolist() if not i.is_dir()]
assert any(i.compress_type == zipfile.ZIP_DEFLATED for i in files), '标准级别产物无 Deflated 条目'
sfiles = [i for i in stored.infolist() if not i.is_dir()]
assert sfiles and all(i.compress_type == zipfile.ZIP_STORED for i in sfiles), '仅存储产物出现非 Stored 条目'
PY
ok "压缩方法符合级别设置（仅存储=Stored / 标准=Deflated）"

# ── 条目断言：目录条目存在（空目录不丢）、中文条目名完好 ──
python3 - "$TMP/out-deflated.zip" <<'PY' || fail "条目完整性检查失败"
import sys, zipfile
names = set(zipfile.ZipFile(sys.argv[1]).namelist())
for expect in ['fixture/dir3/', 'fixture/dir1/sub/b.bin', 'fixture/中文 目录/文件 名.txt',
               'fixture/dir1/big.bin', 'fixture/top.txt']:
    assert expect in names, '条目缺失: %r' % expect
PY
ok "条目完整性（空目录/嵌套/中文名/大文件）"

echo "[ok] ZipWriter JVM 直测全部通过"
exit 0
