/* 传输引擎：移动 / 复制 / 取消（真移动优先，失败降级 copy+delete，失败安全）。
 * 由 FileBridge 门面委托调用；执行体运行于 BridgeContext 的同一单线程 executor，
 * 取消标志（ctx.cancelRequested）与 copy 循环检查保持原有串行语义。
 * 取消/失败时清理本次创建的半成品（目标原本不存在才删）。
 */
package com.example.desktop;

import android.net.Uri;
import android.provider.DocumentsContract;

import androidx.documentfile.provider.DocumentFile;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;

class TransferEngine {

    private final BridgeContext ctx;

    TransferEngine(BridgeContext ctx) {
        this.ctx = ctx;
    }

    /** 移动（剪切粘贴 / 拖入文件夹 / 移入回收站共用）：真移动优先，降级 copy+delete。
     * srcPath/dstPath 均为相对根目录路径；目标名由前端规划（重名加序号，不覆盖）。
     * 真移动路径：
     *   - 私有模式: File.renameTo（同文件系统内原子移动，目录整体 O(1)，不搬数据）
     *   - SAF 模式: DocumentsContract.moveDocument（API 24+ = minSdk，provider 级移动，
     *               内部存储等多数 provider 原生支持 O(1) 移动）
     * 降级路径（跨文件系统 EXDEV / provider 不支持移动）: copy + delete 源，
     * 失败安全：复制失败源保留（可重试）；删源失败目标已生成（重复，不丢数据）。 */
    void move(String srcPath, String dstPath, String cbId) {
        boolean dstExisted = false;
        try {
            if (!BridgeContext.isSafeRelPath(srcPath) || !BridgeContext.isSafeRelPath(dstPath)) {
                throw new IOException("非法路径");
            }
            ctx.cancelRequested = false;
            dstExisted = exists(dstPath);
            ProgressReporter pr = new ProgressReporter(cbId);
            if (ctx.rootUri != null) {
                moveSaf(srcPath, dstPath, pr);
            } else {
                movePrivate(srcPath, dstPath, pr);
            }
            ctx.resolveOk(cbId, true);
        } catch (Exception e) {
            if (!dstExisted) {
                try { cleanupDst(dstPath); } catch (Exception ignored) {}
            }
            ctx.resolveErr(cbId, e.getMessage(), e);
        }
    }

    /** 复制：文件/目录递归拷贝（粘贴的基础操作）。失败/取消时清理本次创建的半成品。 */
    void copy(String srcPath, String dstPath, String cbId) {
        boolean dstExisted = false;
        try {
            if (!BridgeContext.isSafeRelPath(srcPath) || !BridgeContext.isSafeRelPath(dstPath)) {
                throw new IOException("非法路径");
            }
            ctx.cancelRequested = false;
            dstExisted = exists(dstPath);
            Object resolved = ctx.resolve(srcPath);
            ProgressReporter pr = new ProgressReporter(cbId);
            if (ctx.rootUri != null) {
                copySaf((DocumentFile) resolved, dstPath, pr);
            } else {
                copyPrivate((File) resolved, dstPath, pr);
            }
            ctx.resolveOk(cbId, true);
        } catch (Exception e) {
            if (!dstExisted) {
                try { cleanupDst(dstPath); } catch (Exception ignored) {}
            }
            ctx.resolveErr(cbId, e.getMessage(), e);
        }
    }

    /** 取消当前传输（复制/移动的降级复制路径）：置取消标志，当前任务尽快中止并清理半成品。
     * 真移动（renameTo / moveDocument）为原子瞬间操作，取消对其无意义。 */
    void cancelTransfer(String cbId) {
        ctx.cancelRequested = true;
        ctx.resolveOk(cbId, true);
    }

    /* ── 传输进度上报 + 取消 ── */

    /** 进度上报器：copy 循环内节流推送 __fbProgress（约 200ms 一次），并响应取消请求 */
    private class ProgressReporter {
        final String cbId;
        long lastReportMs;

        ProgressReporter(String cbId) {
            this.cbId = cbId;
        }

        /** 目录条目间调用：只检查取消，不上报进度 */
        void tick() throws IOException {
            if (ctx.cancelRequested) throw new IOException("操作已取消");
        }

        /** 文件拷贝循环内调用：检查取消 + 节流上报当前文件字节进度 */
        void tick(String path, long done, long total) throws IOException {
            if (ctx.cancelRequested) throw new IOException("操作已取消");
            long now = System.currentTimeMillis();
            if (now - lastReportMs < 200) return;
            lastReportMs = now;
            ctx.postProgress(cbId, path, done, total);
        }
    }

    /** 目标路径是否存在（半成品清理判断依据：原本不存在才删） */
    private boolean exists(String relPath) {
        try {
            return ctx.resolve(relPath) != null;
        } catch (Exception e) {
            return false;
        }
    }

