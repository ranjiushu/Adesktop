/* Android 壳主入口：WebView 加载本地单文件 bundle + 文件系统桥注册 + SAF 授权 */
package com.example.desktop;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

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

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        // 允许页面动态 focus() 输入框时获得初始焦点（配合前端新建对话框自动拉起键盘）
        settings.setNeedInitialFocus(true);

        // 页面内导航一律留在 WebView，不跳系统浏览器
        webView.setWebViewClient(new WebViewClient());

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

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
