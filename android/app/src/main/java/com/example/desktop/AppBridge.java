/* 已安装应用桥：listApps / launchApp / appIcon。
 * listApps：PackageManager 查询 launcher 应用（第三方 + 系统），返回 [{package,label,isSystem}]。
 * launchApp：getLaunchIntentForPackage + startActivity 拉起指定应用。
 * Android 11+ 需 manifest 声明 <queries>（MAIN+LAUNCHER），否则列表为空。
 * appIcon：加载 Drawable → 缩放到 48dp → PNG → base64 data URI（自包含，可随文件迁移）。
 */
package com.example.desktop;

import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

class AppBridge {

    private final BridgeContext ctx;

    AppBridge(BridgeContext ctx) {
        this.ctx = ctx;
    }

    JSONArray listApps() {
        PackageManager pm = ctx.activity.getPackageManager();
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
        return arr;
    }

    void launchApp(String pkg, String cbId) {
        if (pkg == null || pkg.trim().isEmpty()) {
            ctx.resolveErr(cbId, "应用包名无效");
            return;
        }
        ctx.activity.runOnUiThread(() -> {
            try {
                Intent intent = ctx.activity.getPackageManager().getLaunchIntentForPackage(pkg);
                if (intent == null) {
                    ctx.resolveErr(cbId, "无法启动应用（无启动入口）: " + pkg);
                    return;
                }
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.activity.startActivity(intent);
                ctx.resolveOk(cbId, true);
            } catch (Exception e) {
                ctx.resolveErr(cbId, "无法启动应用: " + (e.getMessage() == null ? pkg : e.getMessage()));
            }
        });
    }

    String appIcon(String pkg) throws Exception {
        Drawable d = ctx.activity.getPackageManager().getApplicationIcon(pkg);
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
        return "data:image/png;base64," + b64;
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
        float density = ctx.activity.getResources().getDisplayMetrics().density;
        int target = Math.max(1, Math.round(48 * density));
        int w = src.getWidth(), h = src.getHeight();
        if (w == target && h == target) return src;
        return Bitmap.createScaledBitmap(src, target, target, true);
    }
}