    /** 清理本次创建的目标（递归删除）+ 向上清理 resolveOrCreateParent 创建的空父目录 */
    private void cleanupDst(String dstPath) {
        if (ctx.rootUri != null) {
            try {
                DocumentFile df = (DocumentFile) ctx.resolve(dstPath);
                if (df != null) df.delete();
            } catch (Exception ignored) {}
            // 向上清理空目录（resolveOrCreateParent 可能逐级创建了父目录）
            DocumentFile root = DocumentFile.fromTreeUri(ctx.activity, ctx.rootUri);
            if (root != null) {
                int i = dstPath.lastIndexOf('/');
                while (i > 0) {
                    String parentPath = dstPath.substring(0, i);
                    try {
                        DocumentFile dir = (DocumentFile) ctx.resolve(parentPath);
                        if (dir != null && dir.listFiles().length == 0) {
                            dir.delete();
                        } else {
                            break;  // 非空，停止
                        }
                    } catch (Exception e) {
                        break;  // 路径不存在，停止
                    }
                    i = parentPath.lastIndexOf('/');
                }
            }
        } else {
            deleteRecursive(new File(ctx.privateRoot, dstPath));
            // 向上清理空目录
            File f = new File(ctx.privateRoot, dstPath).getParentFile();
            while (f != null && !f.equals(ctx.privateRoot)) {
                String[] children = f.list();
                if (children != null && children.length == 0) {
                    f.delete();
                    f = f.getParentFile();
                } else {
                    break;
                }
            }
        }
    }

    private void deleteRecursive(File f) {
        if (f.isDirectory()) {
            File[] children = f.listFiles();
            if (children != null) {
                for (File c : children) deleteRecursive(c);
            }
        }
        f.delete();
    }

    /* 解析 relPath 的父目录 DocumentFile（'' 或 '/' → 根）。供 move 的 sourceParentUri 使用。 */
    private DocumentFile resolveParent(String relPath) throws IOException {
        int i = relPath.lastIndexOf('/');
        return (DocumentFile) ctx.resolve(i < 0 ? "" : relPath.substring(0, i));
    }

    /** SAF 一次遍历同时解析 src 及其 parent（moveSaf 省一次重复遍历） */
    private DocumentFile[] resolveSrcAndParent(String srcPath) throws IOException {
        DocumentFile root = DocumentFile.fromTreeUri(ctx.activity, ctx.rootUri);
        if (root == null) throw new IOException("根目录不可用");
        if (srcPath.isEmpty() || srcPath.equals("/")) return new DocumentFile[] { root, root };
        String[] parts = srcPath.split("/");
        DocumentFile parent = root;
        for (int i = 0; i < parts.length - 1; i++) {
            if (parts[i].isEmpty()) continue;
            DocumentFile next = parent.findFile(parts[i]);
            if (next == null) throw new IOException("不存在: " + srcPath);
            parent = next;
        }
        String leaf = parts[parts.length - 1];
        DocumentFile src = parent.findFile(leaf);
        if (src == null) throw new IOException("不存在: " + srcPath);
        return new DocumentFile[] { src, parent };
    }

    /* 解析 dstPath 的父目录 DocumentFile，不存在则逐级创建（回收站首删 / 粘贴到新目录场景）。 */
    private DocumentFile resolveOrCreateParent(String dstPath) throws IOException {
        DocumentFile root = DocumentFile.fromTreeUri(ctx.activity, ctx.rootUri);
        if (root == null) throw new IOException("根目录不可用");
        String[] parts = dstPath.split("/");
        DocumentFile cur = root;
        for (int i = 0; i < parts.length - 1; i++) {
            if (parts[i].isEmpty()) continue;
            DocumentFile next = cur.findFile(parts[i]);
            if (next == null) next = cur.createDirectory(parts[i]);
            if (next == null || !next.isDirectory()) throw new IOException("无法进入目录: " + parts[i]);
            cur = next;
        }
        return cur;
    }

