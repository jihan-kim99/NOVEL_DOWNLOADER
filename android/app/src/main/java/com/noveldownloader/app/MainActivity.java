package com.noveldownloader.app;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final Pattern URL_PATTERN = Pattern.compile("(https?://\\S+)");
    private String pendingSharedText = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(InternalBrowserPlugin.class);
        super.onCreate(savedInstanceState);
        handleShareIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleShareIntent(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        deliverPendingSharedText();
    }

    private void handleShareIntent(Intent intent) {
        if (intent == null) return;
        if (Intent.ACTION_SEND.equals(intent.getAction()) && "text/plain".equals(intent.getType())) {
            String shared = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (shared != null && !shared.trim().isEmpty()) {
                Matcher matcher = URL_PATTERN.matcher(shared);
                pendingSharedText = matcher.find() ? matcher.group(1) : shared.trim();
                deliverPendingSharedText();
            }
        }
    }

    private void deliverPendingSharedText() {
        if (pendingSharedText == null || getBridge() == null) return;
        WebView webView = getBridge().getWebView();
        if (webView == null) return;

        final String quoted = JSONObject.quote(pendingSharedText);
        final String js =
            "window.__SHARED_NOVEL_URL__ = " + quoted + ";" +
            "window.dispatchEvent(new CustomEvent('novel-shared-url', { detail: " + quoted + " }));";

        webView.post(() -> webView.evaluateJavascript(js, null));
        // Also retry shortly in case WebView is still hydrating on cold launch
        webView.postDelayed(() -> webView.evaluateJavascript(js, null), 1200);
        pendingSharedText = null;
    }
}
