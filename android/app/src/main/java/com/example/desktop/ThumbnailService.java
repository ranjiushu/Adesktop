/* 缩略图服务：图片采样解码 / 视频首帧提取 → 缩放到 256px 最长边 → JPEG 写磁盘缓存 → 返回 file:// URI。
 * 缓存 key = path@mtime@size（文件修改后自然失效）；缓存位于 cacheDir/thumbs（系统可清理）。
 * 采样解码控制内存（大图不全量加载）；解码失败回调错误（前端回退类型图标）。
 */
package com.example.desktop;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadataRetriever;
import android.net.Uri;

import androidx.documentfile.provider.DocumentFile;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.Locale;

class ThumbnailService {

    /** 缩略图最长边（px）：图片采样解码 / 视频帧缩放的目标尺寸，控制内存与缓存体积 */
    private static final int THUMB_MAX_DIM = 256;

    private final BridgeContext ctx;

    ThumbnailService(BridgeContext ctx) {
        this.ctx = ctx;
    }

    String thumb(String path) throws IOException {
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
            return Uri.fromFile(cacheFile).toString();
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
        return Uri.fromFile(cacheFile).toString();
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
