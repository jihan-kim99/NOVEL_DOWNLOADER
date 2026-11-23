package com.noveldownloader.app;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Full-featured native Android in-app WebView browser for browsing
 * Narou, Narou R18 (Nocturne/Moonlight/Midnight), and Kakuyomu with:
 * - Pre-seeded over18=yes cookies for R18 sites
 * - Quick-switch site tabs
 * - Address / search bar + Back / Forward / Reload / Close controls
 * - Auto-detection of novel & episode pages with 1-tap Download & Queue bar
 */
public class InAppBrowserActivity extends AppCompatActivity {

    public static final String EXTRA_URL = "url";
    public static final String EXTRA_ACTION = "action";
    public static final String EXTRA_DETECTED_URL = "detected_url";
    public static final String EXTRA_DETECTED_TITLE = "detected_title";
    public static final String EXTRA_LAST_URL = "last_url";

    private static final String DEFAULT_URL = "https://yomou.syosetu.com/rank/top/";

    private static final Pattern KAKUYOMU_WORK_PATTERN =
        Pattern.compile("/works/(\\d+)");
    private static final Pattern SYOSETU_NCODE_PATTERN =
        Pattern.compile("/(n\\d{4}[a-z]{1,2})(?:/|$|\\?)", Pattern.CASE_INSENSITIVE);

    private static final String[][] SITE_SHORTCUTS = new String[][] {
        { "Narou", "https://yomou.syosetu.com/rank/top/", "syosetu_normal" },
        { "Kakuyomu", "https://kakuyomu.jp/rankings/all/daily", "kakuyomu" },
        { "Nocturne", "https://noc.syosetu.com/rank/top/", "noc" },
        { "Moonlight", "https://mnlt.syosetu.com/rank/top/", "mnlt" },
        { "Midnight", "https://mid.syosetu.com/rank/top/", "mid" },
    };

    private WebView webView;
    private EditText urlInput;
    private TextView backBtn;
    private TextView forwardBtn;
    private TextView reloadBtn;
    private ProgressBar progressBar;

    private LinearLayout downloadBar;
    private TextView detectedSiteBadge;
    private TextView detectedTitleText;

    private final List<TextView> siteChips = new ArrayList<>();

    private String currentUrl = DEFAULT_URL;
    private String detectedNovelUrl = null;
    private String detectedSiteLabel = null;
    private boolean isLoadingPage = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        String initialUrl = getIntent().getStringExtra(EXTRA_URL);
        if (initialUrl == null || initialUrl.trim().isEmpty()) {
            initialUrl = DEFAULT_URL;
        }
        currentUrl = initialUrl.trim();

        seedSyosetuR18Cookies();

        LinearLayout root = buildUi();
        setContentView(root);

