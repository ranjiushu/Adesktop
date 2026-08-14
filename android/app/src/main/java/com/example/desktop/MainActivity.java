/* Android 壳主入口：WebView 加载本地单文件 bundle + 文件系统桥注册 + SAF 授权 */
package com.example.desktop;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowInsets;
import android.view.inputmethod.InputMethodManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import java.util.Locale;

public class MainActivity extends Activity {

    private static final int REQ_OPEN_DOC_TREE = 1001;
    private static final String PREFS = "desktop_prefs";
    private static final String KEY_ROOT_URI = "root_uri";

    private WebView webView;
    private FileBridge fileBridge;

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

        // ── 文件系统桥：SAF 授权根 或 私有目录兜底 ──
        String uriStr = getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_ROOT_URI, null);
        Uri rootUri = uriStr != null ? Uri.parse(uriStr) : null;
        fileBridge = new FileBridge(this, webView, rootUri);
        webView.addJavascriptInterface(fileBridge, "FileBridge");

        // 单文件 bundle 由 build-local.sh 复制到 assets/index.html
        webView.loadUrl("file:///android_asset/index.html");

        // 首次启动：无授权时弹出目录选择器（用户可跳过，跳过则用私有目录兜底）
        if (rootUri == null) {
            requestRootAccess();
        }
    }

    private void requestRootAccess() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
            | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
            | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        try {
            startActivityForResult(intent, REQ_OPEN_DOC_TREE);
        } catch (Exception e) {
            // 无目录选择器（异常 ROM）：静默回退私有目录
        }
    }

    /** 供 FileBridge 调用：重新弹出授权选择器（需 UI 线程） */
    void requestRootAccessFromBridge() {
        requestRootAccess();
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
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
