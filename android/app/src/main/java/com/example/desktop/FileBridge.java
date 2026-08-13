/* 文件系统桥：前端经 window.FileBridge 调用，全部异步回调。
 * 根目录 = SAF 授权 Uri（setRootUri）或私有目录 filesDir/root（兜底）。
 * 路径一律相对根目录；校验拒绝绝对路径与 .. 逃逸。
 * 回调协议: JS 调用 list(path, cbId)，完成后 evaluateJavascript("window.__fbResolve('cbId', 'json')")
 */
package com.example.desktop;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.WebView;

import androidx.documentfile.provider.DocumentFile;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class FileBridge {

    /** 单次 read 上限：防止大文件整读导致 OOM（预览/编辑功能上线前先做护栏） */
    private static final long MAX_READ_BYTES = 10L * 1024 * 1024;

    private final Activity activity;
    private final WebView webView;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    private volatile Uri rootUri;          // SAF 授权根（null 时用私有目录）
    private volatile File privateRoot;     // 兜底根 filesDir/root

    FileBridge(Activity activity, WebView webView, Uri rootUri) {
        this.activity = activity;
        this.webView = webView;
        this.rootUri = rootUri;
        File filesDir = activity.getFilesDir();
        this.privateRoot = new File(filesDir, "root");
        if (!privateRoot.exists()) {
            privateRoot.mkdirs();
        }
    }

    void setRootUri(Uri uri) {
        this.rootUri = uri;
    }

    boolean isAuthorized() {
        return rootUri != null;
    }

    /* 前端请求重新授权根目录（FAB「切换根目录」） */
    @JavascriptInterface
    public void requestRootAccess() {
        activity.runOnUiThread(() -> {
            if (activity instanceof MainActivity) {
                ((MainActivity) activity).requestRootAccessFromBridge();
            }
        });
    }

    /* 触觉反馈：前端经 window.FileBridge.vibrate 调用（浏览器预览兜底 navigator.vibrate） */
    @JavascriptInterface
    public void vibrate(int ms) {
        activity.runOnUiThread(() -> {
            try {
                Vibrator vib = (Vibrator) activity.getSystemService(Activity.VIBRATOR_SERVICE);
                if (vib == null || !vib.hasVibrator()) return;
                int duration = Math.max(1, Math.min(ms, 500));
                if (Build.VERSION.SDK_INT >= 26) {
                    vib.vibrate(VibrationEffect.createOneShot(duration, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    vib.vibrate(duration);
                }
            } catch (Exception ignored) {
            }
        });
    }

    /* ── 工具 ── */

    /** 解析相对路径 → DocumentFile（SAF 模式）或 File（私有模式） */
    private Object resolve(String relPath) throws IOException {
        if (!isSafeRelPath(relPath)) {
            throw new IOException("非法路径: " + relPath);
        }
        if (rootUri != null) {
            DocumentFile dir = DocumentFile.fromTreeUri(activity, rootUri);
            if (dir == null) throw new IOException("根目录不可用");
            if (relPath.isEmpty() || relPath.equals("/")) return dir;
            String[] parts = relPath.split("/");
            DocumentFile cur = dir;
            for (String p : parts) {
                if (p.isEmpty()) continue;
                cur = cur.findFile(p);
                if (cur == null) throw new IOException("不存在: " + relPath);
            }
            return cur;
        }
        File f = new File(privateRoot, relPath);
        if (!isUnderPrivateRoot(f)) {
            throw new IOException("非法路径: " + relPath);
        }
        return f;
    }

    /** 私有模式越界校验：canonical 路径必须等于根或位于根之下（带分隔符，防 /root 前缀命中 /root2） */
    private boolean isUnderPrivateRoot(File f) throws IOException {
        String root = privateRoot.getCanonicalPath();
        String path = f.getCanonicalPath();
        return path.equals(root) || path.startsWith(root + File.separator);
    }

    private boolean isSafeRelPath(String p) {
        if (p == null) return false;
        if (p.startsWith("/")) return false;                    // 拒绝绝对路径
        String[] parts = p.split("/");
        for (String part : parts) {
            if (part.equals("..")) return false;                 // 拒绝逃逸
        }
        return true;
    }

    private void resolveOk(String cbId, Object data) {
        postResolve(cbId, true, data);
    }

    private void resolveErr(String cbId, String err) {
        postResolve(cbId, false, err);
    }

    private void postResolve(final String cbId, final boolean ok, final Object payload) {
        activity.runOnUiThread(() -> {
            try {
                JSONObject out = new JSONObject();
                if (ok) {
                    out.put("ok", true);
                    out.put("data", payload);
                } else {
                    out.put("ok", false);
                    out.put("error", payload == null ? "未知错误" : String.valueOf(payload));
                }
                webView.evaluateJavascript(
                    "window.__fbResolve('" + cbId + "', " + out.toString() + ")",
                    null);
            } catch (Exception e) {
                webView.evaluateJavascript(
                    "window.__fbResolve('" + cbId + "', {ok:false,error:'回调序列化失败'})",
                    null);
            }
        });
    }

    private JSONObject fileToJson(DocumentFile df) {
        JSONObject o = new JSONObject();
        try {
            o.put("name", df.getName() == null ? "" : df.getName());
            o.put("isDir", df.isDirectory());
            o.put("size", df.isFile() ? df.length() : 0);
            o.put("mtime", df.lastModified());
        } catch (Exception ignored) {
        }
        return o;
    }

    private JSONObject fileToJson(File f) {
        JSONObject o = new JSONObject();
        try {
            o.put("name", f.getName());
            o.put("isDir", f.isDirectory());
            o.put("size", f.isFile() ? f.length() : 0);
            o.put("mtime", f.lastModified());
        } catch (Exception ignored) {
        }
        return o;
    }

    /* ── 桥接口 ── */

    @JavascriptInterface
    public void rootInfo(String cbId) {
        executor.execute(() -> {
            try {
                JSONObject o = new JSONObject();
                if (rootUri != null) {
                    DocumentFile df = DocumentFile.fromTreeUri(activity, rootUri);
                    o.put("rootName", df != null && df.getName() != null ? df.getName() : "外部存储");
                    o.put("mode", "saf");
                    o.put("displayPath", safDisplayPath(rootUri));
                } else {
                    o.put("rootName", "应用私有目录");
                    o.put("mode", "private");
                    o.put("displayPath", privateRoot.getAbsolutePath());
                }
                resolveOk(cbId, o);
            } catch (Exception e) {
                resolveErr(cbId, e.getMessage());
            }
        });
    }

    /* SAF tree uri → 可显示路径：tree/primary%3ADesktop → "内部存储/Desktop" */
    private String safDisplayPath(Uri treeUri) {
        String seg = treeUri.getLastPathSegment();
        if (seg == null) return "外部存储";
        String decoded = Uri.decode(seg);
        if (decoded.startsWith("primary:")) {
            return "内部存储/" + decoded.substring("primary:".length());
        }
        return decoded.replace(':', '/');
    }

    @JavascriptInterface
    public void list(String path, String cbId) {
        executor.execute(() -> {
            try {
                Object resolved = resolve(path);
                JSONArray arr = new JSONArray();
                if (resolved instanceof DocumentFile) {
                    DocumentFile dir = (DocumentFile) resolved;
                    if (!dir.isDirectory()) throw new IOException("非目录: " + path);
                    DocumentFile[] children = dir.listFiles();
                    if (children != null) {
                        for (DocumentFile c : children) arr.put(fileToJson(c));
                    }
                } else {
                    File dir = (File) resolved;
                    if (!dir.isDirectory()) throw new IOException("非目录: " + path);
                    File[] children = dir.listFiles();
                    if (children != null) {
                        for (File c : children) arr.put(fileToJson(c));
                    }
                }
                resolveOk(cbId, arr);
            } catch (Exception e) {
                resolveErr(cbId, e.getMessage());
            }
        });
    }

    @JavascriptInterface
    public void read(String path, String cbId) {
        executor.execute(() -> {
            try {
                Object resolved = resolve(path);
                String content;
                if (resolved instanceof DocumentFile) {
                    DocumentFile df = (DocumentFile) resolved;
                    if (!df.isFile()) throw new IOException("非文件: " + path);
                    if (df.length() > MAX_READ_BYTES) throw new IOException("文件过大(>" + (MAX_READ_BYTES / 1024 / 1024) + "MB): " + path);
                    java.io.InputStream is = activity.getContentResolver().openInputStream(df.getUri());
                    if (is == null) throw new IOException("无法打开: " + path);
                    content = new String(readAll(is), StandardCharsets.UTF_8);
                    is.close();
                } else {
                    File f = (File) resolved;
                    if (!f.isFile()) throw new IOException("非文件: " + path);
                    if (f.length() > MAX_READ_BYTES) throw new IOException("文件过大(>" + (MAX_READ_BYTES / 1024 / 1024) + "MB): " + path);
                    try (FileInputStream fis = new FileInputStream(f)) {
                        content = new String(readAll(fis), StandardCharsets.UTF_8);
                    }
                }
                resolveOk(cbId, content);
            } catch (Exception e) {
                resolveErr(cbId, e.getMessage());
            }
        });
    }

    private byte[] readAll(java.io.InputStream is) throws IOException {
        java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = is.read(buf)) != -1) bos.write(buf, 0, n);
        return bos.toByteArray();
    }

    @JavascriptInterface
    public void write(String path, String content, String cbId) {
        executor.execute(() -> {
            try {
                if (!isSafeRelPath(path)) throw new IOException("非法路径: " + path);
                if (rootUri != null) {
                    writeSaf(path, content);
                } else {
                    writePrivate(path, content);
                }
                resolveOk(cbId, true);
            } catch (Exception e) {
                resolveErr(cbId, e.getMessage());
            }
        });
    }

    private void writeSaf(String path, String content) throws IOException {
        DocumentFile dir = DocumentFile.fromTreeUri(activity, rootUri);
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
        if (target == null) target = cur.createFile(mimeFor(name), name);
        if (target == null) throw new IOException("无法创建文件: " + name);
        java.io.OutputStream os = activity.getContentResolver().openOutputStream(target.getUri(), "wt");
        if (os == null) throw new IOException("无法写入: " + name);
        os.write(content.getBytes(StandardCharsets.UTF_8));
        os.flush();
        os.close();
    }

    // SAF 的 createFile 会按 MIME 推断并追加扩展名（如 text/plain → .txt），
    // 文件名必须「输入什么就是什么」：按扩展名映射 MIME（匹配则不追加）；
    // 无扩展名或未知扩展名传空 MIME（ExternalStorageProvider 对空 MIME 不追加扩展名）。
    private String mimeFor(String name) {
        int i = name.lastIndexOf('.');
        if (i > 0 && i < name.length() - 1) {
            String ext = name.substring(i + 1).toLowerCase(Locale.US);
            String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
            if (mime != null) return mime;
        }
        return "";
    }

    private void writePrivate(String path, String content) throws IOException {
        File f = new File(privateRoot, path);
        if (!isUnderPrivateRoot(f)) {
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

    @JavascriptInterface
    public void mkdir(String path, String cbId) {
        executor.execute(() -> {
            try {
                if (!isSafeRelPath(path)) throw new IOException("非法路径: " + path);
                boolean created;
                if (rootUri != null) {
                    DocumentFile dir = DocumentFile.fromTreeUri(activity, rootUri);
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
                    File f = new File(privateRoot, path);
                    created = f.mkdirs() || f.isDirectory();
                }
                resolveOk(cbId, created);
            } catch (Exception e) {
                resolveErr(cbId, e.getMessage());
            }
        });
    }

    @JavascriptInterface
    public void delete(String path, String cbId) {
        executor.execute(() -> {
            try {
                Object resolved = resolve(path);
                boolean deleted;
                if (resolved instanceof DocumentFile) {
                    deleted = ((DocumentFile) resolved).delete();
                } else {
                    deleted = ((File) resolved).delete();
                }
                if (!deleted) throw new IOException("删除失败: " + path);
                resolveOk(cbId, true);
            } catch (Exception e) {
                resolveErr(cbId, e.getMessage());
            }
        });
    }

    @JavascriptInterface
    public void rename(String oldPath, String newPath, String cbId) {
        executor.execute(() -> {
            try {
                Object resolved = resolve(oldPath);
                if (!isSafeRelPath(newPath)) throw new IOException("非法路径: " + newPath);
                boolean ok;
                if (resolved instanceof DocumentFile) {
                    DocumentFile df = (DocumentFile) resolved;
                    String newName = newPath.contains("/")
                        ? newPath.substring(newPath.lastIndexOf('/') + 1) : newPath;
                    ok = df.renameTo(newName);
                } else {
                    File f = (File) resolved;
                    File target = new File(privateRoot, newPath);
                    ok = f.renameTo(target);
                }
                if (!ok) throw new IOException("重命名失败: " + oldPath);
                resolveOk(cbId, true);
            } catch (Exception e) {
                resolveErr(cbId, e.getMessage());
            }
        });
    }

    /* 复制：文件/目录递归拷贝（粘贴的基础操作；剪切 = copy + delete）。
     * srcPath/dstPath 均为相对根目录路径；目标已存在则覆盖（重名由前端规划防冲突）。 */
    @JavascriptInterface
    public void copy(String srcPath, String dstPath, String cbId) {
        executor.execute(() -> {
            try {
                if (!isSafeRelPath(srcPath) || !isSafeRelPath(dstPath)) {
                    throw new IOException("非法路径");
                }
                Object resolved = resolve(srcPath);
                if (rootUri != null) {
                    copySaf((DocumentFile) resolved, dstPath);
                } else {
                    copyPrivate((File) resolved, dstPath);
                }
                resolveOk(cbId, true);
            } catch (Exception e) {
                resolveErr(cbId, e.getMessage());
            }
        });
    }

    /* SAF 递归拷贝：dstPath 逐级解析/创建目录，文件流拷贝 */
    private void copySaf(DocumentFile src, String dstPath) throws IOException {
        DocumentFile root = DocumentFile.fromTreeUri(activity, rootUri);
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
        String name = parts[parts.length - 1];
        if (name.isEmpty()) throw new IOException("非法目标名: " + dstPath);
        if (src.isDirectory()) {
            DocumentFile dstDir = cur.findFile(name);
            if (dstDir == null) dstDir = cur.createDirectory(name);
            if (dstDir == null || !dstDir.isDirectory()) throw new IOException("无法创建目录: " + name);
            DocumentFile[] children = src.listFiles();
            if (children != null) {
                for (DocumentFile c : children) {
                    copySaf(c, dstPath + "/" + c.getName());
                }
            }
        } else {
            DocumentFile dst = cur.findFile(name);
            if (dst == null) dst = cur.createFile(mimeFor(name), name);
            if (dst == null) throw new IOException("无法创建文件: " + name);
            java.io.InputStream is = activity.getContentResolver().openInputStream(src.getUri());
            if (is == null) throw new IOException("无法读取源文件");
            java.io.OutputStream os = activity.getContentResolver().openOutputStream(dst.getUri(), "wt");
            if (os == null) {
                is.close();
                throw new IOException("无法写入: " + dstPath);
            }
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) != -1) os.write(buf, 0, n);
            os.flush();
            os.close();
            is.close();
        }
    }

    /* 私有模式递归拷贝 */
    private void copyPrivate(File src, String dstPath) throws IOException {
        File dst = new File(privateRoot, dstPath);
        if (!isUnderPrivateRoot(dst)) throw new IOException("非法路径: " + dstPath);
        if (src.isDirectory()) {
            if (!dst.mkdirs() && !dst.isDirectory()) throw new IOException("无法创建目录: " + dstPath);
            File[] children = src.listFiles();
            if (children != null) {
                for (File c : children) {
                    copyPrivate(c, dstPath + "/" + c.getName());
                }
            }
        } else {
            File parent = dst.getParentFile();
            if (parent != null && !parent.exists() && !parent.mkdirs()) {
                throw new IOException("无法创建目录: " + parent);
            }
            try (FileInputStream fis = new FileInputStream(src);
                 FileOutputStream fos = new FileOutputStream(dst)) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = fis.read(buf)) != -1) fos.write(buf, 0, n);
            }
        }
    }
}