        // Handle Android 15/16 edge-to-edge system bars cleanly
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });

        setupWebView();

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView != null && webView.canGoBack()) {
                    webView.goBack();
                } else {
                    finishClosed();
                }
            }
        });

        urlInput.setText(currentUrl);
        updateSiteChipHighlights(currentUrl);
        webView.loadUrl(currentUrl);
    }

    private LinearLayout buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#0F172A"));
        root.setLayoutParams(new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        // 1. Top Toolbar: [X] [<-] [->] [URL Input] [Reload]
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setBackgroundColor(Color.parseColor("#1E293B"));
        toolbar.setPadding(dp(6), dp(6), dp(6), dp(6));

        TextView closeBtn = makeNavButton("\u2715", "Close browser");
        closeBtn.setOnClickListener(v -> finishClosed());

        backBtn = makeNavButton("\u2190", "Back");
        backBtn.setOnClickListener(v -> {
            if (webView.canGoBack()) webView.goBack();
        });

        forwardBtn = makeNavButton("\u2192", "Forward");
        forwardBtn.setOnClickListener(v -> {
            if (webView.canGoForward()) webView.goForward();
        });

        urlInput = new EditText(this);
        urlInput.setSingleLine(true);
        urlInput.setEllipsize(TextUtils.TruncateAt.END);
        urlInput.setHint("Enter URL or search...");
        urlInput.setHintTextColor(Color.parseColor("#94A3B8"));
        urlInput.setTextColor(Color.WHITE);
        urlInput.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        urlInput.setImeOptions(EditorInfo.IME_ACTION_GO);
        urlInput.setInputType(
            android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI
        );
        urlInput.setPadding(dp(12), dp(8), dp(12), dp(8));
        GradientDrawable inputBg = new GradientDrawable();
        inputBg.setColor(Color.parseColor("#0F172A"));
        inputBg.setCornerRadius(dp(18));
        inputBg.setStroke(dp(1), Color.parseColor("#334155"));
        urlInput.setBackground(inputBg);
        LinearLayout.LayoutParams urlLp = new LinearLayout.LayoutParams(
            0,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            1f
        );
        urlLp.setMargins(dp(4), 0, dp(4), 0);
        urlInput.setLayoutParams(urlLp);

        urlInput.setOnEditorActionListener((v, actionId, event) -> {
            if (
                actionId == EditorInfo.IME_ACTION_GO ||
                actionId == EditorInfo.IME_ACTION_DONE ||
                (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER)
            ) {
                navigateFromAddressBar();
                return true;
            }
            return false;
        });

        reloadBtn = makeNavButton("\u21BB", "Reload");
        reloadBtn.setOnClickListener(v -> {
            if (isLoadingPage) {
                webView.stopLoading();
            } else {
                webView.reload();
            }
        });

        toolbar.addView(closeBtn);
        toolbar.addView(backBtn);
        toolbar.addView(forwardBtn);
        toolbar.addView(urlInput);
        toolbar.addView(reloadBtn);
        root.addView(toolbar);

        // 2. Quick-Switch Site Chips Bar
        HorizontalScrollView chipScroll = new HorizontalScrollView(this);
        chipScroll.setHorizontalScrollBarEnabled(false);
        chipScroll.setBackgroundColor(Color.parseColor("#1E293B"));
        chipScroll.setPadding(dp(8), dp(2), dp(8), dp(8));

        LinearLayout chipRow = new LinearLayout(this);
        chipRow.setOrientation(LinearLayout.HORIZONTAL);
        chipRow.setGravity(Gravity.CENTER_VERTICAL);

        siteChips.clear();
        for (String[] site : SITE_SHORTCUTS) {
            final String label = site[0];
            final String targetUrl = site[1];

            TextView chip = new TextView(this);
            chip.setText(label);
            chip.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            chip.setTypeface(null, Typeface.BOLD);
            chip.setPadding(dp(12), dp(6), dp(12), dp(6));
            LinearLayout.LayoutParams chipLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            );
            chipLp.setMargins(0, 0, dp(6), 0);
            chip.setLayoutParams(chipLp);
            chip.setTag(site[2]);
            chip.setOnClickListener(v -> {
                hideKeyboard();
                webView.loadUrl(targetUrl);
            });
            styleChip(chip, false);
            siteChips.add(chip);
            chipRow.addView(chip);
        }

        chipScroll.addView(chipRow);
        root.addView(chipScroll);

        // 3. Thin loading progress bar
        progressBar = new ProgressBar(
            this,
            null,
            android.R.attr.progressBarStyleHorizontal
        );
        progressBar.setMax(100);
        progressBar.setLayoutParams(new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(3)
        ));
        progressBar.setVisibility(View.GONE);
        root.addView(progressBar);

        // 4. Main WebView
        webView = new WebView(this);
        webView.setLayoutParams(new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            1f
        ));
        root.addView(webView);

        // 5. Smart Bottom Novel Detection Bar (Hidden until on a novel/episode page)
        downloadBar = new LinearLayout(this);
        downloadBar.setOrientation(LinearLayout.VERTICAL);
        downloadBar.setBackgroundColor(Color.parseColor("#0F172A"));
        downloadBar.setPadding(dp(12), dp(10), dp(12), dp(12));
        downloadBar.setVisibility(View.GONE);

        // Top row of bottom bar: site badge + detected novel title
        LinearLayout infoRow = new LinearLayout(this);
        infoRow.setOrientation(LinearLayout.HORIZONTAL);
        infoRow.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams infoLp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        infoLp.setMargins(0, 0, 0, dp(8));
        infoRow.setLayoutParams(infoLp);

        detectedSiteBadge = new TextView(this);
        detectedSiteBadge.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        detectedSiteBadge.setTypeface(null, Typeface.BOLD);
        detectedSiteBadge.setTextColor(Color.parseColor("#A7F3D0"));
        detectedSiteBadge.setPadding(dp(8), dp(3), dp(8), dp(3));
        GradientDrawable badgeBg = new GradientDrawable();
        badgeBg.setColor(Color.parseColor("#065F46"));
        badgeBg.setCornerRadius(dp(10));
        detectedSiteBadge.setBackground(badgeBg);
        LinearLayout.LayoutParams badgeLp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        badgeLp.setMargins(0, 0, dp(8), 0);
        detectedSiteBadge.setLayoutParams(badgeLp);

        detectedTitleText = new TextView(this);
        detectedTitleText.setTextColor(Color.WHITE);
        detectedTitleText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        detectedTitleText.setTypeface(null, Typeface.BOLD);
        detectedTitleText.setSingleLine(true);
        detectedTitleText.setEllipsize(TextUtils.TruncateAt.END);
        detectedTitleText.setLayoutParams(new LinearLayout.LayoutParams(
            0,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            1f
        ));

        infoRow.addView(detectedSiteBadge);
        infoRow.addView(detectedTitleText);
        downloadBar.addView(infoRow);

        // Bottom row of download bar: [+ Queue] [Download EPUB]
        LinearLayout actionsRow = new LinearLayout(this);
        actionsRow.setOrientation(LinearLayout.HORIZONTAL);
        actionsRow.setGravity(Gravity.CENTER_VERTICAL);

        TextView queueBtn = makeActionButton(
            "+ Queue",
            Color.parseColor("#334155"),
            Color.WHITE
        );
        LinearLayout.LayoutParams queueLp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        queueLp.setMargins(0, 0, dp(8), 0);
        queueBtn.setLayoutParams(queueLp);
        queueBtn.setOnClickListener(v -> {
            if (detectedNovelUrl == null) return;
            String title = cleanDetectedTitle(webView.getTitle());
            InternalBrowserPlugin.dispatchQueuedNovel(
                detectedNovelUrl,
                title,
                detectedSiteLabel != null ? detectedSiteLabel : ""
            );
            Toast.makeText(
                this,
                "Added to Download Queue",
                Toast.LENGTH_SHORT
            ).show();
        });

        TextView downloadBtn = makeActionButton(
            "\u2B07 Download EPUB",
            Color.parseColor("#10B981"),
            Color.WHITE
        );
        downloadBtn.setLayoutParams(new LinearLayout.LayoutParams(
            0,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            1f
        ));
        downloadBtn.setOnClickListener(v -> {
            if (detectedNovelUrl == null) return;
            Intent result = new Intent();
            result.putExtra(EXTRA_ACTION, "download");
            result.putExtra(EXTRA_DETECTED_URL, detectedNovelUrl);
            result.putExtra(EXTRA_DETECTED_TITLE, cleanDetectedTitle(webView.getTitle()));
            result.putExtra(EXTRA_LAST_URL, currentUrl);
            setResult(RESULT_OK, result);
            finish();
        });

        actionsRow.addView(queueBtn);
        actionsRow.addView(downloadBtn);
        downloadBar.addView(actionsRow);

        root.addView(downloadBar);

        return root;
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (newProgress < 100) {
                    progressBar.setVisibility(View.VISIBLE);
                    progressBar.setProgress(newProgress);
                } else {
                    progressBar.setVisibility(View.GONE);
                }
            }

            @Override
            public void onReceivedTitle(WebView view, String title) {
                super.onReceivedTitle(view, title);
                if (detectedNovelUrl != null && title != null && !title.trim().isEmpty()) {
                    detectedTitleText.setText(cleanDetectedTitle(title));
                }
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri == null) return false;
                String scheme = uri.getScheme();
                if (scheme == null || (!scheme.equals("http") && !scheme.equals("https"))) {
                    return true;
                }

                String target = uri.toString();
                // Automatically unwrap Syosetu age-check redirect URLs since over18=yes is seeded
                if (target.contains("nl.syosetu.com/redirect/ageauth")) {
                    String inner = uri.getQueryParameter("url");
                    if (inner != null && inner.startsWith("http")) {
                        seedSyosetuR18Cookies();
                        view.loadUrl(inner);
                        return true;
                    }
                }
                return false;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                isLoadingPage = true;
                reloadBtn.setText("\u2715");
                onUrlChanged(url, view.getTitle());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                isLoadingPage = false;
                reloadBtn.setText("\u21BB");
                onUrlChanged(url, view.getTitle());
            }

            @Override
            public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                super.doUpdateVisitedHistory(view, url, isReload);
                // Critical for Kakuyomu Next.js client-side SPA navigations
                onUrlChanged(url, view.getTitle());
            }
        });
    }

    private void onUrlChanged(String url, String pageTitle) {
        if (url == null || url.trim().isEmpty()) return;
        currentUrl = url;
        if (!urlInput.hasFocus()) {
            urlInput.setText(url);
        }
        updateNavButtons();
        updateSiteChipHighlights(url);
        updateNovelDetection(url, pageTitle);
    }

    private void updateNavButtons() {
        boolean canBack = webView != null && webView.canGoBack();
        boolean canForward = webView != null && webView.canGoForward();
        backBtn.setAlpha(canBack ? 1.0f : 0.35f);
        backBtn.setEnabled(canBack);
        forwardBtn.setAlpha(canForward ? 1.0f : 0.35f);
        forwardBtn.setEnabled(canForward);
    }

    private void updateSiteChipHighlights(String url) {
        String host = "";
        try {
            Uri uri = Uri.parse(url);
            if (uri.getHost() != null) {
                host = uri.getHost().toLowerCase(Locale.US);
            }
        } catch (Exception ignored) {}

        String activeTag = null;
        if (host.contains("kakuyomu.jp")) {
            activeTag = "kakuyomu";
        } else if (host.equals("noc.syosetu.com")) {
            activeTag = "noc";
        } else if (host.equals("mnlt.syosetu.com")) {
            activeTag = "mnlt";
        } else if (host.equals("mid.syosetu.com")) {
            activeTag = "mid";
        } else if (host.endsWith("syosetu.com") && !host.equals("novel18.syosetu.com")) {
            activeTag = "syosetu_normal";
        }

        for (TextView chip : siteChips) {
            boolean isActive = activeTag != null && activeTag.equals(chip.getTag());
            styleChip(chip, isActive);
        }
    }

    private void updateNovelDetection(String url, String pageTitle) {
        DetectedNovel detected = detectSupportedNovel(url);
        if (detected != null) {
            detectedNovelUrl = detected.canonicalUrl;
            detectedSiteLabel = detected.siteLabel;
            detectedSiteBadge.setText(detected.siteLabel);
            String cleanTitle = cleanDetectedTitle(pageTitle);
            detectedTitleText.setText(
                cleanTitle.isEmpty() ? detected.canonicalUrl : cleanTitle
            );
            downloadBar.setVisibility(View.VISIBLE);
        } else {
            detectedNovelUrl = null;
            detectedSiteLabel = null;
            downloadBar.setVisibility(View.GONE);
        }
    }

    private static class DetectedNovel {
        final String canonicalUrl;
        final String siteLabel;

        DetectedNovel(String canonicalUrl, String siteLabel) {
            this.canonicalUrl = canonicalUrl;
            this.siteLabel = siteLabel;
        }
    }

    private DetectedNovel detectSupportedNovel(String rawUrl) {
        if (rawUrl == null || rawUrl.isEmpty()) return null;
        try {
            Uri uri = Uri.parse(rawUrl);
            String host = uri.getHost();
            String path = uri.getPath();
            if (host == null || path == null) return null;
            host = host.toLowerCase(Locale.US);

            if (host.equals("kakuyomu.jp") || host.endsWith(".kakuyomu.jp")) {
                Matcher m = KAKUYOMU_WORK_PATTERN.matcher(path);
                if (m.find()) {
                    return new DetectedNovel(
                        "https://kakuyomu.jp/works/" + m.group(1),
                        "Kakuyomu"
                    );
                }
            }

            if (host.equals("syosetu.com") || host.endsWith(".syosetu.com")) {
                Matcher m = SYOSETU_NCODE_PATTERN.matcher(path);
                if (m.find()) {
                    String ncode = m.group(1).toLowerCase(Locale.US);
                    boolean isR18 =
                        host.equals("novel18.syosetu.com") ||
                        host.equals("noc.syosetu.com") ||
                        host.equals("mnlt.syosetu.com") ||
                        host.equals("mid.syosetu.com");

                    if (isR18) {
                        String label = "Syosetu R18";
                        if (host.equals("noc.syosetu.com")) label = "Nocturne R18";
                        else if (host.equals("mnlt.syosetu.com")) label = "Moonlight R18";
                        else if (host.equals("mid.syosetu.com")) label = "Midnight R18";
                        return new DetectedNovel(
                            "https://novel18.syosetu.com/" + ncode + "/",
                            label
                        );
                    }

                    return new DetectedNovel(
                        "https://ncode.syosetu.com/" + ncode + "/",
                        "Narou"
                    );
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    private String cleanDetectedTitle(String rawTitle) {
        if (rawTitle == null) return "";
        String cleaned = rawTitle.trim();
        if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) {
            return "";
        }
        cleaned = cleaned.replaceAll("\\s*-\\s*カクヨム\\s*$", "").trim();
        return cleaned;
    }

    private void navigateFromAddressBar() {
        String text = urlInput.getText().toString().trim();
        hideKeyboard();
        urlInput.clearFocus();
        if (text.isEmpty()) return;

        String target;
        if (text.startsWith("http://") || text.startsWith("https://")) {
            target = text;
        } else if (text.contains(".") && !text.contains(" ")) {
            target = "https://" + text;
        } else {
            // Treat bare keywords as a Narou search inside the browser
            target = "https://yomou.syosetu.com/search.php?word=" + Uri.encode(text);
        }
        webView.loadUrl(target);
    }

    private void seedSyosetuR18Cookies() {
        try {
            CookieManager cm = CookieManager.getInstance();
            cm.setAcceptCookie(true);
            String[] origins = new String[] {
                "https://syosetu.com",
                "https://ncode.syosetu.com",
                "https://novel18.syosetu.com",
                "https://noc.syosetu.com",
                "https://mnlt.syosetu.com",
                "https://mid.syosetu.com",
                "https://nl.syosetu.com",
            };
            for (String origin : origins) {
                cm.setCookie(origin, "over18=yes; path=/; domain=.syosetu.com");
            }
            cm.flush();
        } catch (Exception ignored) {}
    }

    private void finishClosed() {
        Intent result = new Intent();
        result.putExtra(EXTRA_ACTION, "closed");
        result.putExtra(EXTRA_LAST_URL, currentUrl);
        setResult(RESULT_OK, result);
        finish();
    }

    private void hideKeyboard() {
        try {
            InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            if (imm != null && urlInput != null) {
                imm.hideSoftInputFromWindow(urlInput.getWindowToken(), 0);
            }
        } catch (Exception ignored) {}
    }

    private TextView makeNavButton(String symbol, String desc) {
        TextView tv = new TextView(this);
        tv.setText(symbol);
        tv.setContentDescription(desc);
        tv.setTextColor(Color.WHITE);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        tv.setGravity(Gravity.CENTER);
        tv.setMinWidth(dp(34));
        tv.setMinHeight(dp(36));
        tv.setPadding(dp(6), dp(4), dp(6), dp(4));
        return tv;
    }

    private TextView makeActionButton(String label, int bgColor, int textColor) {
        TextView btn = new TextView(this);
        btn.setText(label);
        btn.setTextColor(textColor);
        btn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        btn.setTypeface(null, Typeface.BOLD);
        btn.setGravity(Gravity.CENTER);
        btn.setPadding(dp(14), dp(11), dp(14), dp(11));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(bgColor);
        bg.setCornerRadius(dp(10));
        btn.setBackground(bg);
        return btn;
    }

    private void styleChip(TextView chip, boolean active) {
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(14));
        if (active) {
            bg.setColor(Color.parseColor("#6366F1"));
            chip.setTextColor(Color.WHITE);
        } else {
            bg.setColor(Color.parseColor("#334155"));
            chip.setTextColor(Color.parseColor("#E2E8F0"));
        }
        chip.setBackground(bg);
    }

    private int dp(int value) {
        return Math.round(
            TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP,
                value,
                getResources().getDisplayMetrics()
            )
        );
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
