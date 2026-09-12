/* 缩略图服务：图片采样解码 / 视频首帧提取 → 缩放到 256px 最长边 → JPEG 写磁盘缓存 → 返回 data URI。
 * 缓存 key = path@mtime@size（文件修改后自然失效）；缓存位于 cacheDir/thumbs（系统可清理）。
 * 采样解码控制内存（大图不全量加载）；解码失败回调错误（前端回退类型图标）。
 * 另提供图片「全屏预览档」（preview）：采样解码到屏幕级尺寸 → cacheDir/previews → 返回
 * file:// 缓存 URI——全屏预览不再每次解原图全分辨率（相机原图 12MP+ 单次几十 MB 位图）。
 * 运行线程：thumb / preview 均不在 UI 线程（thumb 走 BridgeContext.thumbExecutor，
 * preview 走数据串行队列）；每次调用打一行 Log.d 计时（真机排障用，见 TAG）。
 */
package com.ranjiushu.adesktop;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.util.Log;

import androidx.documentfile.provider.DocumentFile;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Locale;

class ThumbnailService {

    private static final String TAG = "Thumbnail";

    /** 缩略图最长边（px）：图片采样解码 / 视频帧缩放的目标尺寸，控制内存与缓存体积 */
    private static final int THUMB_MAX_DIM = 256;

    /** 图片全屏预览档最长边（px）：手机竖屏物理宽度普遍 <=1440，1920 足够 contain 铺满；
     *  该尺寸让 4000px 级原图采样 2 倍解码（约 16MB 位图）而非全量（约 64MB）。 */
    private static final int PREVIEW_MAX_DIM = 1920;

    /** 预览档缓存回收阈值（文件数）：超 MAX 按最旧修改时间删到 KEEP（cacheDir 系统可清，这里只兜底增长） */
    private static final int PREVIEW_CACHE_MAX = 120;
    private static final int PREVIEW_CACHE_KEEP = 80;

    private final BridgeContext ctx;

    ThumbnailService(BridgeContext ctx) {
        this.ctx = ctx;
    }

