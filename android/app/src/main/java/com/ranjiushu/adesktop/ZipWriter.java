/* zip 归档写出器：流式写 zip（STORED / DEFLATED），零 Android 依赖
 * （java.io + java.util.zip），可在桌面 JVM 直接编译验证——
 * tests/test-zip-writer.sh 的 harness 直测本类（unzip -t 校验产物）。
 * 格式细节交 java.util.zip.ZipOutputStream（zip64 大文件自动处理），本类只做
 * 条目遍历（目录递归）、进度上报与取消响应。
 * STORED（仅存储）条目 zip 规范要求写入前已知 CRC32，故先预读一遍计算，
 * 再写数据；文件在两遍之间变化时 ZipOutputStream 校验失败抛错（不留坏归档）。
 */
package com.ranjiushu.adesktop;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.zip.CRC32;
import java.util.zip.Deflater;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

class ZipWriter {

    /** 仅存储（zip method=STORED，不压缩）；其余取值为 deflate 级别 0..9 */
    static final int LEVEL_STORE = -1;

    /** 流式缓冲区（与 TransferEngine 拷贝循环同尺寸） */
    private static final int BUFFER = 8192;

    /** 归档条目来源：Android 侧把 File / DocumentFile 适配成 Node，本类不关心后端 */
    abstract static class Node {
        /** 单级名（不含 '/'） */
        abstract String name() throws IOException;

        abstract boolean isDir() throws IOException;

        /** 文件字节数（目录恒 0）；仅作进度提示，写入以实际字节为准 */
        abstract long size() throws IOException;

        /** 修改时间（毫秒；<=0 表示不写时间戳） */
        abstract long lastModified() throws IOException;

        /** 文件数据流（目录无数据，不调用）；调用方负责关闭 */
        abstract InputStream open() throws IOException;

        /** 目录子项；文件返回空数组 */
        abstract Node[] children() throws IOException;
    }

    /** 进度与取消：任一方法内检查取消标志并抛 IOException("操作已取消") 即中止写入 */
    interface Listener {
        /** 条目开始写入前（含目录条目）：检查取消 */
        void entryStart(String path) throws IOException;

        /** 仅检查取消（STORED 预读计算 CRC 期间无进度可报） */
        void tick() throws IOException;

        /** 文件字节进度（done/total 为当前条目内进度）：检查取消 + 节流上报 */
        void progress(String path, long done, long total) throws IOException;
    }

    /** 把 roots（各自成为归档顶层条目，目录含自身目录项）流式写入 out。
     * level: LEVEL_STORE = 仅存储；0..9 = deflate 级别（越界钳制到 0..9）。
     * 空 roots 报错（不产出空归档）；out 由本方法关闭（含异常路径）。 */
    static void write(OutputStream out, Node[] roots, int level, Listener l) throws IOException {
        if (roots == null || roots.length == 0) {
            throw new IOException("没有可压缩的内容");
        }
        try (ZipOutputStream zos = new ZipOutputStream(out)) {
            if (level != LEVEL_STORE) {
                zos.setLevel(Math.max(Deflater.BEST_SPEED, Math.min(Deflater.BEST_COMPRESSION, level)));
            }
            for (Node root : roots) {
                String base = root.name();
                if (base == null || base.isEmpty() || base.indexOf('/') >= 0) {
                    throw new IOException("非法条目名");
                }
                addNode(zos, base, root, level, l);
            }
            zos.finish();
        }
    }

    /** 写单个条目（文件 / 目录），目录递归子项（entryName 前缀拼接） */
    private static void addNode(ZipOutputStream zos, String entryName, Node node, int level, Listener l)
            throws IOException {
        l.entryStart(entryName);
        long mtime = node.lastModified();
        if (node.isDir()) {
            ZipEntry e = new ZipEntry(entryName + "/");
            if (mtime > 0) e.setTime(mtime);
            zos.putNextEntry(e);
            zos.closeEntry();
            Node[] children = node.children();
            if (children != null) {
                for (Node c : children) {
                    String name = c.name();
                    if (name == null || name.isEmpty() || name.indexOf('/') >= 0) {
                        throw new IOException("非法条目名: " + entryName);
                    }
                    addNode(zos, entryName + "/" + name, c, level, l);
                }
            }
            return;
        }
        ZipEntry e = new ZipEntry(entryName);
        if (mtime > 0) e.setTime(mtime);
        if (level == LEVEL_STORE) {
            // STORED：预读一遍算 CRC32 与准确字节数（zip 规范要求写入前已知）
            CRC32 crc = new CRC32();
            long n = 0;
            try (InputStream in = node.open()) {
                byte[] buf = new byte[BUFFER];
                int r;
                while ((r = in.read(buf)) != -1) {
                    crc.update(buf, 0, r);
                    n += r;
                    l.tick();
                }
            }
            e.setMethod(ZipEntry.STORED);
            e.setSize(n);
            e.setCompressedSize(n);
            e.setCrc(crc.getValue());
            zos.putNextEntry(e);
            try (InputStream in = node.open()) {
                copyRaw(in, zos, entryName, n, l);
            }
            zos.closeEntry();
        } else {
            e.setMethod(ZipEntry.DEFLATED);
            zos.putNextEntry(e);
            try (InputStream in = node.open()) {
                copyRaw(in, zos, entryName, node.size(), l);
            }
            zos.closeEntry();
        }
    }

    /** 流式搬运 + 字节进度（每块都过取消检查） */
    private static void copyRaw(InputStream in, ZipOutputStream zos, String path, long total, Listener l)
            throws IOException {
        byte[] buf = new byte[BUFFER];
        long done = 0;
        int n;
        while ((n = in.read(buf)) != -1) {
            zos.write(buf, 0, n);
            done += n;
            l.progress(path, done, total);
        }
    }
}
