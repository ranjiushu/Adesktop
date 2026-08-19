/* Android 壳主入口：WebView 加载本地单文件 bundle + 文件系统桥注册 + 全盘/SAF 授权 */
package com.ranjiushu.adesktop;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.util.Log;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowInsets;
import android.view.inputmethod.InputMethodManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import java.io.File;
import java.lang.reflect.Method;
import java.util.Locale;

public class MainActivity extends Activity {

    private static final int REQ_OPEN_DOC_TREE = 1001;   // 首次启动 SAF 根目录授权（降级路径）
    private static final int REQ_GET_CONTENT = 1002;
    private static final int REQ_WRITE_STORAGE = 1003;   // Android 10 及以下全盘授权（运行时权限）
    private static final int REQ_DESKTOP_DIR = 1004;     // Drawer「桌面目录」系统选择器
    private static final String PREFS = "desktop_prefs";
    private static final String KEY_ROOT_URI = "root_uri";
    private static final String KEY_FORCE_SAF = "force_saf_mode";

    private WebView webView;
    private FileBridge fileBridge;
    // 网页 <input type=file> 触发的文件选择回调（一次一个，网页请求期间有效）
    private ValueCallback<Uri[]> pendingFileCallback;
    // 上次已知的全盘授权状态（onResume 检测变化：授予/撤销 → 切桥层模式 + 通知前端）
    private boolean lastAllFilesGranted = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // ── Edge-to-Edge 沉浸式（参考 LexiCull）：内容延伸至系统栏下方，
        //    状态栏/导航栏透明，安全区经 WindowInsets 注入 CSS 变量 ──
        setupEdgeToEdge();

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        // 允许页面动态 focus() 输入框时获得初始焦点（配合前端新建对话框自动拉起键盘）
        settings.setNeedInitialFocus(true);

