/* 网页上传桥：completeUpload / chooseUploadFromSystem / cancelUpload。
 * 回传待上传文件路径 → resolveUri → 交 MainActivity 回传网页；
 * 无 pending 文件选择请求时 resolveErr（前端时序错误）。
 * 本类与 MainActivity 特有方法（deliverFileChooser / cancelFileChooser / openSystemFileChooser）强耦合，独立成类。
 */
package com.example.desktop;

import android.net.Uri;

import androidx.documentfile.provider.DocumentFile;

import java.io.File;
import java.io.IOException;

class UploadBridge {

    private final BridgeContext ctx;

    UploadBridge(BridgeContext ctx) {
        this.ctx = ctx;
    }

    void completeUpload(String[] paths, String cbId) {
        try {
            if (!(ctx.activity instanceof MainActivity)) {
                ctx.resolveErr(cbId, "宿主不支持网页上传");
                return;
            }
            MainActivity ma = (MainActivity) ctx.activity;
            if (paths == null || paths.length == 0) {
                ma.cancelFileChooser();
                ctx.resolveOk(cbId, true);
                return;
            }
            Uri[] uris = new Uri[paths.length];
            for (int i = 0; i < paths.length; i++) {
                Object resolved = ctx.resolve(paths[i]);
                if (resolved instanceof DocumentFile) {
                    DocumentFile df = (DocumentFile) resolved;
                    if (!df.isFile()) throw new IOException("非文件: " + paths[i]);
                    uris[i] = df.getUri();
                } else {
                    File f = (File) resolved;
                    if (!f.isFile()) throw new IOException("非文件: " + paths[i]);
                    uris[i] = Uri.fromFile(f);
                }
            }
            ctx.activity.runOnUiThread(() -> ma.deliverFileChooser(uris));
            ctx.resolveOk(cbId, true);
        } catch (Exception e) {
            ctx.resolveErr(cbId, e.getMessage(), e);
        }
    }

    void chooseUploadFromSystem(String cbId) {
        ctx.activity.runOnUiThread(() -> {
            if (!(ctx.activity instanceof MainActivity)) {
                ctx.resolveErr(cbId, "宿主不支持网页上传");
                return;
            }
            ((MainActivity) ctx.activity).openSystemFileChooser();
            ctx.resolveOk(cbId, true);
        });
    }

    void cancelUpload(String cbId) {
        ctx.activity.runOnUiThread(() -> {
            if (ctx.activity instanceof MainActivity) {
                ((MainActivity) ctx.activity).cancelFileChooser();
            }
            ctx.resolveOk(cbId, true);
        });
    }
}
