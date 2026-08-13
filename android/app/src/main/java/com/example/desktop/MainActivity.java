/* Android 壳主入口：WebView 加载本地单文件 bundle + 文件系统桥注册 + SAF 授权 */
package com.example.desktop;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.JavascriptInterface;
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

        // 页面内导航一律留在 WebView，不跳系统浏览器
        webView.setWebViewClient(new WebViewClient());

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
        if (keyCode == KeyEvent.KEYCODE_BACK && webView != null && webView.canGoBack()) {
            webView.goBack();
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
