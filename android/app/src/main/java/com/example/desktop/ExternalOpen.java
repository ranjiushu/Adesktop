/* 外部打开桥：resolveUri / openExternal / openUrl。
 * resolveUri：文件 → WebView 可直接加载的 URI（SAF = content://，私有 = file://），
 *   供前端 <img>/<video>/<audio>/iframe 流式访问媒体，避免大文件经 read 搬入 JS 内存。
 * openExternal：ACTION_VIEW + 按扩展名推断 MIME + 读权限授权；必须 UI 线程 startActivity。
 * openUrl：系统浏览器打开网址（ACTION_VIEW + http/https Uri）。
 */
package com.example.desktop;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;

import androidx.documentfile.provider.DocumentFile;

import java.io.File;
import java.io.IOException;

class ExternalOpen {

    private final BridgeContext ctx;

    ExternalOpen(BridgeContext ctx) {
        this.ctx = ctx;
    }

    String resolveUri(String path) throws IOException {
        Object resolved = ctx.resolve(path);
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
        return uri;
    }

    /* 交外部应用打开：ACTION_VIEW + 按扩展名推断 MIME + 读权限授权。
     * 无可用应用时回调错误（前端 toast 提示）；必须 UI 线程 startActivity。 */
    void openExternal(String path, String cbId) {
        try {
            Object resolved = ctx.resolve(path);
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
            String mime = ctx.mimeFor(name);
            if (mime != null && !mime.isEmpty()) {
                intent.setType(mime);
            }
            ctx.activity.runOnUiThread(() -> {
                try {
                    ctx.activity.startActivity(intent);
                    ctx.resolveOk(cbId, true);
                } catch (ActivityNotFoundException e) {
                    ctx.resolveErr(cbId, "没有可打开该文件的应用");
                } catch (Exception e) {
                    ctx.resolveErr(cbId, "无法打开: " + e.getMessage());
                }
            });
        } catch (Exception e) {
            ctx.resolveErr(cbId, e.getMessage(), e);
        }
    }

    /* 用系统浏览器打开网址（ACTION_VIEW + http/https Uri）。 */
    void openUrl(String url, String cbId) {
        if (url == null || url.trim().isEmpty()) {
            ctx.resolveErr(cbId, "网址无效");
            return;
        }
        ctx.activity.runOnUiThread(() -> {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url.trim()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.activity.startActivity(intent);
                ctx.resolveOk(cbId, true);
            } catch (ActivityNotFoundException e) {
                ctx.resolveErr(cbId, "没有可打开网址的应用");
            } catch (Exception e) {
                ctx.resolveErr(cbId, "无法打开网址: " + (e.getMessage() == null ? url : e.getMessage()));
            }
        });
    }
}