        // 页面内导航一律留在 WebView，不跳系统浏览器
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                // 注入当前安全区 CSS 变量。Insets 回调可能早于 JS 环境就绪，
                // 每次页面加载完成都补注一次（含渲染进程重载场景）。
                injectSafeAreaInsets(view);
            }
        });

        // ── 网页文件上传桥：iframe 内网页触发 <input type=file> → onShowFileChooser。
        //    存下回调，通知前端 App.WebUpload.onFileRequested()；前端据「待上传文件」状态
        //    弹确认或让原生弹系统选择器，最终经 FileBridge.completeUpload/choose/cancel
        //    回传 URI 或 null。return true = 原生接管（不弹默认 WebView 选择器）。
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> filePathCallback,
                                             FileChooserParams fileChooserParams) {
                Log.d("DesktopWebUpload", "onShowFileChooser 触发, mode=" + fileChooserParams.getMode());
                pendingFileCallback = filePathCallback;
                webView.evaluateJavascript(
                    "window.App && App.WebUpload && App.WebUpload.onFileRequested()", null);
                return true;
            }
        });

        // ── 主动拉起软键盘（仅条件触发）：WebView 内核只在「触摸目标为输入框」时
        //    自动弹键盘——加号按钮触摸后前端 focus() 输入框，内核不会补弹。
        //    此处借 ACTION_UP 手势窗口延迟检查：对话框可见且输入框已聚焦才请求 IME
        //    （SHOW_IMPLICIT）。条件守卫避免误伤：
        //      - Drawer 开/关等无输入框聚焦场景不弹（此前无差别 SHOW_IMPLICIT 会触发
        //        Android 12「键盘恢复」机制，把上次的键盘会话重新拉起）
        //    Android 12+ 丢弃非用户手势的 showSoftInput，必须在手势窗口内调用。
        webView.setOnTouchListener(new View.OnTouchListener() {
            @Override
            public boolean onTouch(View v, MotionEvent event) {
                if (event.getAction() == MotionEvent.ACTION_UP) {
                    v.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            webView.evaluateJavascript(
                                "(function(){" +
                                "var o=document.getElementById('create-dialog-overlay');" +
                                "return (o && o.classList.contains('dialog-overlay-visible')" +
                                " && document.activeElement" +
                                " && document.activeElement.tagName==='INPUT')?'1':'0';" +
                                "})()",
                                new ValueCallback<String>() {
                                    @Override
                                    public void onReceiveValue(String value) {
                                        if ("1".equals(value)) {
                                            InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
                                            if (imm != null) imm.showSoftInput(v, InputMethodManager.SHOW_IMPLICIT);
                                        }
                                    }
                                });
                        }
                    }, 100);
                }
                return false;  // 不消费事件，WebView 正常处理触摸
            }
        });

        setContentView(webView);

        // ── WindowInsets：安全区/键盘终态注入 ──
        // 历史教训（LexiCull fix/edge-to-edge-regressions）：曾用
        // WindowInsetsAnimationCompat.onProgress 逐帧注入 JS 跟手，导致过冲反弹、
        // 干扰触摸、末帧跳变。现方案：insets 监听器在键盘动画开始即获终态并注入
        // --panel-bottom，CSS transition 单机制平滑到位——bottom 只有一个主人。
        ViewCompat.setOnApplyWindowInsetsListener(webView, (v, insets) -> {
            updatePanelBottom(insets);
            return insets;
        });

        // ── 文件系统桥：全盘根（授权访问手机存储，主模式）> SAF 授权根 > 私有目录兜底 ──
        // 模式判定：全盘权限动态检测（不持久化——权限被系统撤销后自动降级）；
        // SAF 授权持久化于 prefs（KEY_ROOT_URI，switchRoot 降级路径写入）；
        // forceSafMode 持久化：用户通过「桌面目录」主动选择 SAF 目录后，即使仍持
        // 有全盘权限也强制走 SAF 分支（以便选择应用私有目录等仅 SAF 可访问位置）。
        // 私有目录 filesDir/root 恒为最终兜底。
        boolean allFilesGranted = hasAllFilesAccess();
        lastAllFilesGranted = allFilesGranted;
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String uriStr = prefs.getString(KEY_ROOT_URI, null);
        Uri rootUri = uriStr != null ? Uri.parse(uriStr) : null;
        File allFilesRoot = allFilesGranted ? Environment.getExternalStorageDirectory() : null;
        boolean forceSafMode = prefs.getBoolean(KEY_FORCE_SAF, false);
        fileBridge = new FileBridge(this, webView, rootUri, allFilesRoot, forceSafMode);
        webView.addJavascriptInterface(fileBridge, "FileBridge");

        // 单文件 bundle 由 build-local.sh 复制到 assets/index.html
        webView.loadUrl("file:///android_asset/index.html");

        // 全盘授权引导已移至前端（all-files 引导对话框，localStorage 标记防重复弹）：
        // 原生只保留桥调用入口（Drawer「授权手机存储」→ FileBridge.requestRootAccess →
        // requestAllFilesAccessFromBridge → 系统设置页 / 运行时权限框）。
    }

    /* ── 全盘访问（MANAGE_EXTERNAL_STORAGE / legacy WRITE_EXTERNAL_STORAGE）── */

    /** 当前是否持有全盘访问权限：Android 11+ = isExternalStorageManager（反射调用，
     *  避免 API < 30 设备直接引用该方法导致 VerifyError——历史教训见 setupEdgeToEdge）；
     *  Android 10 及以下 = WRITE_EXTERNAL_STORAGE 运行时权限。 */
    private boolean hasAllFilesAccess() {
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                Method m = Environment.class.getMethod("isExternalStorageManager");
                return Boolean.TRUE.equals(m.invoke(null));
            } catch (Exception e) {
                return false;
            }
        }
        return checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE)
            == PackageManager.PERMISSION_GRANTED;
    }

    /** 引导全盘授权：Android 11+ 跳系统「所有文件访问权限」设置页（优先 package 定位，
     *  部分 ROM 不支持则退回列表页）；Android 10 及以下弹运行时权限框 */
    private void requestAllFilesAccess() {
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                Intent intent = new Intent("android.settings.MANAGE_ALL_FILES_ACCESS_PERMISSION");
                intent.setData(Uri.parse("package:" + getPackageName()));
                startActivity(intent);
                return;
            } catch (Exception ignored) {
                // 带 package 定位失败（异常 ROM）→ 退回列表页
            }
            try {
                startActivity(new Intent("android.settings.MANAGE_ALL_FILES_ACCESS_PERMISSION"));
            } catch (Exception e) {
                // 双失败：静默降级（SAF / 私有目录兜底，App 照常可用）
            }
        } else {
            requestPermissions(
                new String[]{ android.Manifest.permission.WRITE_EXTERNAL_STORAGE },
                REQ_WRITE_STORAGE);
        }
    }

    /** 供 FileBridge 调用：重新引导全盘授权（Drawer「切换根目录」主路径，需 UI 线程） */
    void requestAllFilesAccessFromBridge() {
        requestAllFilesAccess();
    }

    /** 供 FileBridge 调用：打开系统目录选择器（SAF ACTION_OPEN_DOCUMENT_TREE）更换桌面目录 */
    void requestDesktopDir() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
            | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        try {
            startActivityForResult(intent, REQ_DESKTOP_DIR);
        } catch (Exception e) {
            // 无可用选择器： toast 提示
            runOnUiThread(() -> webView.evaluateJavascript(
                "window.App && App.toast && App.toast.show('无法打开系统目录选择器')", null));
        }
    }

    /** 全盘权限状态变化 → 切换桥层模式并通知前端刷新（onResume 检测；含首次授权返回）。
     *  用户主动「授权手机存储」成功后，重置 forceSafMode=false，恢复全盘 File 模式。 */
    private void syncAllFilesMode() {
        boolean grantedNow = hasAllFilesAccess();
        if (grantedNow == lastAllFilesGranted) return;
        lastAllFilesGranted = grantedNow;
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (grantedNow) {
            prefs.edit().putBoolean(KEY_FORCE_SAF, false).apply();
            fileBridge.setForceSafMode(false);
        }
        fileBridge.setAllFilesRoot(grantedNow ? Environment.getExternalStorageDirectory() : null);
        if (webView != null) {
            webView.post(() -> webView.evaluateJavascript(
                "window.App && App.onRootChanged && App.onRootChanged()", null));
        }
    }

    /** 回传文件选择结果给网页（供 FileBridge.completeUpload 调用，需 UI 线程）。 */
    void deliverFileChooser(Uri[] uris) {
        Log.d("DesktopWebUpload", "deliverFileChooser 回传 " + (uris == null ? "null" : (uris.length + " 个 URI")));
        if (pendingFileCallback != null) {
            pendingFileCallback.onReceiveValue(uris);
            pendingFileCallback = null;
        }
    }

    /** 取消文件选择（回传 null，网页侧视为用户取消）。 */
    void cancelFileChooser() {
        Log.d("DesktopWebUpload", "cancelFileChooser 取消");
        if (pendingFileCallback != null) {
            pendingFileCallback.onReceiveValue(null);
            pendingFileCallback = null;
        }
    }

    /** 弹系统文件选择器（GET_CONTENT 单选；grant 由系统自动附带）。 */
    void openSystemFileChooser() {
        Log.d("DesktopWebUpload", "openSystemFileChooser 调用");
        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
        intent.setType("*/*");
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        try {
            startActivityForResult(intent, REQ_GET_CONTENT);
        } catch (Exception e) {
            Log.w("DesktopWebUpload", "openSystemFileChooser 失败: " + e.getMessage());
            cancelFileChooser();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_OPEN_DOC_TREE && resultCode == RESULT_OK && data != null && data.getData() != null) {
            Uri uri = data.getData();
            try {
                getContentResolver().takePersistableUriPermission(uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                getSharedPreferences(PREFS, MODE_PRIVATE)
                    .edit().putString(KEY_ROOT_URI, uri.toString()).apply();
                fileBridge.setRootUri(uri);
                // 通知前端根目录已变更，刷新桌面
                webView.post(() -> webView.evaluateJavascript(
                    "window.App && App.onRootChanged && App.onRootChanged()", null));
            } catch (Exception e) {
                // 授权失败：保持私有目录兜底
            }
        } else if (requestCode == REQ_DESKTOP_DIR && resultCode == RESULT_OK && data != null && data.getData() != null) {
            Uri uri = data.getData();
            try {
                int takeFlags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION
                    | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                getContentResolver().takePersistableUriPermission(uri, takeFlags);
                getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                    .putString(KEY_ROOT_URI, uri.toString())
                    .putBoolean(KEY_FORCE_SAF, true)
                    .apply();
                fileBridge.setRootUri(uri);
                fileBridge.setForceSafMode(true);
                // 通知前端根目录已变更，刷新桌面
                webView.post(() -> webView.evaluateJavascript(
                    "window.App && App.onRootChanged && App.onRootChanged()", null));
            } catch (Exception e) {
                // 授权失败：提示用户
                webView.post(() -> webView.evaluateJavascript(
                    "window.App && App.toast && App.toast.show('目录授权失败')", null));
            }
        } else if (requestCode == REQ_GET_CONTENT) {
            // 网页上传的「重新选择」：GET_CONTENT 返回 URI 自带读授权，直接回传网页
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                deliverFileChooser(new Uri[]{ data.getData() });
            } else {
                cancelFileChooser();
            }
        }
    }

    /** Android 10 及以下：WRITE_EXTERNAL_STORAGE 运行时授权结果 → 切全盘模式（onResume 兜底再检测）。
     *  授权成功后重置 forceSafMode=false。 */
    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_WRITE_STORAGE && grantResults != null && grantResults.length > 0) {
            lastAllFilesGranted = hasAllFilesAccess();
            if (lastAllFilesGranted) {
                getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                    .putBoolean(KEY_FORCE_SAF, false).apply();
                fileBridge.setForceSafMode(false);
            }
            fileBridge.setAllFilesRoot(lastAllFilesGranted
                ? Environment.getExternalStorageDirectory() : null);
            webView.post(() -> webView.evaluateJavascript(
                "window.App && App.onRootChanged && App.onRootChanged()", null));
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView != null) {
            // 1) WebView 内部历史（整页 pushState 路径的兜底，可正常 goBack）
            if (webView.canGoBack()) {
                webView.goBack();
                return true;
            }
            // 2) 前端 overlay（Drawer / 整页面板）：询问 JS 是否消费返回键。
            //    避免依赖 pushState 是否被 WebView 计入 canGoBack（file:// 场景存疑）。
            webView.evaluateJavascript(
                "(function(){ if (window.App && typeof App.handleSystemBack === 'function')" +
                " { return App.handleSystemBack() ? 'handled' : 'not-handled'; }" +
                " return 'not-handled'; })()",
                value -> {
                    String v = value == null ? "" : value.replace("\"", "").trim();
                    if (!"handled".equals(v)) {
                        // JS 无打开的 overlay：退出 App
                        runOnUiThread(MainActivity.this::finish);
                    }
                });
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    /**
     * Edge-to-Edge 沉浸式：透明系统栏 + 内容延伸 + 手势临时栏 + 深色图标。
     * 参考 LexiCull 的优化方案（透明栏架构下只同步图标明暗一个布尔值）。
     */
    private void setupEdgeToEdge() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 29) {
            getWindow().setNavigationBarContrastEnforced(false);
        }
        // 手势临时栏：一律走 WindowInsetsControllerCompat（androidx 兼容类在
        // 所有 API 的 dex 中都存在）。历史教训：曾直接引用 API 30 的
        // android.view.WindowInsetsController 作为局部变量类型，API < 30
        // 设备上 ART 类型解析失败抛 VerifyError，启动即闪退。
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller != null) {
            controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        }
        // 当前仅浅色主题 → 深色系统栏图标
        applyBarsStyle(true);
    }

    /**
     * 控制状态栏/导航栏图标明暗（透明栏架构下，只同步这一个布尔值）。
     * @param darkIcons true=深色图标（浅色页面），false=浅色图标（深色页面）
     */
    private void applyBarsStyle(boolean darkIcons) {
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller != null) {
            controller.setAppearanceLightStatusBars(darkIcons);
            controller.setAppearanceLightNavigationBars(darkIcons);
        }
    }

    // ── 安全区注入：WindowInsets → CSS 变量（--safe-top/--safe-bottom/--panel-bottom） ──
    private float _lastSafeTop = -1, _lastSafeBottom = -1, _lastPanelBottom = -1;
    private boolean _lastImeVisible = false;

    /**
     * 从 WindowInsetsCompat 计算安全区 / 键盘高度并注入 CSS 变量。
     * 内置变化检测：值不变时跳过 evaluateJavascript，避免干扰触摸事件。
     * IME 可见性边沿（键盘弹/收）另派发 desktop:ime 事件通知前端。
     */
    private void updatePanelBottom(WindowInsetsCompat insets) {
        int sysTop = insets.getInsets(WindowInsetsCompat.Type.systemBars()).top;
        int sysBottom = insets.getInsets(WindowInsetsCompat.Type.systemBars()).bottom;
        int imeBottom = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom;
        float density = getResources().getDisplayMetrics().density;

        float safeTopDp = sysTop / density;
        float safeBottomDp = sysBottom / density;

        float panelBottomDp;
        if (imeBottom > 0) {
            panelBottomDp = imeBottom / density + 10f;
        } else {
            panelBottomDp = Math.max(10f, sysBottom / density);
        }

        boolean imeVisible = imeBottom > 0;
        if (imeVisible != _lastImeVisible) {
            _lastImeVisible = imeVisible;
            webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('desktop:ime',{detail:{open:" + imeVisible + "}}))",
                null);
        }

        // 值未变化则跳过
        if (Math.abs(safeTopDp - _lastSafeTop) < 0.5f
            && Math.abs(safeBottomDp - _lastSafeBottom) < 0.5f
            && Math.abs(panelBottomDp - _lastPanelBottom) < 0.5f) {
            return;
        }
        _lastSafeTop = safeTopDp;
        _lastSafeBottom = safeBottomDp;
        _lastPanelBottom = panelBottomDp;

        String js = String.format(Locale.US,
            "if(document.documentElement){" +
            "document.documentElement.style.setProperty('--safe-top','%.1fpx');" +
            "document.documentElement.style.setProperty('--safe-bottom','%.1fpx');" +
            "document.documentElement.style.setProperty('--panel-bottom','%.1fpx');" +
            "}",
            safeTopDp, safeBottomDp, panelBottomDp);
        webView.evaluateJavascript(js, null);
    }

    /**
     * 从 WebView 当前 WindowInsets 读取安全区值并注入 CSS 变量。
     * 用于 onPageFinished 补注（Insets 回调可能早于 JS 环境就绪）。
     */
    private void injectSafeAreaInsets(WebView wv) {
        if (wv == null || Build.VERSION.SDK_INT < 23) return;
        WindowInsets insets = wv.getRootWindowInsets();
        if (insets == null) return;
        // 重置缓存：页面刚就绪，之前的值可能已记录但注入失败
        _lastSafeTop = -1;
        _lastSafeBottom = -1;
        _lastPanelBottom = -1;
        updatePanelBottom(WindowInsetsCompat.toWindowInsetsCompat(insets, wv));
    }

    @Override
    protected void onResume() {
        super.onResume();
        // 恢复图标颜色（onResume 是 Activity 可见的最终保证点；
        // onStop-onRestart 周期中某些系统会重置系统栏外观）。幂等操作。
        applyBarsStyle(true);
        // 全盘权限变化检测：从系统设置页授权/撤销返回、或首次启动引导授权返回时切换模式。
        // onResume 晚于 onActivityResult/onRequestPermissionsResult，此处兜底覆盖所有路径。
        if (fileBridge != null) {
            syncAllFilesMode();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
