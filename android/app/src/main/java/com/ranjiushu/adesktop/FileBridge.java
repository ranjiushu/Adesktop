/* 文件系统桥门面：前端经 window.FileBridge 调用，全部异步回调。
 * 根目录 = SAF 授权 Uri（setRootUri）/ 全盘根 Environment.getExternalStorageDirectory() /
 * 私有目录 filesDir/root（兜底），三模式由 BridgeContext 判定。
 * 路径一律相对根目录；校验拒绝绝对路径与 .. 逃逸。
 * 回调协议: JS 调用 list(path, cbId)，完成后 evaluateJavascript("window.__fbResolve('cbId', 'json')")
 * 本类只保留 22 个 @JavascriptInterface 方法签名（window.FileBridge API 面不可变），
 * 实现按职责委托给 BridgeContext / FileStore / TransferEngine / ThumbnailService /
 * AppBridge / ExternalOpen / UploadBridge；文件操作仍串行于 BridgeContext 的同一 executor。
 */
package com.ranjiushu.adesktop;

import android.app.Activity;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.File;

public class FileBridge {

    private final BridgeContext ctx;
    private final FileStore fileStore;
    private final TransferEngine transferEngine;
    private final ThumbnailService thumbnailService;
    private final AppBridge appBridge;
    private final ExternalOpen externalOpen;
    private final UploadBridge uploadBridge;

    FileBridge(Activity activity, WebView webView, Uri rootUri, File allFilesRoot, boolean forceSafMode) {
        this.ctx = new BridgeContext(activity, webView, rootUri, allFilesRoot, forceSafMode);
        this.fileStore = new FileStore(ctx);
        this.transferEngine = new TransferEngine(ctx);
        this.thumbnailService = new ThumbnailService(ctx);
        this.appBridge = new AppBridge(ctx);
        this.externalOpen = new ExternalOpen(ctx);
        this.uploadBridge = new UploadBridge(ctx);
    }

    void setRootUri(Uri uri) {
        ctx.setRootUri(uri);
    }

    /** 全盘模式切换（MainActivity 权限变化时调用；null = 退出全盘） */
    void setAllFilesRoot(File root) {
        ctx.setAllFilesRoot(root);
    }

    boolean isAuthorized() {
        return ctx.isAuthorized();
    }

    void setForceSafMode(boolean force) {
        ctx.setForceSafMode(force);
    }

    /* 前端请求根目录授权（Drawer「切换根目录」）：主路径 = 引导全盘授权（跳系统设置页）；
     * Android 10 及以下 = WRITE_EXTERNAL_STORAGE 运行时权限框。 */
    @JavascriptInterface
    public void requestRootAccess() {
        ctx.activity.runOnUiThread(() -> {
            if (ctx.activity instanceof MainActivity) {
                ((MainActivity) ctx.activity).requestAllFilesAccessFromBridge();
            }
        });
    }

    /* 前端请求更换桌面目录（Drawer「桌面目录」）：打开系统 SAF 目录选择器。
     * all-files 模式下解析为相对路径；SAF/private 模式下直接作为新的根授权。 */
    @JavascriptInterface
    public void requestDesktopDir() {
        ctx.activity.runOnUiThread(() -> {
            if (ctx.activity instanceof MainActivity) {
                ((MainActivity) ctx.activity).requestDesktopDir();
            }
        });
    }

