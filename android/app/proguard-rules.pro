# Adesktop release 混淆规则（R8）
# ── Java Bridge 保留（前端经 addJavascriptInterface("FileBridge") 调用）──
# 混淆会删除/重命名桥方法，导致前端调用失败，必须 keep：
-keep class com.ranjiushu.adesktop.FileBridge { *; }

# 通用保险：任何带 @JavascriptInterface 的方法不混淆
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
