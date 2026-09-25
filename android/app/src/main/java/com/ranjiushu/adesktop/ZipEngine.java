/* 压缩引擎：选中项 → zip 归档（流式，java.util.zip）。
 * 由 FileBridge 门面委托调用；执行体运行于 BridgeContext 的同一单线程 executor，
 * 取消标志（ctx.cancelRequested）与 copy/move 循环检查保持同一串行语义。
 * 取消/失败时清理本次创建的半成品（目标原本不存在才删，ctx.cleanupCreated）。
 * zip 写出细节在 ZipWriter（纯 JVM，可在桌面 JVM 直测，见 tests/test-zip-writer.sh）。
 */
package com.ranjiushu.adesktop;

import androidx.documentfile.provider.DocumentFile;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

class ZipEngine {

    private final BridgeContext ctx;

    ZipEngine(BridgeContext ctx) {
        this.ctx = ctx;
    }

    /** 压缩为单个 zip：srcPaths（完整相对路径，文件/目录皆可）→ dstPath。
     * level: ZipWriter.LEVEL_STORE = 仅存储；0..9 = deflate 级别。
     * 目标名由前端规划（重名加序号，不覆盖）：目标已存在即报错，不覆盖既有文件。
     * 归档顶层条目 = 各源的叶子名（目录含自身目录项，与常见压缩工具一致）。 */
    void compress(String[] srcPaths, String dstPath, int level, String cbId) {
        boolean dstExisted = false;
        try {
            if (srcPaths == null || srcPaths.length == 0) {
                throw new IOException("没有可压缩的内容");
            }
            if (dstPath == null || dstPath.isEmpty() || !BridgeContext.isSafeRelPath(dstPath)) {
                throw new IOException("非法路径");
            }
            for (String p : srcPaths) {
                if (p == null || p.isEmpty() || !BridgeContext.isSafeRelPath(p)) {
                    throw new IOException("非法路径");
                }
                // 归档不得自包含：目标落在某个源目录之内时，写入过程会把产出的 zip
                // 自己卷进归档（自包含炸弹）。前端只在当前目录产出 zip，正常不触发，兜底拒绝。
                if (dstPath.equals(p) || dstPath.startsWith(p + "/")) {
                    throw new IOException("压缩目标不能位于源目录内: " + p);
                }
            }
            ctx.cancelRequested = false;
            dstExisted = exists(dstPath);
            if (dstExisted) {
                throw new IOException("已存在同名项: " + leafOf(dstPath));
            }
            Reporter pr = new Reporter(cbId);
            ZipWriter.Node[] roots = new ZipWriter.Node[srcPaths.length];
            for (int i = 0; i < srcPaths.length; i++) {
                roots[i] = adapt(srcPaths[i]);
            }
            try (OutputStream os = openDst(dstPath)) {
                ZipWriter.write(os, roots, level, pr);
            }
            ctx.resolveOk(cbId, true);
        } catch (Exception e) {
            if (!dstExisted) {
                try {
                    ctx.cleanupCreated(dstPath);
                } catch (Exception ignored) {
                }
            }
            ctx.resolveErr(cbId, e.getMessage(), e);
        }
    }

    /* ── 条目来源适配（File / DocumentFile 双后端 → ZipWriter.Node）── */

    private ZipWriter.Node adapt(String relPath) throws IOException {
        Object obj = ctx.resolve(relPath);
        if (obj instanceof File) {
            return new FileNode((File) obj);
        }
        return new SafNode((DocumentFile) obj);
    }

    /** File 模式（全盘/私有共用） */
    private static class FileNode extends ZipWriter.Node {
        final File f;

        FileNode(File f) {
            this.f = f;
        }

        @Override
        String name() {
            return f.getName();
        }

        @Override
        boolean isDir() {
            return f.isDirectory();
        }

        @Override
        long size() {
            return f.isFile() ? f.length() : 0;
        }

        @Override
        long lastModified() {
            return f.lastModified();
        }

        @Override
        InputStream open() throws IOException {
            return new FileInputStream(f);
        }

