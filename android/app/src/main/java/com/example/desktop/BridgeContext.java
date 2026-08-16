/* 桥层共享上下文：持有宿主引用 / 根目录 / 单线程执行器 / 传输取消标志，
 * 并提供统一回调管道（__fbResolve / __fbProgress）与路径工具。
 * FileBridge 门面与各功能模块（FileStore / TransferEngine / ...）共用同一实例，
 * 保证文件操作仍全部串行于同一 executor（copy/move 与取消标志的竞态语义不变）。
 */
package com.example.desktop;

import android.app.Activity;
import android.net.Uri;
import android.util.Log;
import android.webkit.MimeTypeMap;
import android.webkit.WebView;

import androidx.documentfile.provider.DocumentFile;

import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

class BridgeContext {

    /** 日志 TAG（logcat 可观测：真机文件操作错误的双通道出口） */
    private static final String TAG = "FileBridge";

    /** 单次 read 上限：防止大文件整读导致 OOM（预览/编辑功能上线前先做护栏） */
    static final long MAX_READ_BYTES = 10L * 1024 * 1024;

    /** 回收站文件夹名：根目录下的隐藏文件夹，删除 = 移入回收站（安全删除，不做彻底删除） */
    static final String TRASH_NAME = ".trash";

    final Activity activity;
    final WebView webView;
    final ExecutorService executor = Executors.newSingleThreadExecutor();

    /** 传输取消标志：cancelTransfer() 置位，copy 循环检查并尽快中止（单线程串行，同一时刻仅一个传输） */
    volatile boolean cancelRequested = false;

    volatile Uri rootUri;          // SAF 授权根（null 时用私有目录）
    volatile File privateRoot;     // 兜底根 filesDir/root

    BridgeContext(Activity activity, WebView webView, Uri rootUri) {
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

    /* ── 回调管道 ── */

    void resolveOk(String cbId, Object data) {
        postResolve(cbId, true, data);
    }

    void resolveErr(String cbId, String err) {
        // 双通道：logcat 日志 + 前端回调（真机排障不黑箱）
        Log.e(TAG, err);
        postResolve(cbId, false, err);
    }

    /** 带异常的失败出口：logcat 打完整栈（桥层排障关键），回调只透传 message */
    void resolveErr(String cbId, String err, Throwable t) {
        Log.e(TAG, err, t);
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

    /** 进度推送：__fbProgress('cbId', {path, done, total})（字节），须在 UI 线程 evaluateJavascript */
    void postProgress(String cbId, String path, long done, long total) {
        activity.runOnUiThread(() -> {
            try {
                JSONObject o = new JSONObject();
                o.put("path", path);
                o.put("done", done);
                o.put("total", total);
                webView.evaluateJavascript(
                        "window.__fbProgress('" + cbId + "', " + o.toString() + ")", null);
            } catch (Exception ignored) {
            }
        });
    }

    /* ── 路径工具 ── */

    /** 解析相对路径 → DocumentFile（SAF 模式）或 File（私有模式） */
    Object resolve(String relPath) throws IOException {
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
    boolean isUnderPrivateRoot(File f) throws IOException {
        String root = privateRoot.getCanonicalPath();
        String path = f.getCanonicalPath();
        return path.equals(root) || path.startsWith(root + File.separator);
    }

    static boolean isSafeRelPath(String p) {
        if (p == null) return false;
        if (p.startsWith("/")) return false;                    // 拒绝绝对路径
        String[] parts = p.split("/");
        for (String part : parts) {
            if (part.equals("..")) return false;                 // 拒绝逃逸
        }
        return true;
    }

    JSONObject fileToJson(DocumentFile df) {
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

    JSONObject fileToJson(File f) {
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

    byte[] readAll(java.io.InputStream is) throws IOException {
        java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = is.read(buf)) != -1) bos.write(buf, 0, n);
        return bos.toByteArray();
    }

    // SAF 的 createFile 会按 MIME 推断并追加扩展名（如 text/plain → .txt），
    // 文件名必须「输入什么就是什么」：按扩展名映射 MIME（匹配则不追加）；
    // 无扩展名或未知扩展名传空 MIME（ExternalStorageProvider 对空 MIME 不追加扩展名）。
    String mimeFor(String name) {
        int i = name.lastIndexOf('.');
        if (i > 0 && i < name.length() - 1) {
            String ext = name.substring(i + 1).toLowerCase(Locale.US);
            String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
            if (mime != null) return mime;
        }
        return "";
    }

    /** 幂等确保回收站文件夹存在（SAF 模式 findFile→createDirectory / 私有模式 mkdirs） */
    void ensureTrash() throws IOException {
        if (rootUri != null) {
            DocumentFile dir = DocumentFile.fromTreeUri(activity, rootUri);
            if (dir == null) throw new IOException("根目录不可用");
            DocumentFile trash = dir.findFile(TRASH_NAME);
            if (trash == null) {
                trash = dir.createDirectory(TRASH_NAME);
                if (trash == null) throw new IOException("无法创建回收站: " + TRASH_NAME);
            }
        } else {
            File trash = new File(privateRoot, TRASH_NAME);
            if (!trash.exists() && !trash.mkdirs()) {
                throw new IOException("无法创建回收站: " + TRASH_NAME);
            }
        }
    }

    /* SAF tree uri → 可显示路径：tree/primary%3ADesktop → "内部存储/Desktop" */
    String safDisplayPath(Uri treeUri) {
        String seg = treeUri.getLastPathSegment();
        if (seg == null) return "外部存储";
        String decoded = Uri.decode(seg);
        if (decoded.startsWith("primary:")) {
            return "内部存储/" + decoded.substring("primary:".length());
        }
        return decoded.replace(':', '/');
    }
}
