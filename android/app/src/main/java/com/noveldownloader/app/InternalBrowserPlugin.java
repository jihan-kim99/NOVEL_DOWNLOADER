package com.noveldownloader.app;

import android.app.Activity;
import android.content.Intent;
import android.webkit.WebView;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.lang.ref.WeakReference;
import org.json.JSONObject;

@CapacitorPlugin(name = "InternalBrowser")
public class InternalBrowserPlugin extends Plugin {

    private static WeakReference<InternalBrowserPlugin> activePluginRef = new WeakReference<>(null);

    @Override
    public void load() {
        super.load();
        activePluginRef = new WeakReference<>(this);
    }

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url", "https://yomou.syosetu.com/rank/top/");
        activePluginRef = new WeakReference<>(this);

        Intent intent = new Intent(getContext(), InAppBrowserActivity.class);
        intent.putExtra(InAppBrowserActivity.EXTRA_URL, url);
        startActivityForResult(call, intent, "handleBrowserResult");
    }

    @ActivityCallback
    private void handleBrowserResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        JSObject ret = new JSObject();
        Intent data = result.getData();
        if (result.getResultCode() == Activity.RESULT_OK && data != null) {
            String action = data.getStringExtra(InAppBrowserActivity.EXTRA_ACTION);
            ret.put("action", action != null ? action : "closed");
            String detectedUrl = data.getStringExtra(InAppBrowserActivity.EXTRA_DETECTED_URL);
            if (detectedUrl != null) {
                ret.put("url", detectedUrl);
            }
            String detectedTitle = data.getStringExtra(InAppBrowserActivity.EXTRA_DETECTED_TITLE);
            if (detectedTitle != null) {
                ret.put("title", detectedTitle);
            }
            String lastUrl = data.getStringExtra(InAppBrowserActivity.EXTRA_LAST_URL);
            if (lastUrl != null) {
                ret.put("lastUrl", lastUrl);
            }
        } else {
            ret.put("action", "closed");
        }
        call.resolve(ret);
    }

    /**
     * Dispatches a queued novel from InAppBrowserActivity directly into the Capacitor WebView
     * without closing the in-app browser.
     */
    public static void dispatchQueuedNovel(String url, String title, String siteLabel) {
        InternalBrowserPlugin plugin = activePluginRef.get();
        if (plugin == null) return;
        Bridge bridge = plugin.getBridge();
        if (bridge == null) return;
        WebView webView = bridge.getWebView();
        if (webView == null) return;

        try {
            JSONObject payload = new JSONObject();
            payload.put("url", url);
            payload.put("title", title != null ? title : "");
            payload.put("siteLabel", siteLabel != null ? siteLabel : "");
            final String js =
                "window.dispatchEvent(new CustomEvent('novel-browser-queue', { detail: " +
                payload.toString() +
                " }));";
            webView.post(() -> webView.evaluateJavascript(js, null));
        } catch (Exception ignored) {}
    }
}
