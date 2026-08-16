/* 文件系统桥门面：前端经 window.FileBridge 调用，全部异步回调。
 * 根目录 = SAF 授权 Uri（setRootUri）或私有目录 filesDir/root（兜底）。
 * 路径一律相对根目录；校验拒绝绝对路径与 .. 逃逸。
 * 回调协议: JS 调用 list(path, cbId)，完成后 evaluateJavascript("window.__fbResolve('cbId', 'json')")
 * 本类只保留 22 个 @JavascriptInterface 方法签名（window.FileBridge API 面不可变），
 * 实现按职责委托给 BridgeContext / FileStore / TransferEngine / ThumbnailService /
 * AppBridge / ExternalOpen / UploadBridge；文件操作仍串行于 BridgeContext 的同一 executor。
 */
package com.example.desktop;

import android.app.Activity;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

public class FileBridge {

    private final BridgeContext ctx;
    private final FileStore fileStore;
    private final TransferEngine transferEngine;
    private final ThumbnailService thumbnailService;
    private final AppBridge appBridge;
    private final ExternalOpen externalOpen;
    private final UploadBridge uploadBridge;

    FileBridge(Activity activity, WebView webView, Uri rootUri) {
        this.ctx = new BridgeContext(activity, webView, rootUri);
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

    boolean isAuthorized() {
        return ctx.isAuthorized();
    }

    /* 前端请求重新授权根目录（FAB「切换根目录」） */
    @JavascriptInterface
    public void requestRootAccess() {
        ctx.activity.runOnUiThread(() -> {
            if (ctx.activity instanceof MainActivity) {
                ((MainActivity) ctx.activity).requestRootAccessFromBridge();
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
                if (ctx.rootUri != null) {
                    androidx.documentfile.provider.DocumentFile df =
                        androidx.documentfile.provider.DocumentFile.fromTreeUri(ctx.activity, ctx.rootUri);
                    o.put("rootName", df != null && df.getName() != null ? df.getName() : "外部存储");
                    o.put("mode", "saf");
                    o.put("displayPath", ctx.safDisplayPath(ctx.rootUri));
                } else {
                    o.put("rootName", "应用私有目录");
                    o.put("mode", "private");
                    o.put("displayPath", ctx.privateRoot.getAbsolutePath());
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
        ctx.executor.execute(() -> {
            try {
                ctx.resolveOk(cbId, thumbnailService.thumb(path));
            } catch (Exception e) {
                ctx.resolveErr(cbId, e.getMessage(), e);
            }
        });
    }
}