    /* SAF 递归拷贝：dstPath 逐级解析/创建目录，文件流拷贝；pr 上报进度 + 响应取消 */
    private void copySaf(DocumentFile src, String dstPath, ProgressReporter pr) throws IOException {
        DocumentFile cur = resolveOrCreateParent(dstPath);
        String[] parts = dstPath.split("/");
        String name = parts[parts.length - 1];
        if (name.isEmpty()) throw new IOException("非法目标名: " + dstPath);
        if (src.isDirectory()) {
            DocumentFile dstDir = cur.findFile(name);
            if (dstDir == null) dstDir = cur.createDirectory(name);
            if (dstDir == null || !dstDir.isDirectory()) throw new IOException("无法创建目录: " + name);
            DocumentFile[] children = src.listFiles();
            if (children != null) {
                for (DocumentFile c : children) {
                    pr.tick();   // 目录条目间也响应取消
                    copySaf(c, dstPath + "/" + c.getName(), pr);
                }
            }
        } else {
            DocumentFile dst = cur.findFile(name);
            if (dst == null) dst = cur.createFile(ctx.mimeFor(name), name);
            if (dst == null) throw new IOException("无法创建文件: " + name);
            try (java.io.InputStream is = ctx.activity.getContentResolver().openInputStream(src.getUri());
                 java.io.OutputStream os = ctx.activity.getContentResolver().openOutputStream(dst.getUri(), "wt")) {
                if (is == null) throw new IOException("无法读取源文件");
                if (os == null) throw new IOException("无法写入: " + dstPath);
                long total = src.length();
                long done = 0;
                byte[] buf = new byte[8192];
                int n;
                while ((n = is.read(buf)) != -1) {
                    os.write(buf, 0, n);
                    done += n;
                    pr.tick(dstPath, done, total);
                }
            }
            // 私有模式保留 mtime；SAF 模式：DocumentsContract 公开 API 无设置 mtime 的方法
            // （updateDocument 为隐藏 API，反射有非 SDK 接口政策风险），故 SAF 复制不保留时间戳
        }
    }

    /* 私有模式递归拷贝；pr 上报进度 + 响应取消 */
    private void copyPrivate(File src, String dstPath, ProgressReporter pr) throws IOException {
        File dst = new File(ctx.privateRoot, dstPath);
        if (!ctx.isUnderPrivateRoot(dst)) throw new IOException("非法路径: " + dstPath);
        if (src.isDirectory()) {
            if (!dst.mkdirs() && !dst.isDirectory()) throw new IOException("无法创建目录: " + dstPath);
            File[] children = src.listFiles();
            if (children != null) {
                for (File c : children) {
                    pr.tick();   // 目录条目间也响应取消
                    copyPrivate(c, dstPath + "/" + c.getName(), pr);
                }
            }
        } else {
            File parent = dst.getParentFile();
            if (parent != null && !parent.exists() && !parent.mkdirs()) {
                throw new IOException("无法创建目录: " + parent);
            }
            long total = src.length();
            long done = 0;
            try (FileInputStream fis = new FileInputStream(src);
                 FileOutputStream fos = new FileOutputStream(dst)) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = fis.read(buf)) != -1) {
                    fos.write(buf, 0, n);
                    done += n;
                    pr.tick(dstPath, done, total);
                }
            }
            // 保留 mtime：复制是「文件即真相」的忠实拷贝，时间戳不得变成"现在"
            if (!dst.setLastModified(src.lastModified())) {
                throw new IOException("无法保留文件时间戳: " + dstPath);
            }
        }
    }

    /* SAF 模式移动：DocumentsContract.moveDocument 优先，失败降级 copySaf + delete 源 */
    private void moveSaf(String srcPath, String dstPath, ProgressReporter pr) throws IOException {
        DocumentFile[] sp = resolveSrcAndParent(srcPath);
        DocumentFile src = sp[0];
        DocumentFile srcParent = sp[1];
        DocumentFile dstParent = resolveOrCreateParent(dstPath);
        // 1) 真移动：provider 级 moveDocument（API 24 = minSdk，恒可用；provider 不支持时抛异常/返回 null）
        try {
            Uri moved = DocumentsContract.moveDocument(
                    ctx.activity.getContentResolver(), src.getUri(), srcParent.getUri(), dstParent.getUri());
            if (moved != null) return;
        } catch (Exception ignored) {
            // provider 不支持移动 → 降级 copy+delete
        }
        // 2) 降级：copy + delete（失败安全：复制失败源保留；删源失败目标已生成，不丢数据）
        copySaf(src, dstPath, pr);
        if (!src.delete()) throw new IOException("移动失败（复制成功但源删除失败）: " + srcPath);
    }

    /* 私有模式移动：File.renameTo 原子移动（同文件系统 O(1)），失败（跨文件系统 EXDEV 等）降级 copy+delete */
    private void movePrivate(String srcPath, String dstPath, ProgressReporter pr) throws IOException {
        File src = (File) ctx.resolve(srcPath);
        File dst = new File(ctx.privateRoot, dstPath);
        if (!ctx.isUnderPrivateRoot(dst)) throw new IOException("非法路径: " + dstPath);
        File parent = dst.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IOException("无法创建目录: " + parent);
        }
        // 1) 真移动：rename(2) 原子操作，目录整体移动（POSIX 语义，无需递归搬移）
        if (src.renameTo(dst)) return;
        // 2) 降级：copy + delete（跨文件系统；失败安全同上）
        copyPrivate(src, dstPath, pr);
        if (!src.delete()) throw new IOException("移动失败（复制成功但源删除失败）: " + srcPath);
    }
}
