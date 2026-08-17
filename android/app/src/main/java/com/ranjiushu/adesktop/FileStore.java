/* 文件基础操作实现：list/read/write/mkdir/delete/rename（SAF + 私有双模式）。
 * 由 FileBridge 门面委托调用；执行体运行于 BridgeContext 的同一单线程 executor。
 * 数据真相在文件系统，本类只做忠实读写，不掺业务逻辑。
 */
package com.ranjiushu.adesktop;

import androidx.documentfile.provider.DocumentFile;

import org.json.JSONArray;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

class FileStore {

    private final BridgeContext ctx;

    FileStore(BridgeContext ctx) {
        this.ctx = ctx;
    }

    JSONArray list(String path) throws IOException {
        Object resolved = ctx.resolve(path);
        JSONArray arr = new JSONArray();
        if (resolved instanceof DocumentFile) {
            DocumentFile dir = (DocumentFile) resolved;
            if (!dir.isDirectory()) throw new IOException("非目录: " + path);
            DocumentFile[] children = dir.listFiles();
            if (children != null) {
                for (DocumentFile c : children) arr.put(ctx.fileToJson(c));
            }
        } else {
            File dir = (File) resolved;
            if (!dir.isDirectory()) throw new IOException("非目录: " + path);
            File[] children = dir.listFiles();
            if (children != null) {
                for (File c : children) arr.put(ctx.fileToJson(c));
            }
        }
        return arr;
    }

    String read(String path) throws IOException {
        Object resolved = ctx.resolve(path);
        String content;
        if (resolved instanceof DocumentFile) {
            DocumentFile df = (DocumentFile) resolved;
            if (!df.isFile()) throw new IOException("非文件: " + path);
            if (df.length() > BridgeContext.MAX_READ_BYTES) {
                throw new IOException("文件过大(>" + (BridgeContext.MAX_READ_BYTES / 1024 / 1024) + "MB): " + path);
            }
            try (java.io.InputStream is = ctx.activity.getContentResolver().openInputStream(df.getUri())) {
                if (is == null) throw new IOException("无法打开: " + path);
                content = new String(ctx.readAll(is), StandardCharsets.UTF_8);
            }
        } else {
            File f = (File) resolved;
            if (!f.isFile()) throw new IOException("非文件: " + path);
            if (f.length() > BridgeContext.MAX_READ_BYTES) {
                throw new IOException("文件过大(>" + (BridgeContext.MAX_READ_BYTES / 1024 / 1024) + "MB): " + path);
            }
            try (FileInputStream fis = new FileInputStream(f)) {
                content = new String(ctx.readAll(fis), StandardCharsets.UTF_8);
            }
        }
        return content;
    }

    boolean write(String path, String content) throws IOException {
        if (!BridgeContext.isSafeRelPath(path)) throw new IOException("非法路径: " + path);
        if (ctx.rootUri != null) {
            writeSaf(path, content);
        } else {
            writePrivate(path, content);
        }
        return true;
    }

    private void writeSaf(String path, String content) throws IOException {
        DocumentFile dir = DocumentFile.fromTreeUri(ctx.activity, ctx.rootUri);
        if (dir == null) throw new IOException("根目录不可用");
        String[] parts = path.split("/");
        DocumentFile cur = dir;
        for (int i = 0; i < parts.length - 1; i++) {
            if (parts[i].isEmpty()) continue;
            DocumentFile next = cur.findFile(parts[i]);
            if (next == null) next = cur.createDirectory(parts[i]);
            if (next == null || !next.isDirectory()) throw new IOException("无法进入目录: " + parts[i]);
            cur = next;
        }
        String name = parts[parts.length - 1];
        DocumentFile target = cur.findFile(name);
        if (target == null) target = cur.createFile(ctx.mimeFor(name), name);
        if (target == null) throw new IOException("无法创建文件: " + name);
        java.io.OutputStream os = ctx.activity.getContentResolver().openOutputStream(target.getUri(), "wt");
        if (os == null) throw new IOException("无法写入: " + name);
        os.write(content.getBytes(StandardCharsets.UTF_8));
        os.flush();
        os.close();
    }

    private void writePrivate(String path, String content) throws IOException {
        File f = new File(ctx.privateRoot, path);
        if (!ctx.isUnderPrivateRoot(f)) {
            throw new IOException("非法路径: " + path);
        }
        File parent = f.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IOException("无法创建目录: " + parent);
        }
        // 原子写：临时文件 + rename
        File tmp = new File(parent, f.getName() + ".tmp");
        try (FileOutputStream fos = new FileOutputStream(tmp)) {
            fos.write(content.getBytes(StandardCharsets.UTF_8));
            fos.flush();
        }
        if (!tmp.renameTo(f)) {
            tmp.delete();
            throw new IOException("写入失败: " + path);
        }
    }

    boolean mkdir(String path) throws IOException {
        if (!BridgeContext.isSafeRelPath(path)) throw new IOException("非法路径: " + path);
        boolean created;
        if (ctx.rootUri != null) {
            DocumentFile dir = DocumentFile.fromTreeUri(ctx.activity, ctx.rootUri);
            if (dir == null) throw new IOException("根目录不可用");
            String[] parts = path.split("/");
            DocumentFile cur = dir;
            for (String p : parts) {
                if (p.isEmpty()) continue;
                DocumentFile next = cur.findFile(p);
                if (next == null) next = cur.createDirectory(p);
                if (next == null) throw new IOException("创建失败: " + p);
                cur = next;
            }
            created = true;
        } else {
            File f = new File(ctx.privateRoot, path);
            created = f.mkdirs() || f.isDirectory();
        }
        return created;
    }

    boolean delete(String path) throws IOException {
        Object resolved = ctx.resolve(path);
        boolean deleted;
        if (resolved instanceof DocumentFile) {
            deleted = ((DocumentFile) resolved).delete();
        } else {
            deleted = ((File) resolved).delete();
        }
        if (!deleted) throw new IOException("删除失败: " + path);
        return true;
    }

    boolean rename(String oldPath, String newPath) throws IOException {
        Object resolved = ctx.resolve(oldPath);
        if (!BridgeContext.isSafeRelPath(newPath)) throw new IOException("非法路径: " + newPath);
        // 重命名限同目录（两后端一致，见 docs/operation-contract.md 1.5）：
        // SAF DocumentFile.renameTo 天然只支持同目录改名；私有模式 File.renameTo 在
        // newPath 带目录时等于跨目录移动——此处显式拦截，防两后端行为分叉。
        String oldParent = parentOf(oldPath);
        String newParent = parentOf(newPath);
        if (!oldParent.equals(newParent)) {
            throw new IOException("重命名不能跨目录: " + oldPath + " -> " + newPath);
        }
        boolean ok;
        if (resolved instanceof DocumentFile) {
            DocumentFile df = (DocumentFile) resolved;
            String newName = newPath.contains("/")
                ? newPath.substring(newPath.lastIndexOf('/') + 1) : newPath;
            ok = df.renameTo(newName);
        } else {
            File f = (File) resolved;
            File target = new File(ctx.privateRoot, newPath);
            ok = f.renameTo(target);
        }
        if (!ok) throw new IOException("重命名失败: " + oldPath);
        return true;
    }

    /** 相对路径的父目录（'' 表示根目录）；'docs/a.txt' → 'docs'，'a.txt' → '' */
    private static String parentOf(String path) {
        int i = path.lastIndexOf('/');
        return i < 0 ? "" : path.substring(0, i);
    }
}
