/* 文件系统桥：前端经 window.FileBridge 调用，全部异步回调。
 * 根目录 = SAF 授权 Uri（setRootUri）或私有目录 filesDir/root（兜底）。
 * 路径一律相对根目录；校验拒绝绝对路径与 .. 逃逸。
 * 回调协议: JS 调用 list(path, cbId)，完成后 evaluateJavascript("window.__fbResolve('cbId', 'json')")
 */
package com.example.desktop;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.media.MediaMetadataRetriever;
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

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class FileBridge {

    /** 单次 read 上限：防止大文件整读导致 OOM（预览/编辑功能上线前先做护栏） */
    private static final long MAX_READ_BYTES = 10L * 1024 * 1024;

    /** 回收站文件夹名：根目录下的隐藏文件夹，删除 = 移入回收站（安全删除，不做彻底删除） */
    private static final String TRASH_NAME = ".trash";

    /** 缩略图最长边（px）：图片采样解码 / 视频帧缩放的目标尺寸，控制内存与缓存体积 */
    private static final int THUMB_MAX_DIM = 256;

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
                // 幂等确保回收站存在（桌面初始化即出现回收站图标）；失败不阻断 rootInfo——
                // 删除时 copy 会自动创建目录，降级为「回收站图标延迟到首次删除后出现」
                try {
                    ensureTrash();
                } catch (Exception ignored) {
                }
                o.put("trashName", TRASH_NAME);
                resolveOk(cbId, o);
            } catch (Exception e) {
                resolveErr(cbId, e.getMessage());
            }
        });
    }

    /** 幂等确保回收站文件夹存在（SAF 模式 findFile→createDirectory / 私有模式 mkdirs） */
    private void ensureTrash() throws IOException {
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

    /* 文件 → WebView 可直接加载的 URI：SAF = content://，私有 = file://。
     * 供前端 <img>/<video>/<audio>/iframe 流式访问媒体，避免大文件经 read 搬入 JS 内存。
     * 仅限文件（目录拒绝）；路径校验与 resolve 一致。 */
    @JavascriptInterface
    public void resolveUri(String path, String cbId) {
        executor.execute(() -> {
            try {
                Object resolved = resolve(path);
                String uri;
                if (resolved instanceof DocumentFile) {
                    DocumentFile df = (DocumentFile) resolved;
                    if (!df.isFile()) throw new IOException("非文件: " + path);
                    uri = df.getUri().toString();
                } else {
                    File f = (File) resolved;
                    if (!f.isFile()) throw new IOException("非文件: " + path);
                    uri = Uri.fromFile(f).toString();
                }
                resolveOk(cbId, uri);
            } catch (Exception e) {
                resolveErr(cbId, e.getMessage());
            }
        });
    }

    /* 交外部应用打开：ACTION_VIEW + 按扩展名推断 MIME + 读权限授权。
     * 无可用应用时回调错误（前端 toast 提示）；必须 UI 线程 startActivity。 */
    @JavascriptInterface
    public void openExternal(String path, String cbId) {
        executor.execute(() -> {
            try {
                Object resolved = resolve(path);
                final Intent intent;
                String name;
                if (resolved instanceof DocumentFile) {
                    DocumentFile df = (DocumentFile) resolved;
                    if (!df.isFile()) throw new IOException("非文件: " + path);
                    name = df.getName() == null ? "" : df.getName();
                    intent = new Intent(Intent.ACTION_VIEW, df.getUri());
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                } else {
                    File f = (File) resolved;
                    if (!f.isFile()) throw new IOException("非文件: " + path);
                    name = f.getName();
                    intent = new Intent(Intent.ACTION_VIEW, Uri.fromFile(f));
                }
                String mime = mimeFor(name);
                if (mime != null && !mime.isEmpty()) {
                    intent.setType(mime);
                }
                activity.runOnUiThread(() -> {
                    try {
                        activity.startActivity(intent);
                        resolveOk(cbId, true);
                    } catch (ActivityNotFoundException e) {
                        resolveErr(cbId, "没有可打开该文件的应用");
                    } catch (Exception e) {
                        resolveErr(cbId, "无法打开: " + e.getMessage());
                    }
                });
            } catch (Exception e) {
                resolveErr(cbId, e.getMessage());
            }
        });
    }

    /* ── 已安装应用 ──
     * listApps：PackageManager 查询 launcher 应用（第三方 + 系统），返回 [{package,label,isSystem}]。
     * launchApp：getLaunchIntentForPackage + startActivity 拉起指定应用。
     * Android 11+ 需 manifest 声明 <queries>（MAIN+LAUNCHER），否则列表为空。 */

    @JavascriptInterface
    public void listApps(String cbId) {
        executor.execute(() -> {
            try {
                PackageManager pm = activity.getPackageManager();
                Intent intent = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
                List<ResolveInfo> resolved = pm.queryIntentActivities(intent, 0);
                JSONArray arr = new JSONArray();
                Set<String> seen = new HashSet<>();
                for (ResolveInfo ri : resolved) {
                    if (ri == null || ri.activityInfo == null) continue;
                    String pkg = ri.activityInfo.packageName;
                    if (pkg == null || seen.contains(pkg)) continue;
                    seen.add(pkg);
                    try {
                        JSONObject o = new JSONObject();
                        o.put("package", pkg);
                        o.put("label", String.valueOf(ri.loadLabel(pm)));
                        ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
                        boolean sys = (ai.flags & (ApplicationInfo.FLAG_SYSTEM
                            | ApplicationInfo.FLAG_UPDATED_SYSTEM_APP)) != 0;
                        o.put("isSystem", sys);
                        arr.put(o);
                    } catch (Exception ignored) {
                    }
                }
                resolveOk(cbId, arr);
            } catch (Exception e) {
                resolveErr(cbId, e.getMessage());
            }
        });
    }

    @JavascriptInterface
    public void launchApp(String pkg, String cbId) {
        if (pkg == null || pkg.trim().isEmpty()) {
            resolveErr(cbId, "应用包名无效");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                Intent intent = activity.getPackageManager().getLaunchIntentForPackage(pkg);
                if (intent == null) {
                    resolveErr(cbId, "无法启动应用（无启动入口）: " + pkg);
                    return;
                }
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(intent);
                resolveOk(cbId, true);
            } catch (Exception e) {
                resolveErr(cbId, "无法启动应用: " + (e.getMessage() == null ? pkg : e.getMessage()));
            }
        });
    }

    /* 获取应用图标：PackageManager 加载 Drawable → 缩放到 48dp → PNG → base64 data URI。
     * 供前端列表渐进式展示 + 写入快捷方式 JSON（自包含，可随文件迁移）。 */
    @JavascriptInterface
    public void appIcon(String pkg, String cbId) {
        if (pkg == null || pkg.trim().isEmpty()) {
            resolveErr(cbId, "应用包名无效");
            return;
        }
        executor.execute(() -> {
            try {
                Drawable d = activity.getPackageManager().getApplicationIcon(pkg);
                Bitmap bmp;
                if (d instanceof BitmapDrawable) {
                    bmp = ((BitmapDrawable) d).getBitmap();
                } else {
                    bmp = drawableToBitmap(d);
                }
                Bitmap scaled = scaleToIcon(bmp);
                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                scaled.compress(Bitmap.CompressFormat.PNG, 100, baos);
                String b64 = android.util.Base64.encodeToString(baos.toByteArray(), android.util.Base64.NO_WRAP);
                resolveOk(cbId, "data:image/png;base64," + b64);
            } catch (Exception e) {
                resolveErr(cbId, e.getMessage());
            }
        });
    }

    /** 非 BitmapDrawable 的 Drawable（如 AdaptiveIconDrawable/矢量）→ 绘制到位图 */
    private Bitmap drawableToBitmap(Drawable d) {
        int w = d.getIntrinsicWidth(), h = d.getIntrinsicHeight();
        if (w <= 0) w = 96;
        if (h <= 0) h = 96;
        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bmp);
        d.setBounds(0, 0, w, h);
        d.draw(canvas);
        return bmp;
    }

    /** 缩放到 48dp（应用图标标准尺寸），控制 base64 体积；已达标原样返回 */
    private Bitmap scaleToIcon(Bitmap src) {
        float density = activity.getResources().getDisplayMetrics().density;
        int target = Math.max(1, Math.round(48 * density));
        int w = src.getWidth(), h = src.getHeight();
        if (w == target && h == target) return src;
        return Bitmap.createScaledBitmap(src, target, target, true);
    }

    /* ── 缩略图 ──
     * 图片采样解码 / 视频首帧提取 → 缩放到 256px 最长边 → JPEG 写磁盘缓存 → 返回 file:// URI。
     * 缓存 key = path@mtime@size（文件修改后自然失效）；缓存位于 cacheDir/thumbs（系统可清理）。
     * 采样解码控制内存（大图不全量加载）；解码失败回调错误（前端回退类型图标）。 */

    @JavascriptInterface
    public void thumb(String path, String cbId) {
        executor.execute(() -> {
            try {
                Object resolved = resolve(path);
                long mtime, size;
                if (resolved instanceof DocumentFile) {
                    DocumentFile df = (DocumentFile) resolved;
                    if (!df.isFile()) throw new IOException("非文件: " + path);
                    mtime = df.lastModified();
                    size = df.length();
                } else {
                    File f = (File) resolved;
                    if (!f.isFile()) throw new IOException("非文件: " + path);
                    mtime = f.lastModified();
                    size = f.length();
                }
                File cacheFile = thumbCacheFile(path, mtime, size);
                if (cacheFile.exists() && cacheFile.length() > 0) {
                    resolveOk(cbId, Uri.fromFile(cacheFile).toString());
                    return;
                }
                Bitmap bmp = isVideoPath(path) ? decodeVideoFrame(resolved) : decodeImageThumb(resolved);
                if (bmp == null) throw new IOException("无法生成缩略图: " + path);
                Bitmap thumb = scaleToThumb(bmp);
                File dir = cacheFile.getParentFile();
                if (dir != null && !dir.exists() && !dir.mkdirs()) {
                    throw new IOException("无法创建缩略图缓存目录");
                }
                try (FileOutputStream fos = new FileOutputStream(cacheFile)) {
                    thumb.compress(Bitmap.CompressFormat.JPEG, 82, fos);
                    fos.flush();
                }
                resolveOk(cbId, Uri.fromFile(cacheFile).toString());
            } catch (Exception e) {
                resolveErr(cbId, e.getMessage());
            }
        });
    }

    /** 缩略图缓存文件：key = 相对路径 + mtime + size 的 hash（文件修改后自然失效） */
    private File thumbCacheFile(String relPath, long mtime, long size) {
        String key = relPath + "@" + mtime + "@" + size;
        String hash = Integer.toHexString(key.hashCode());
        File dir = new File(activity.getCacheDir(), "thumbs");
        return new File(dir, hash + ".jpg");
    }

    private java.io.InputStream openThumbStream(Object resolved) throws IOException {
        if (resolved instanceof DocumentFile) {
            DocumentFile df = (DocumentFile) resolved;
            java.io.InputStream is = activity.getContentResolver().openInputStream(df.getUri());
            if (is == null) throw new IOException("无法打开: " + df.getName());
            return is;
        }
        return new FileInputStream((File) resolved);
    }

    /** 图片采样解码：先探测尺寸，再按 THUMB_MAX_DIM*2 采样（大图不全量加载，控制内存） */
    private Bitmap decodeImageThumb(Object resolved) throws IOException {
        java.io.InputStream is1 = openThumbStream(resolved);
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeStream(is1, null, bounds);
        is1.close();
        int w = bounds.outWidth, h = bounds.outHeight;
        if (w <= 0 || h <= 0) return null;
        int sample = 1;
        while (Math.max(w, h) / sample > THUMB_MAX_DIM * 2) sample *= 2;
        java.io.InputStream is2 = openThumbStream(resolved);
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = sample;
        Bitmap bmp = BitmapFactory.decodeStream(is2, null, opts);
        is2.close();
        return bmp;
    }

    /** 视频首帧提取（MediaMetadataRetriever，系统原生）；失败返回 null（前端回退类型图标） */
    private Bitmap decodeVideoFrame(Object resolved) {
        MediaMetadataRetriever mmr = new MediaMetadataRetriever();
        try {
            if (resolved instanceof DocumentFile) {
                DocumentFile df = (DocumentFile) resolved;
                mmr.setDataSource(activity, df.getUri());
            } else {
                mmr.setDataSource(((File) resolved).getAbsolutePath());
            }
            return mmr.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
        } catch (Exception e) {
            return null;
        } finally {
            try { mmr.release(); } catch (Exception ignored) {}
        }
    }

    /** 缩放到 THUMB_MAX_DIM 最长边（双线性过滤）；已达标则原样返回 */
    private Bitmap scaleToThumb(Bitmap src) {
        int w = src.getWidth(), h = src.getHeight();
        int maxDim = Math.max(w, h);
        if (maxDim <= THUMB_MAX_DIM) return src;
        float scale = (float) THUMB_MAX_DIM / maxDim;
        int tw = Math.max(1, Math.round(w * scale));
        int th = Math.max(1, Math.round(h * scale));
        return Bitmap.createScaledBitmap(src, tw, th, true);
    }

    private boolean isVideoPath(String path) {
        String ext = extOf(path);
        return ext.equals("mp4") || ext.equals("webm") || ext.equals("mkv") || ext.equals("mov")
            || ext.equals("3gp") || ext.equals("m4v") || ext.equals("avi") || ext.equals("flv")
            || ext.equals("mpg") || ext.equals("mpeg") || ext.equals("wmv");
    }

    private String extOf(String name) {
        int i = name.lastIndexOf('.');
        if (i <= 0 || i >= name.length() - 1) return "";
        return name.substring(i + 1).toLowerCase(Locale.US);
    }
}