    /* 触觉反馈：前端经 window.FileBridge.vibrate 调用（浏览器预览兜底 navigator.vibrate） */
    @JavascriptInterface
    public void vibrate(int ms) {
        ctx.activity.runOnUiThread(() -> {
            try {
                Vibrator vib = (Vibrator) ctx.activity.getSystemService(Activity.VIBRATOR_SERVICE);
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

    @JavascriptInterface
    public void rootInfo(String cbId) {
        ctx.executor.execute(() -> {
            try {
                JSONObject o = new JSONObject();
                // 模式优先级：用户主动 SAF 选择（forceSafMode）> 全盘 > SAF > 私有。
                // 用户通过「桌面目录」选择器主动授权 SAF 目录（含应用私有目录）后，即使仍持有
                // 全盘权限也走 SAF 分支，保证桌面根是用户授权的那棵树。
                if (ctx.isSafMode()) {
                    androidx.documentfile.provider.DocumentFile df =
                        androidx.documentfile.provider.DocumentFile.fromTreeUri(ctx.activity, ctx.rootUri);
                    o.put("rootName", df != null && df.getName() != null ? df.getName() : "外部存储");
                    o.put("mode", "saf");
                    o.put("displayPath", ctx.safDisplayPath(ctx.rootUri));
                    // 布局/Home 的 root 隔离 id：SAF = tree uri（稳定唯一），全盘/私有 = 固定串。
                    // 前端 localStorage key 带 rootId（desktop.layout.<rootId>.v1），
                    // 切根 A→B 不再继承 A 的图标位置/相机/Home 快照（见 docs/operation-contract.md 1.6）
                    o.put("rootId", ctx.rootUri.toString());
                } else if (ctx.allFilesRoot != null) {
                    o.put("rootName", BridgeContext.ROOT_NAME_ALL_FILES);
                    o.put("mode", "all-files");
                    o.put("displayPath", ctx.allFilesRoot.getAbsolutePath());
                    o.put("rootId", BridgeContext.ROOT_ID_ALL_FILES);
                } else {
                    o.put("rootName", "应用私有目录");
                    o.put("mode", "private");
                    o.put("displayPath", ctx.privateRoot.getAbsolutePath());
                    o.put("rootId", BridgeContext.ROOT_ID_PRIVATE);
                }
                // 幂等确保回收站存在（桌面初始化即出现回收站图标）；失败不阻断 rootInfo——
                // 删除时 copy 会自动创建目录，降级为「回收站图标延迟到首次删除后出现」
                try {
                    ctx.ensureTrash();
                } catch (Exception ignored) {
                }
                o.put("trashName", BridgeContext.TRASH_NAME);
                ctx.resolveOk(cbId, o);
            } catch (Exception e) {
                ctx.resolveErr(cbId, e.getMessage(), e);
            }
        });
    }

    @JavascriptInterface
    public void list(String path, String cbId) {
        ctx.executor.execute(() -> {
            try {
                ctx.resolveOk(cbId, fileStore.list(path));
            } catch (Exception e) {
                ctx.resolveErr(cbId, e.getMessage(), e);
            }
        });
    }

    @JavascriptInterface
    public void read(String path, String cbId) {
        ctx.executor.execute(() -> {
            try {
                ctx.resolveOk(cbId, fileStore.read(path));
            } catch (Exception e) {
                ctx.resolveErr(cbId, e.getMessage(), e);
            }
        });
    }

    @JavascriptInterface
    public void write(String path, String content, String cbId) {
        ctx.executor.execute(() -> {
            try {
                ctx.resolveOk(cbId, fileStore.write(path, content));
            } catch (Exception e) {
                ctx.resolveErr(cbId, e.getMessage(), e);
            }
        });
    }

    @JavascriptInterface
    public void mkdir(String path, String cbId) {
        ctx.executor.execute(() -> {
            try {
                ctx.resolveOk(cbId, fileStore.mkdir(path));
            } catch (Exception e) {
                ctx.resolveErr(cbId, e.getMessage(), e);
            }
        });
    }

    @JavascriptInterface
    public void delete(String path, String cbId) {
        ctx.executor.execute(() -> {
            try {
                ctx.resolveOk(cbId, fileStore.delete(path));
            } catch (Exception e) {
                ctx.resolveErr(cbId, e.getMessage(), e);
            }
        });
    }

    @JavascriptInterface
    public void rename(String oldPath, String newPath, String cbId) {
        ctx.executor.execute(() -> {
            try {
                ctx.resolveOk(cbId, fileStore.rename(oldPath, newPath));
            } catch (Exception e) {
                ctx.resolveErr(cbId, e.getMessage(), e);
            }
        });
    }

    @JavascriptInterface
    public void move(String srcPath, String dstPath, String cbId) {
        ctx.executor.execute(() -> transferEngine.move(srcPath, dstPath, cbId));
    }

    @JavascriptInterface
    public void copy(String srcPath, String dstPath, String cbId) {
        ctx.executor.execute(() -> transferEngine.copy(srcPath, dstPath, cbId));
    }

    @JavascriptInterface
    public void cancelTransfer(String cbId) {
        transferEngine.cancelTransfer(cbId);
    }

    @JavascriptInterface
    public void resolveUri(String path, String cbId) {
        ctx.executor.execute(() -> {
            try {
                ctx.resolveOk(cbId, externalOpen.resolveUri(path));
            } catch (Exception e) {
                ctx.resolveErr(cbId, e.getMessage(), e);
            }
        });
    }

    @JavascriptInterface
    public void openExternal(String path, String cbId) {
        ctx.executor.execute(() -> externalOpen.openExternal(path, cbId));
    }

    @JavascriptInterface
    public void openUrl(String url, String cbId) {
        externalOpen.openUrl(url, cbId);
    }

    @JavascriptInterface
    public void completeUpload(String[] paths, String cbId) {
        ctx.executor.execute(() -> uploadBridge.completeUpload(paths, cbId));
    }

    @JavascriptInterface
    public void chooseUploadFromSystem(String cbId) {
        uploadBridge.chooseUploadFromSystem(cbId);
    }

    @JavascriptInterface
    public void cancelUpload(String cbId) {
        uploadBridge.cancelUpload(cbId);
    }

    @JavascriptInterface
    public void listApps(String cbId) {
        ctx.executor.execute(() -> {
            try {
                ctx.resolveOk(cbId, appBridge.listApps());
            } catch (Exception e) {
                ctx.resolveErr(cbId, e.getMessage(), e);
            }
        });
    }

    @JavascriptInterface
    public void launchApp(String pkg, String cbId) {
        appBridge.launchApp(pkg, cbId);
    }

    @JavascriptInterface
    public void appIcon(String pkg, String cbId) {
        if (pkg == null || pkg.trim().isEmpty()) {
            ctx.resolveErr(cbId, "应用包名无效");
            return;
        }
        ctx.executor.execute(() -> {
            try {
                ctx.resolveOk(cbId, appBridge.appIcon(pkg));
            } catch (Exception e) {
                ctx.resolveErr(cbId, e.getMessage(), e);
            }
        });
    }

    @JavascriptInterface
    public void thumb(String path, String cbId) {
        // 走 thumbExecutor（非数据队列）：预取工作不得阻塞用户发起的 read/list/resolveUri
        ctx.thumbExecutor.execute(() -> {
            try {
                ctx.resolveOk(cbId, thumbnailService.thumb(path));
            } catch (Exception e) {
                ctx.resolveErr(cbId, e.getMessage(), e);
            }
        });
    }

    /* 图片全屏预览档：大图采样解码到屏幕级尺寸（磁盘缓存）后返回 URI，避免每次打开都解原图
     * 全分辨率（相机原图 12MP+ 单次解码几十 MB 位图，慢且逼近 WebView 堆上限）。
     * 走数据队列（用户发起、等结果），与 read/resolveUri 同一串行语义。 */
    @JavascriptInterface
    public void previewUri(String path, String cbId) {
        ctx.executor.execute(() -> {
            try {
                ctx.resolveOk(cbId, thumbnailService.preview(path));
            } catch (Exception e) {
                ctx.resolveErr(cbId, e.getMessage(), e);
            }
        });
    }
}