        @Override
        ZipWriter.Node[] children() {
            File[] cs = f.listFiles();
            if (cs == null) return new ZipWriter.Node[0];
            ZipWriter.Node[] out = new ZipWriter.Node[cs.length];
            for (int i = 0; i < cs.length; i++) {
                out[i] = new FileNode(cs[i]);
            }
            return out;
        }
    }

    /** SAF 模式（DocumentFile）：数据流经 ContentResolver，与 TransferEngine.copySaf 同源 */
    private class SafNode extends ZipWriter.Node {
        final DocumentFile df;

        SafNode(DocumentFile df) {
            this.df = df;
        }

        @Override
        String name() {
            return df.getName() == null ? "" : df.getName();
        }

        @Override
        boolean isDir() {
            return df.isDirectory();
        }

        @Override
        long size() {
            return df.isFile() ? df.length() : 0;
        }

        @Override
        long lastModified() {
            return df.lastModified();
        }

        @Override
        InputStream open() throws IOException {
            InputStream is = ctx.activity.getContentResolver().openInputStream(df.getUri());
            if (is == null) throw new IOException("无法读取源文件");
            return is;
        }

        @Override
        ZipWriter.Node[] children() {
            DocumentFile[] cs = df.listFiles();
            if (cs == null) return new ZipWriter.Node[0];
            ZipWriter.Node[] out = new ZipWriter.Node[cs.length];
            for (int i = 0; i < cs.length; i++) {
                out[i] = new SafNode(cs[i]);
            }
            return out;
        }
    }

    /* ── 目标输出流 + 进度上报/取消 ── */

    /** 创建目标输出流：父目录逐级解析/创建（SAF createFile 按 MIME 推断扩展名，mimeFor 已兜底） */
    private OutputStream openDst(String dstPath) throws IOException {
        if (ctx.isSafMode()) {
            DocumentFile parent = ctx.resolveOrCreateParent(dstPath);
            String name = leafOf(dstPath);
            DocumentFile dst = parent.createFile(ctx.mimeFor(name), name);
            if (dst == null) throw new IOException("无法创建文件: " + dstPath);
            OutputStream os = ctx.activity.getContentResolver().openOutputStream(dst.getUri(), "wt");
            if (os == null) throw new IOException("无法写入: " + dstPath);
            return os;
        }
        File dst = new File(ctx.fileRoot(), dstPath);
        if (!ctx.isUnderFileRoot(dst)) throw new IOException("非法路径: " + dstPath);
        File parent = dst.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IOException("无法创建目录: " + parent);
        }
        return new FileOutputStream(dst);
    }

    /** 目标路径是否存在（半成品清理判断依据：原本不存在才删） */
    private boolean exists(String relPath) {
        try {
            return ctx.resolve(relPath) != null;
        } catch (Exception e) {
            return false;
        }
    }

    /** 进度上报器：写入循环内节流推送 __fbProgress（约 200ms 一次），并响应取消请求。
     *  语义与 TransferEngine.ProgressReporter 一致（取消 = 抛「操作已取消」→ 清理半成品）。 */
    private class Reporter implements ZipWriter.Listener {
        final String cbId;
        long lastReportMs;

        Reporter(String cbId) {
            this.cbId = cbId;
        }

        @Override
        public void entryStart(String path) throws IOException {
            tick();
        }

        @Override
        public void tick() throws IOException {
            if (ctx.cancelRequested) throw new IOException("操作已取消");
        }

        @Override
        public void progress(String path, long done, long total) throws IOException {
            if (ctx.cancelRequested) throw new IOException("操作已取消");
            long now = System.currentTimeMillis();
            if (now - lastReportMs < 200) return;
            lastReportMs = now;
            ctx.postProgress(cbId, path, done, total);
        }
    }

    /** 相对路径末段名：'docs/a.zip' → 'a.zip' */
    private static String leafOf(String path) {
        int i = path.lastIndexOf('/');
        return i < 0 ? path : path.substring(i + 1);
    }
}
