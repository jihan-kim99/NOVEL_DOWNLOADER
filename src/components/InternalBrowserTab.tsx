"use client";

import { useState } from "react";
import { SUPPORTED_SITES } from "../lib/sites";

interface InternalBrowserTabProps {
  nativeMode: boolean;
  lastBrowserUrl: string | null;
  onOpenInBrowser: (url: string, title?: string) => void;
  onQuickDownloadUrl: (url: string) => void;
}

export default function InternalBrowserTab({
  nativeMode,
  lastBrowserUrl,
  onOpenInBrowser,
  onQuickDownloadUrl,
}: InternalBrowserTabProps) {
  const [customUrl, setCustomUrl] = useState("");
  const [clipboardError, setClipboardError] = useState("");

  const handleOpenCustom = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = customUrl.trim();
    if (!raw) return;

    let target: string;
    if (/^https?:\/\//i.test(raw)) {
      target = raw;
    } else if (raw.includes(".") && !raw.includes(" ")) {
      target = `https://${raw}`;
    } else {
      target = `https://yomou.syosetu.com/search.php?word=${encodeURIComponent(raw)}`;
    }
    onOpenInBrowser(target);
  };

  const handlePasteAndDownload = async () => {
    setClipboardError("");
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) {
        setClipboardError("Clipboard is empty.");
        return;
      }
      onQuickDownloadUrl(text);
    } catch {
      setClipboardError(
        "Clipboard access was blocked. Paste the URL in the Downloader tab."
      );
    }
  };

  return (
    <div className="space-y-4">
      {/* Info Banner */}
      <div
        className={`p-4 rounded-xl border text-xs leading-relaxed ${
          nativeMode
            ? "bg-indigo-50 border-indigo-200 text-indigo-950"
            : "bg-slate-50 border-slate-200 text-slate-700"
        }`}
      >
        {nativeMode ? (
          <div className="space-y-1">
            <div className="font-bold text-sm text-indigo-900">
              Native In-App WebView Browser
            </div>
            <p>
              Browse the real novel websites right inside the app with automatic{" "}
              <code>over18=yes</code> R18 cookies and quick-switch site tabs.
              Whenever you open any novel or episode page, a bottom{" "}
              <strong>Download EPUB / + Queue</strong> bar appears automatically!
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="font-bold text-sm text-slate-900">
              Website Launcher &amp; Web Browsing
            </div>
            <p>
              Websites like Syosetu and Kakuyomu block embedding inside standard
              web iframes, so web links open in a new tab. For a full built-in
              in-app browser with auto-detected 1-tap downloading, use the{" "}
              <strong>Catalog tab</strong> or the{" "}
              <strong>Android APK</strong>.
            </p>
          </div>
        )}
      </div>

      {/* Resume Last Session (Android) */}
      {nativeMode && lastBrowserUrl && (
        <button
          type="button"
          onClick={() => onOpenInBrowser(lastBrowserUrl)}
          className="w-full p-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-left flex items-center justify-between gap-3 shadow-sm hover:opacity-95 transition-opacity cursor-pointer"
        >
          <div className="min-w-0">
            <div className="text-xs font-bold">Resume Last Browser Page</div>
            <div className="text-[11px] text-white/80 truncate">
              {lastBrowserUrl}
            </div>
          </div>
          <span className="shrink-0 text-sm font-bold">Open →</span>
        </button>
      )}

      {/* Custom URL / Search Launcher */}
      <form onSubmit={handleOpenCustom} className="flex gap-2">
        <input
          type="text"
          value={customUrl}
          onChange={(e) => setCustomUrl(e.target.value)}
          placeholder="Enter any URL or search Narou..."
          className="flex-1 px-3.5 py-2.5 text-sm border border-gray-300 rounded-xl bg-white text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
        />
        <button
          type="submit"
          className="px-4 py-2.5 rounded-xl bg-slate-800 text-white text-sm font-semibold hover:bg-slate-900 transition-colors cursor-pointer shrink-0"
        >
          {nativeMode ? "Open" : "Go ↗"}
        </button>
      </form>

      {/* Supported Site Cards */}
      <div className="space-y-2.5">
        <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500 px-0.5">
          Supported Novel Websites
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {SUPPORTED_SITES.map((site) => (
            <div
              key={site.id}
              className="p-3.5 rounded-xl border border-gray-200 bg-white flex flex-col justify-between gap-3 hover:border-indigo-300 transition-colors"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-gray-900">
                    {site.name}
                  </span>
                  {site.isR18 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200">
                      R18
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {site.subtitle}
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onOpenInBrowser(site.homeUrl, site.name)}
                  className="flex-1 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors cursor-pointer"
                >
                  {nativeMode ? "Rankings" : "Rankings ↗"}
                </button>
                <button
                  type="button"
                  onClick={() => onOpenInBrowser(site.searchPageUrl, site.name)}
                  className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200 transition-colors cursor-pointer"
                >
                  Search
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Paste from Clipboard (Web convenience) */}
      {!nativeMode && (
        <div className="p-3.5 rounded-xl border border-gray-200 bg-gray-50 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-gray-600">
              Copied a novel URL while browsing?
            </div>
            <button
              type="button"
              onClick={handlePasteAndDownload}
              className="px-3 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-semibold hover:bg-purple-700 transition-colors cursor-pointer shrink-0"
            >
              Paste &amp; Download
            </button>
          </div>
          {clipboardError && (
            <div className="text-[11px] text-red-600">{clipboardError}</div>
          )}
        </div>
      )}
    </div>
  );
}