    String thumb(String path) throws IOException {
        long t0 = System.currentTimeMillis();
        Object resolved = ctx.resolve(path);
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
            String uri = thumbUri(cacheFile);
            Log.d(TAG, "thumb hit " + (System.currentTimeMillis() - t0) + "ms " + size + "B " + path);
            return uri;
        }
        Bitmap bmp = isVideoPath(path) ? decodeVideoFrame(resolved) : decodeImageThumb(resolved);
        if (bmp == null) throw new IOException("无法生成缩略图: " + path);
        Bitmap thumb = scaleTo(bmp, THUMB_MAX_DIM);
        File dir = cacheFile.getParentFile();
        if (dir != null && !dir.exists() && !dir.mkdirs()) {
            throw new IOException("无法创建缩略图缓存目录");
        }
        try (FileOutputStream fos = new FileOutputStream(cacheFile)) {
            thumb.compress(Bitmap.CompressFormat.JPEG, 82, fos);
            fos.flush();
        }
        String uri = thumbUri(cacheFile);
        Log.d(TAG, "thumb gen " + (System.currentTimeMillis() - t0) + "ms " + size + "B " + path);
        return uri;
    }

    /* ── 图片全屏预览档 ──
     * 背景：全屏预览此前直接加载原图 URI，浏览器每次都要解原图全分辨率——相机原图
     * （12MP~50MP）解码几十 MB 位图，慢且逼近 WebView 堆上限。本方法把预览档做成
     * 「采样解码到 PREVIEW_MAX_DIM 内 + JPEG 落 cacheDir/previews + 返回 file:// URI」：
     *   - file:// 与全盘模式 resolveUri 走同一条加载路径（MainActivity 已允许 file 访问），
     *     不经 evaluateJavascript 传 base64 大串；
     *   - 缓存 key 含 mtime/size，文件改动自然失效；缓存目录由系统可清，另有数量回收兜底；
     *   - 原图本身小于预览档尺寸 → 直接返回原图 URI（不做无谓拷贝）；
     *   - 探测/解码失败（如 SVG）→ 抛错，前端回退 resolveUri 原图路径。
     */
    String preview(String path) throws IOException {
        long t0 = System.currentTimeMillis();
        Object resolved = ctx.resolve(path);
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
        int[] bounds = imageBounds(resolved);
        if (bounds == null) throw new IOException("无法解析图片尺寸: " + path);
        if (Math.max(bounds[0], bounds[1]) <= PREVIEW_MAX_DIM) {
            return originalUri(resolved);   // 小图：原图即预览档
        }
        File cacheFile = previewCacheFile(path, mtime, size);
        if (cacheFile.exists() && cacheFile.length() > 0) {
            Log.d(TAG, "preview hit " + (System.currentTimeMillis() - t0) + "ms "
                + bounds[0] + "x" + bounds[1] + " " + path);
            return Uri.fromFile(cacheFile).toString();
        }
        Bitmap bmp = decodeImagePreview(resolved, bounds);
        if (bmp == null) throw new IOException("无法生成预览图: " + path);
        Bitmap out = scaleTo(bmp, PREVIEW_MAX_DIM);
        File dir = cacheFile.getParentFile();
        if (dir != null && !dir.exists() && !dir.mkdirs()) {
            throw new IOException("无法创建预览缓存目录");
        }
        // 原子写（临时文件 + rename）：避免半张图被下次启动当缓存命中（同 FileStore.writeFile 手法）
        File tmp = new File(dir, cacheFile.getName() + ".tmp");
        try (FileOutputStream fos = new FileOutputStream(tmp)) {
            out.compress(Bitmap.CompressFormat.JPEG, 88, fos);
            fos.flush();
        }
        File served = cacheFile;
        if (!tmp.renameTo(cacheFile)) {
            served = tmp;   // 极端情况（rename 失败）：直接用临时文件，下次 MISS 重建
        }
        trimPreviewCache(dir);
        Log.d(TAG, "preview gen " + (System.currentTimeMillis() - t0) + "ms "
            + bounds[0] + "x" + bounds[1] + " -> " + out.getWidth() + "x" + out.getHeight() + " " + path);
        return Uri.fromFile(served).toString();
    }

    /** 图片尺寸探测（只读头部，不全量解码）；非位图格式（如 SVG）返回 null */
    private int[] imageBounds(Object resolved) {
        try (java.io.InputStream is = openThumbStream(resolved)) {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeStream(is, null, bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
            return new int[] { bounds.outWidth, bounds.outHeight };
        } catch (IOException e) {
            return null;
        }
    }

    /** 预览档采样解码：inSampleSize 取 2 的幂，保证解码后最长边 >= PREVIEW_MAX_DIM（不过采样失真） */
    private Bitmap decodeImagePreview(Object resolved, int[] bounds) throws IOException {
        int maxDim = Math.max(bounds[0], bounds[1]);
        int sample = 1;
        while (maxDim / (sample * 2) >= PREVIEW_MAX_DIM) sample *= 2;
        try (java.io.InputStream is = openThumbStream(resolved)) {
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = sample;
            return BitmapFactory.decodeStream(is, null, opts);
        }
    }

    /** 原图 URI（SAF = content://，File 模式 = file://）：小图预览档直接复用它 */
    private String originalUri(Object resolved) {
        if (resolved instanceof DocumentFile) {
            return ((DocumentFile) resolved).getUri().toString();
        }
        return Uri.fromFile((File) resolved).toString();
    }

    /** 预览档缓存文件：key = 相对路径 + mtime + size + 目标尺寸（文件修改后自然失效） */
    private File previewCacheFile(String relPath, long mtime, long size) {
        String key = relPath + "@" + mtime + "@" + size + "@p" + PREVIEW_MAX_DIM;
        File dir = new File(ctx.activity.getCacheDir(), "previews");
        return new File(dir, Integer.toHexString(key.hashCode()) + ".jpg");
    }

    /** 预览档缓存回收：文件数超上限 → 按最旧修改时间删到保留数（防 cacheDir 内无限增长） */
    private void trimPreviewCache(File dir) {
        if (dir == null) return;
        File[] files = dir.listFiles();
        if (files == null || files.length <= PREVIEW_CACHE_MAX) return;
        Arrays.sort(files, new Comparator<File>() {
            @Override
            public int compare(File a, File b) {
                return Long.compare(a.lastModified(), b.lastModified());
            }
        });
        int remove = files.length - PREVIEW_CACHE_KEEP;
        for (int i = 0; i < remove; i++) {
            if (!files[i].delete()) {
                Log.w(TAG, "预览缓存清理失败: " + files[i].getName());
            }
        }
    }

    /** 返回 data:image/jpeg;base64 URI，彻底规避 WebView file:// / content:// 权限与时效问题。
     *  缩略图文件小（通常几 KB~几十 KB），base64 开销可接受；缓存命中也直接读文件转 data URI，
     *  保证 Activity/页面重建后同一张图仍能显示。 */
    private String thumbUri(File cacheFile) throws IOException {
        byte[] bytes = readAll(cacheFile);
        String b64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP);
        return "data:image/jpeg;base64," + b64;
    }

    private byte[] readAll(File f) throws IOException {
        try (java.io.FileInputStream fis = new java.io.FileInputStream(f);
             java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = fis.read(buf)) != -1) bos.write(buf, 0, n);
            return bos.toByteArray();
        }
    }

    /** 缩略图缓存文件：key = 相对路径 + mtime + size 的 hash（文件修改后自然失效） */
    private File thumbCacheFile(String relPath, long mtime, long size) {
        String key = relPath + "@" + mtime + "@" + size;
        String hash = Integer.toHexString(key.hashCode());
        File dir = new File(ctx.activity.getCacheDir(), "thumbs");
        return new File(dir, hash + ".jpg");
    }

    private java.io.InputStream openThumbStream(Object resolved) throws IOException {
        if (resolved instanceof DocumentFile) {
            DocumentFile df = (DocumentFile) resolved;
            java.io.InputStream is = ctx.activity.getContentResolver().openInputStream(df.getUri());
            if (is == null) throw new IOException("无法打开: " + df.getName());
            return is;
        }
        return new FileInputStream((File) resolved);
    }

    /** 图片采样解码：先探测尺寸，再按 THUMB_MAX_DIM*2 采样（大图不全量加载，控制内存） */
    private Bitmap decodeImageThumb(Object resolved) throws IOException {
        int w, h;
        try (java.io.InputStream is1 = openThumbStream(resolved)) {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeStream(is1, null, bounds);
            w = bounds.outWidth;
            h = bounds.outHeight;
        }
        if (w <= 0 || h <= 0) return null;
        int sample = 1;
        while (Math.max(w, h) / sample > THUMB_MAX_DIM * 2) sample *= 2;
        try (java.io.InputStream is2 = openThumbStream(resolved)) {
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = sample;
            return BitmapFactory.decodeStream(is2, null, opts);
        }
    }

    /** 视频首帧提取（MediaMetadataRetriever，系统原生）；失败返回 null（前端回退类型图标） */
    private Bitmap decodeVideoFrame(Object resolved) {
        MediaMetadataRetriever mmr = new MediaMetadataRetriever();
        try {
            if (resolved instanceof DocumentFile) {
                DocumentFile df = (DocumentFile) resolved;
                mmr.setDataSource(ctx.activity, df.getUri());
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

    /** 缩放到 maxDim 最长边（双线性过滤）；已达标则原样返回（缩略图 256 / 预览档 1920 共用） */
    private Bitmap scaleTo(Bitmap src, int target) {
        int w = src.getWidth(), h = src.getHeight();
        int maxDim = Math.max(w, h);
        if (maxDim <= target) return src;
        float scale = (float) target / maxDim;
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
