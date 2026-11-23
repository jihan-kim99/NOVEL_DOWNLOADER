"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BrowseCatalog from "../components/BrowseCatalog";
import InternalBrowserTab from "../components/InternalBrowserTab";
import {
  isNativeApp,
  nativeFetchKakuyomuEpisode,
  nativeFetchKakuyomuInfo,
  nativeFetchNarouEpisode,
  nativeFetchNarouInfo,
  nativeSaveEpub,
  nativeShareEpub,
  type NativeSavedFile,
} from "../lib/capacitor-native";
import {
  buildChapterXhtml,
  Chapter,
  generateEpub,
  initializeEpub,
} from "../lib/epub";
import { openInternalBrowser } from "../lib/internal-browser";
import {
  CloudBlockError,
  fetchWithFallback,
  probeBrowserBridge,
} from "../lib/narou-client";
import { parseNovelInput } from "../lib/url-parser";
import type { Episode, NovelInfo, QueuedNovel } from "../types";

declare global {
  interface Window {
    __SHARED_NOVEL_URL__?: string;
  }
}

type AppTab = "catalog" | "browser" | "downloader";

const QUEUE_STORAGE_KEY = "novel_downloader_queue_v1";

export default function Home() {
  const [activeTab, setActiveTab] = useState<AppTab>("catalog");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [cloudBlocked, setCloudBlocked] = useState(false);
  const [novelTitle, setNovelTitle] = useState("");
  const [novelAuthor, setNovelAuthor] = useState("");
  const [downloadedCount, setDownloadedCount] = useState(0);
  const [totalEpisodes, setTotalEpisodes] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [concurrency, setConcurrency] = useState(5);
  const [nativeMode, setNativeMode] = useState(false);
  const [bridgeVersion, setBridgeVersion] = useState<string | null>(null);
  const [useBridgeForAll, setUseBridgeForAll] = useState(false);
  const [copiedBookmarklet, setCopiedBookmarklet] = useState(false);
  const [showBypassHelp, setShowBypassHelp] = useState(false);
  const [lastBrowserUrl, setLastBrowserUrl] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueuedNovel[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [readyEpub, setReadyEpub] = useState<{
    url: string;
    blob: Blob;
    fileName: string;
  } | null>(null);
  const [nativeSaved, setNativeSaved] = useState<NativeSavedFile | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 2600);
  }, []);

  const addToQueue = useCallback(
    (item: {
      url: string;
      title?: string;
      author?: string;
      siteLabel?: string;
    }) => {
      const normalizedUrl = item.url.trim();
      if (!normalizedUrl) return;

      let alreadyPresent = false;
      setQueue((prev) => {
        if (prev.some((q) => q.url === normalizedUrl)) {
          alreadyPresent = true;
          return prev;
        }
        const entry: QueuedNovel = {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          url: normalizedUrl,
          title: item.title?.trim() || normalizedUrl,
          author: item.author?.trim() || undefined,
          siteLabel: item.siteLabel?.trim() || undefined,
          addedAt: Date.now(),
        };
        const updated = [...prev, entry];
        try {
          localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(updated));
        } catch {
          // Ignore storage quota issues
        }
        return updated;
      });

      showToast(
        alreadyPresent ? "Already in Download Queue" : "Added to Download Queue"
      );
    },
    [showToast]
  );

  const removeFromQueue = useCallback((url: string) => {
    setQueue((prev) => {
      const updated = prev.filter((q) => q.url !== url);
      try {
        localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // Ignore storage issues
      }
      return updated;
    });
  }, []);

  const clearQueue = useCallback(() => {
    setQueue([]);
    try {
      localStorage.removeItem(QUEUE_STORAGE_KEY);
    } catch {
      // Ignore storage issues
    }
  }, []);

  const queuedUrls = useMemo(
    () => new Set(queue.map((item) => item.url)),
    [queue]
  );

  const attachBookmarkletHref = (el: HTMLAnchorElement | null) => {
    if (!el || typeof window === "undefined") return;
    const code = `javascript:(function(){var s=document.createElement('script');s.src='${window.location.origin}/bookmarklet.js?t='+Date.now();document.head.appendChild(s);})();`;
    el.setAttribute("href", code);
  };

  useEffect(() => {
    let active = true;
    const isNative = isNativeApp();

    // Load persisted download queue
    try {
      const saved = localStorage.getItem(QUEUE_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          queueMicrotask(() => {
            if (active) setQueue(parsed);
          });
        }
      }
    } catch {
      // Ignore malformed storage
    }

    const onBrowserQueue = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          url?: string;
          title?: string;
          siteLabel?: string;
        }>
      ).detail;
      if (detail && typeof detail.url === "string" && detail.url.trim()) {
        addToQueue({
          url: detail.url.trim(),
          title: detail.title,
          siteLabel: detail.siteLabel,
        });
      }
    };
    window.addEventListener("novel-browser-queue", onBrowserQueue);

    if (isNative) {
      queueMicrotask(() => {
        if (!active) return;
        setNativeMode(true);
        if (window.__SHARED_NOVEL_URL__) {
          setInput(window.__SHARED_NOVEL_URL__);
          setActiveTab("downloader");
          delete window.__SHARED_NOVEL_URL__;
        }
      });

      const onSharedUrl = (event: Event) => {
        const detail = (event as CustomEvent<string>).detail;
        if (typeof detail === "string" && detail.trim()) {
          setInput(detail.trim());
          setActiveTab("downloader");
        }
      };

      window.addEventListener("novel-shared-url", onSharedUrl);
      return () => {
        active = false;
        window.removeEventListener("novel-shared-url", onSharedUrl);
        window.removeEventListener("novel-browser-queue", onBrowserQueue);
      };
    }

    const onMessage = (event: MessageEvent) => {
      if (
        event.source === window &&
        event.data &&
        event.data.type === "NOVEL_DL_PONG"
      ) {
        setBridgeVersion(String(event.data.version || "2.0.0"));
      }
    };

    window.addEventListener("message", onMessage);
    probeBrowserBridge(600).then((ver) => {
      if (active && ver) setBridgeVersion(ver);
    });

    return () => {
      active = false;
      window.removeEventListener("message", onMessage);
      window.removeEventListener("novel-browser-queue", onBrowserQueue);
    };
  }, [addToQueue]);

  useEffect(() => {
    return () => {
      if (readyEpub) {
        URL.revokeObjectURL(readyEpub.url);
      }
    };
  }, [readyEpub]);

  const handleShareEpub = async () => {
    if (nativeSaved) {
      try {
        await nativeShareEpub(nativeSaved);
      } catch {
        // User cancelled share sheet
      }
      return;
    }

    if (!readyEpub || typeof navigator === "undefined" || !navigator.share) {
      return;
    }
    try {
      const file = new File([readyEpub.blob], readyEpub.fileName, {
        type: "application/epub+zip",
      });
      await navigator.share({ files: [file], title: readyEpub.fileName });
    } catch {
      // User cancelled share sheet
    }
  };

  const handleCopyBookmarklet = async () => {
    const code = `javascript:(function(){var s=document.createElement('script');s.src='${window.location.origin}/bookmarklet.js?t='+Date.now();document.head.appendChild(s);})();`;
    try {
      await navigator.clipboard.writeText(code);
      setCopiedBookmarklet(true);
      setTimeout(() => setCopiedBookmarklet(false), 2000);
    } catch {
      // Fallback ignored
    }
  };

  const handleCancel = () => {
    abortControllerRef.current?.abort();
  };

  /**
   * Core single-novel download execution. Returns true on success, false on error/cancel.
   */
  const executeNovelDownload = useCallback(
    async (
      rawUrl: string,
      controller: AbortController
    ): Promise<"success" | "cancelled" | "error"> => {
      setIsError(false);
      setCloudBlocked(false);
      setStatus("Initializing...");
      setNovelTitle("");
      setNovelAuthor("");
      setDownloadedCount(0);
      setTotalEpisodes(null);
      setNativeSaved(null);
      setReadyEpub((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return null;
      });

      try {
        const parsed = parseNovelInput(rawUrl);
        const { platform, bookId, explicitDomain, siteLabel } = parsed;
        let domain = parsed.domain;

        const apiEndpoint =
          platform === "narou" ? "/api/narou" : "/api/kakuyomu";
        const bridgeAvailable = Boolean(bridgeVersion);
        const preferBridge =
          bridgeAvailable && (platform === "narou" || useBridgeForAll);

        setStatus(
          nativeMode
            ? `Fetching novel info from ${siteLabel} directly...`
            : preferBridge
            ? `Fetching novel info from ${siteLabel} via Browser Helper...`
            : `Fetching novel info from ${siteLabel}...`
        );

        let info: NovelInfo;
        if (nativeMode) {
          info =
            platform === "narou"
              ? await nativeFetchNarouInfo(bookId, domain, controller.signal)
              : await nativeFetchKakuyomuInfo(bookId, controller.signal);
        } else {
          const targetUrlForInfo =
            platform === "narou"
              ? `https://${domain}/${bookId}/`
              : `https://kakuyomu.jp/works/${bookId}`;

          info = await fetchWithFallback<NovelInfo>(
            apiEndpoint,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: controller.signal,
              body: JSON.stringify({
                type: "info",
                bookId,
                platform,
                domain,
                explicitDomain,
              }),
            },
            "parse-info",
            targetUrlForInfo,
            setStatus,
            preferBridge,
            bridgeAvailable
          );
        }

        if (info.domain) {
          domain = info.domain;
        }

        setNovelTitle(info.title);
        if (info.author) setNovelAuthor(info.author);
        if (info.totalEpisodes) setTotalEpisodes(info.totalEpisodes);
        setStatus(`Found novel: ${info.title}`);

        const { zip, oebps } = initializeEpub();
        const chapters: Chapter[] = [];

        const fetchSingleEpisode = async (epUrl: string): Promise<Episode> => {
          if (nativeMode) {
            return platform === "narou"
              ? nativeFetchNarouEpisode(epUrl, controller.signal)
              : nativeFetchKakuyomuEpisode(epUrl, controller.signal);
          }
          return fetchWithFallback<Episode>(
            apiEndpoint,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: controller.signal,
              body: JSON.stringify({
                type: "episode",
                url: epUrl,
                userAgent: info.userAgent,
                platform,
                domain,
              }),
            },
            "parse-episode",
            epUrl,
            setStatus,
            preferBridge,
            bridgeAvailable
          );
        };

        const episodeUrls = info.episodeUrls;
        if (episodeUrls && episodeUrls.length > 0) {
          const total = episodeUrls.length;
          setTotalEpisodes(total);
          const workerCount = Math.max(1, Math.min(concurrency, total));
          const orderedEpisodes: Array<Episode | null> = new Array(total).fill(
            null
          );
          let nextIndex = 0;
          let completed = 0;

          setStatus(
            `Downloading ${total} episodes (${workerCount}x concurrent)...`
          );

          const worker = async (workerId: number) => {
            if (workerId > 0) {
              await new Promise((r) => setTimeout(r, workerId * 60));
            }
            while (true) {
              if (controller.signal.aborted) {
                throw new DOMException("Download cancelled", "AbortError");
              }
              const idx = nextIndex++;
              if (idx >= total) return;

              const ep = await fetchSingleEpisode(episodeUrls[idx]);
              orderedEpisodes[idx] = ep;
              completed++;
              setDownloadedCount(completed);
              setStatus(
                `Downloading ${completed} / ${total} episodes (${workerCount}x)...`
              );
            }
          };

          await Promise.all(
            Array.from({ length: workerCount }, (_, wIdx) => worker(wIdx))
          );

          let chapterNum = 1;
          for (const ep of orderedEpisodes) {
            if (!ep || !ep.content) continue;
            const fileName = `chapter_${chapterNum}.xhtml`;
            oebps.file(fileName, buildChapterXhtml(ep.title, ep.content));
            chapters.push({ title: ep.title, fileName });
            chapterNum++;
          }
        } else {
          const visitedUrls = new Set<string>();
          let currentUrl: string | null = info.firstUrl;
          let episodeNum = 1;

          while (currentUrl) {
            if (controller.signal.aborted) {
              throw new DOMException("Download cancelled", "AbortError");
            }
            if (visitedUrls.has(currentUrl)) {
              break;
            }
            visitedUrls.add(currentUrl);

            setStatus(
              info.totalEpisodes
                ? `Downloading episode ${episodeNum} of ${info.totalEpisodes}...`
                : `Downloading episode ${episodeNum}...`
            );

            const ep = await fetchSingleEpisode(currentUrl);
            if (!ep.content) {
              break;
            }

            const fileName = `chapter_${episodeNum}.xhtml`;
            oebps.file(fileName, buildChapterXhtml(ep.title, ep.content));
            chapters.push({ title: ep.title, fileName });

            setDownloadedCount(episodeNum);
            currentUrl = ep.nextUrl;
            episodeNum++;

            if (currentUrl) {
              await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(resolve, 150);
                controller.signal.addEventListener(
                  "abort",
                  () => {
                    clearTimeout(timer);
                    reject(
                      new DOMException("Download cancelled", "AbortError")
                    );
                  },
                  { once: true }
                );
              });
            }
          }
        }

        if (chapters.length === 0) {
          throw new Error(
            "No readable episode content was found for this novel."
          );
        }

        setStatus("Generating EPUB...");
        const generated = await generateEpub(
          info.title,
          bookId,
          chapters,
          zip,
          info.author,
          !nativeMode
        );

        if (nativeMode) {
          setStatus("Saving EPUB to device...");
          const saved = await nativeSaveEpub(
            generated.blob,
            generated.fileName
          );
          setNativeSaved(saved);
          setStatus(
            `Saved to ${saved.documentsPath} (${chapters.length} episodes)`
          );
        } else {
          setReadyEpub({
            url: URL.createObjectURL(generated.blob),
            blob: generated.blob,
            fileName: generated.fileName,
          });
          setStatus(`Download complete! (${chapters.length} episodes saved)`);
        }
        return "success";
      } catch (error: unknown) {
        if (
          (error instanceof DOMException || error instanceof Error) &&
          error.name === "AbortError"
        ) {
          setStatus("Download cancelled.");
          setIsError(false);
          return "cancelled";
        }
        console.error(error);
        if (error instanceof CloudBlockError) {
          setCloudBlocked(true);
          setShowBypassHelp(true);
        }
        const message =
          error instanceof Error ? error.message : "Unknown error occurred";
        setStatus(`Error: ${message}`);
        setIsError(true);
        return "error";
      }
    },
    [bridgeVersion, concurrency, nativeMode, useBridgeForAll]
  );

  const startSingleDownload = useCallback(
    async (targetUrl: string, switchToDownloader = true) => {
      if (loadingRef.current) {
        showToast("A download is already running — added to queue instead.");
        addToQueue({ url: targetUrl });
        return;
      }

      setInput(targetUrl);
      if (switchToDownloader) {
        setActiveTab("downloader");
      }

      setLoading(true);
      setBatchProgress(null);
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const outcome = await executeNovelDownload(targetUrl, controller);
        if (outcome === "success") {
          removeFromQueue(targetUrl);
        }
      } finally {
        abortControllerRef.current = null;
        setLoading(false);
      }
    },
    [addToQueue, executeNovelDownload, removeFromQueue, showToast]
  );

  const handleDownloadFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await startSingleDownload(input, false);
  };

  const handleDownloadAllQueue = async () => {
    if (loadingRef.current || queue.length === 0) return;
    const snapshot = [...queue];
    setLoading(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    let succeeded = 0;
    try {
      for (let i = 0; i < snapshot.length; i++) {
        if (controller.signal.aborted) break;
        const item = snapshot[i];
        setBatchProgress({ current: i + 1, total: snapshot.length });
        setInput(item.url);

        const outcome = await executeNovelDownload(item.url, controller);
        if (outcome === "success") {
          succeeded++;
          removeFromQueue(item.url);
        } else if (outcome === "cancelled") {
          break;
        }
      }

      if (!controller.signal.aborted && snapshot.length > 1) {
        setStatus(
          `Batch finished: ${succeeded} / ${snapshot.length} novels downloaded.`
        );
      }
    } finally {
      abortControllerRef.current = null;
      setBatchProgress(null);
      setLoading(false);
    }
  };

  const handleOpenInBrowser = useCallback(
    async (url: string, title?: string) => {
      try {
        const result = await openInternalBrowser(url, title);
        if (result.lastUrl) {
          setLastBrowserUrl(result.lastUrl);
        }
        if (result.action === "download" && result.url) {
          await startSingleDownload(result.url, true);
        }
      } catch (err) {
        console.error("Internal browser error:", err);
      }
    },
    [startSingleDownload]
  );

  const progressPercent =
    totalEpisodes && totalEpisodes > 0
      ? Math.min(100, Math.round((downloadedCount / totalEpisodes) * 100))
      : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex flex-col items-center py-4 px-3 sm:py-8 sm:px-4 font-[family-name:var(--font-geist-sans)]">
      <main className="bg-white/95 backdrop-blur-md p-4 sm:p-6 rounded-2xl shadow-2xl w-full max-w-2xl transition-all duration-300">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-purple-600">
              Novel Downloader
            </h1>
            <p className="text-[11px] text-gray-500">
              Browse &amp; download EPUBs from Narou, Kakuyomu, Nocturne,
              Moonlight &amp; Midnight
            </p>
          </div>

          {/* Compact Connection Status Pill */}
          <button
            type="button"
            onClick={() => {
              if (!nativeMode && !bridgeVersion) {
                setActiveTab("downloader");
                setShowBypassHelp((v) => !v);
              }
            }}
            className={`px-2.5 py-1 rounded-full border text-[11px] font-semibold flex items-center gap-1.5 shrink-0 ${
              nativeMode || bridgeVersion
                ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                : "bg-amber-50 border-amber-200 text-amber-900 cursor-pointer hover:bg-amber-100"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                nativeMode || bridgeVersion ? "bg-emerald-500" : "bg-amber-500"
              }`}
            />
            {nativeMode
              ? "Android Native"
              : bridgeVersion
              ? `Helper v${bridgeVersion}`
              : "Web Mode • Setup"}
          </button>
        </div>

        {/* Main 3-Tab Navigation */}
        <nav
          aria-label="Primary sections"
          className="grid grid-cols-3 gap-1.5 p-1 mb-5 rounded-xl bg-gray-100 border border-gray-200"
        >
          <button
            type="button"
            onClick={() => setActiveTab("catalog")}
            className={`py-2 px-2 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
              activeTab === "catalog"
                ? "bg-white text-indigo-700 shadow-xs"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Catalog
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("browser")}
            className={`py-2 px-2 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
              activeTab === "browser"
                ? "bg-white text-indigo-700 shadow-xs"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {nativeMode ? "Web Browser" : "Sites"}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("downloader")}
            className={`py-2 px-2 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === "downloader"
                ? "bg-white text-indigo-700 shadow-xs"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <span>Downloader</span>
            {loading && (
              <span className="w-2 h-2 rounded-full bg-purple-600 animate-ping" />
            )}
            {!loading && queue.length > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-indigo-600 text-white leading-none">
                {queue.length}
              </span>
            )}
          </button>
        </nav>

        {/* Tab 1: Built-in Search & Rankings Catalog (kept mounted to preserve browse state) */}
        <div className={activeTab === "catalog" ? "block" : "hidden"}>
          <BrowseCatalog
            nativeMode={nativeMode}
            isDownloading={loading}
            queuedUrls={queuedUrls}
            onDownloadNovel={(url) => startSingleDownload(url, true)}
            onQueueNovel={addToQueue}
            onOpenInBrowser={handleOpenInBrowser}
          />
        </div>

        {/* Tab 2: Internal WebView Browser / Supported Sites Launcher */}
        {activeTab === "browser" && (
          <InternalBrowserTab
            nativeMode={nativeMode}
            lastBrowserUrl={lastBrowserUrl}
            onOpenInBrowser={handleOpenInBrowser}
            onQuickDownloadUrl={(url) => startSingleDownload(url, true)}
          />
        )}

        {/* Tab 3: Direct Downloader, Queue & Setup */}
        {activeTab === "downloader" && (
          <div className="space-y-5">
            {/* Connection Mode Info Banner */}
            <div
              className={`px-3.5 py-2.5 rounded-xl border text-xs flex items-center justify-between gap-2 ${
                nativeMode || bridgeVersion
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : "bg-amber-50 border-amber-200 text-amber-900"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    nativeMode || bridgeVersion
                      ? "bg-emerald-500"
                      : "bg-amber-500"
                  }`}
                />
                {nativeMode ? (
                  <span>
                    <strong>Native Android Mode</strong> — Direct device fetch
                    (no cloud IP blocks, R18 <code>over18=yes</code> enabled)
                  </span>
                ) : bridgeVersion ? (
                  <span>
                    <strong>Browser Helper Active (v{bridgeVersion})</strong> —
                    Narou &amp; R18 fetch directly via your browser IP &amp;
                    over18 cookie
                  </span>
                ) : (
                  <span>
                    <strong>Server Mode</strong> — Syosetu blocks Vercel/cloud
                    IPs. For Narou &amp; R18 downloads on web, enable the helper
                    or Android app.
                  </span>
                )}
              </div>
              {!nativeMode && !bridgeVersion && (
                <button
                  type="button"
                  onClick={() => setShowBypassHelp((v) => !v)}
                  className="shrink-0 font-semibold text-purple-700 underline hover:text-purple-900 cursor-pointer"
                >
                  {showBypassHelp ? "Hide" : "Setup"}
                </button>
              )}
            </div>

            <form
              onSubmit={handleDownloadFormSubmit}
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="url"
                  className="text-sm font-semibold text-gray-700"
                >
                  Novel URL or ID
                </label>
                <input
                  id="url"
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="kakuyomu.jp/works/..., ncode.syosetu.com/..., novel18.syosetu.com/..."
                  className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all text-gray-800 placeholder-gray-400 text-sm"
                  required
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor="concurrency"
                  className="text-sm font-medium text-gray-700"
                >
                  Download Concurrency
                </label>
                <select
                  id="concurrency"
                  value={concurrency}
                  onChange={(e) => setConcurrency(Number(e.target.value))}
                  disabled={loading}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white text-gray-800 focus:ring-2 focus:ring-purple-500 outline-none disabled:opacity-50"
                >
                  <option value={1}>1x (Sequential / Safest)</option>
                  <option value={3}>3x (Balanced)</option>
                  <option value={5}>5x (Fast — Recommended)</option>
                  <option value={8}>8x (Max Speed)</option>
                </select>
              </div>

              {!nativeMode && bridgeVersion && (
                <div className="flex items-center gap-2">
                  <input
                    id="useBridgeForAll"
                    type="checkbox"
                    checked={useBridgeForAll}
                    onChange={(e) => setUseBridgeForAll(e.target.checked)}
                    className="w-4 h-4 text-purple-600 bg-gray-100 border-gray-300 rounded focus:ring-purple-500 focus:ring-2"
                  />
                  <label
                    htmlFor="useBridgeForAll"
                    className="text-sm font-medium text-gray-700"
                  >
                    Also use Browser Helper for Kakuyomu
                  </label>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold py-3 px-4 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed shadow-md cursor-pointer"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg
                        className="animate-spin h-5 w-5 text-white"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        ></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                      Processing...
                    </span>
                  ) : (
                    "Download EPUB"
                  )}
                </button>

                {loading && (
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="px-4 py-3 rounded-xl bg-red-500 text-white font-semibold hover:bg-red-600 transition-colors shadow-md cursor-pointer"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>

            {/* Download Status Card */}
            {(novelTitle || status) && (
              <div className="p-4 sm:p-5 bg-gray-50 rounded-xl border border-gray-200 shadow-inner">
                {batchProgress && (
                  <div className="mb-2 text-xs font-bold text-indigo-700">
                    Queue Batch: Novel {batchProgress.current} of{" "}
                    {batchProgress.total}
                  </div>
                )}

                {novelTitle && (
                  <div className="mb-3 pb-3 border-b border-gray-200">
                    <h2 className="text-[11px] text-gray-500 uppercase tracking-wide font-semibold mb-1">
                      Target Novel
                    </h2>
                    <p className="text-base font-bold text-gray-800">
                      {novelTitle}
                    </p>
                    {novelAuthor && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        {novelAuthor}
                      </p>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex justify-between items-start gap-3">
                    <span className="text-sm font-medium text-gray-600 shrink-0">
                      Status
                    </span>
                    <span
                      className={`text-sm font-bold text-right ${
                        isError ? "text-red-600" : "text-purple-600"
                      }`}
                    >
                      {status}
                    </span>
                  </div>

                  {downloadedCount > 0 && (
                    <div className="mt-2">
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>Progress</span>
                        <span>
                          {totalEpisodes
                            ? `${downloadedCount} / ${totalEpisodes} episodes (${progressPercent}%)`
                            : `${downloadedCount} episodes`}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-blue-500 to-purple-500 h-2.5 rounded-full transition-all duration-300 ease-out"
                          style={{
                            width:
                              progressPercent !== null
                                ? `${progressPercent}%`
                                : "100%",
                          }}
                        >
                          {loading && (
                            <div className="w-full h-full animate-pulse bg-white/30"></div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {nativeSaved && (
                    <div className="pt-3 flex gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={handleShareEpub}
                        className="flex-1 bg-emerald-600 text-white text-sm font-bold py-2.5 px-4 rounded-lg hover:bg-emerald-700 transition-colors cursor-pointer"
                      >
                        Open / Share EPUB
                      </button>
                    </div>
                  )}

                  {!nativeMode && readyEpub && (
                    <div className="pt-3 flex gap-2 flex-wrap">
                      <a
                        href={readyEpub.url}
                        download={readyEpub.fileName}
                        className="flex-1 text-center bg-emerald-600 text-white text-sm font-bold py-2.5 px-4 rounded-lg hover:bg-emerald-700 transition-colors"
                      >
                        Save EPUB File
                      </a>
                      {typeof navigator !== "undefined" &&
                        typeof navigator.share === "function" && (
                          <button
                            type="button"
                            onClick={handleShareEpub}
                            className="flex-1 bg-indigo-600 text-white text-sm font-bold py-2.5 px-4 rounded-lg hover:bg-indigo-700 transition-colors cursor-pointer"
                          >
                            Share / Open in Books
                          </button>
                        )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Download Queue Section */}
            {queue.length > 0 && (
              <div className="p-4 rounded-xl border border-indigo-200 bg-indigo-50/50 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-bold text-indigo-950">
                    Download Queue ({queue.length})
                  </h2>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={loading}
                      onClick={handleDownloadAllQueue}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
                    >
                      ⬇ Download All
                    </button>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={clearQueue}
                      className="px-2.5 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-600 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50 cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="space-y-2 max-h-64 overflow-y-auto pr-0.5">
                  {queue.map((item) => (
                    <div
                      key={item.id}
                      className="p-2.5 rounded-lg bg-white border border-gray-200 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-gray-900 truncate">
                          {item.title}
                        </div>
                        <div className="text-[11px] text-gray-500 truncate">
                          {item.siteLabel ? `${item.siteLabel} • ` : ""}
                          {item.url}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => startSingleDownload(item.url, false)}
                          className="px-2.5 py-1.5 rounded-md bg-purple-600 text-white text-[11px] font-bold hover:bg-purple-700 disabled:opacity-50 cursor-pointer"
                        >
                          Download
                        </button>
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => removeFromQueue(item.url)}
                          aria-label="Remove from queue"
                          className="px-2 py-1.5 rounded-md bg-gray-100 text-gray-600 text-[11px] font-bold hover:bg-red-100 hover:text-red-700 disabled:opacity-50 cursor-pointer"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Cloud-IP / R18 Age-Verification Bypass Helper Panel (Web only) */}
            {!nativeMode &&
              (showBypassHelp || cloudBlocked) &&
              !bridgeVersion && (
                <div
                  className={`p-5 rounded-xl border text-xs space-y-4 ${
                    cloudBlocked
                      ? "bg-red-50 border-red-200 text-gray-800"
                      : "bg-indigo-50/70 border-indigo-200 text-gray-800"
                  }`}
                >
                  <div>
                    <h3 className="text-sm font-bold text-gray-900 mb-1">
                      Bypass Narou Cloud-IP Blocks &amp; R18 Age Verification
                    </h3>
                    <p className="text-gray-600 leading-relaxed">
                      Syosetu blocks datacenter IPs (like Vercel/AWS) and public
                      CORS proxies cannot send the <code>over18=yes</code>{" "}
                      cookie. Pick the option that fits Desktop or Mobile:
                    </p>
                  </div>

                  <div className="p-3 bg-white rounded-lg border border-gray-200 space-y-2">
                    <div className="font-bold text-gray-900">
                      Option 1: Helper Userscript (Desktop &amp; Mobile Safari /
                      Firefox)
                    </div>
                    <p className="text-gray-600 leading-relaxed">
                      <strong>Desktop:</strong>{" "}
                      <a
                        href="https://www.tampermonkey.net/"
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 underline"
                      >
                        Tampermonkey
                      </a>{" "}
                      or{" "}
                      <a
                        href="https://violentmonkey.github.io/"
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 underline"
                      >
                        Violentmonkey
                      </a>
                      .<br />
                      <strong>iPhone / iPad (Safari):</strong> Install the free{" "}
                      <a
                        href="https://apps.apple.com/app/userscripts/id1463298887"
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 underline"
                      >
                        Userscripts
                      </a>{" "}
                      Safari extension, then install the script below.
                      <br />
                      <strong>Android:</strong> Install the native APK from
                      GitHub Releases, or use{" "}
                      <strong>Firefox for Android</strong> +{" "}
                      <strong>Violentmonkey</strong>.
                    </p>
                    <a
                      href="/novel-downloader.user.js"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block bg-indigo-600 text-white font-semibold px-3.5 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
                    >
                      Install Helper Userscript (.user.js)
                    </a>
                  </div>

                  <div className="p-3 bg-white rounded-lg border border-gray-200 space-y-2">
                    <div className="font-bold text-gray-900">
                      Option 2: Zero-Extension Bookmarklet (Stock iOS Safari
                      &amp; Android Chrome)
                    </div>
                    <p className="text-gray-600 leading-relaxed">
                      <strong>On Desktop:</strong> Drag the purple button to
                      your bookmarks bar.
                      <br />
                      <strong>On Mobile (no apps needed):</strong> Tap{" "}
                      <strong>Copy Bookmarklet Code</strong> → bookmark any page
                      → edit that bookmark&apos;s URL and paste the code (name
                      it <code>dl</code>). Then open a novel on{" "}
                      <code>ncode.syosetu.com</code>,{" "}
                      <code>novel18.syosetu.com</code>, or{" "}
                      <code>kakuyomu.jp</code>, type <code>dl</code> in the
                      address bar, and tap the bookmark!
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <a
                        ref={attachBookmarkletHref}
                        href="#bookmarklet"
                        onClick={(e) => {
                          e.preventDefault();
                          alert(
                            "Desktop: drag this button to your bookmarks bar.\nMobile: tap 'Copy Bookmarklet Code', edit any bookmark's URL to paste it, then run it from the address bar on a Narou / novel18 / Kakuyomu page."
                          );
                        }}
                        className="inline-block bg-purple-600 text-white font-semibold px-3.5 py-2 rounded-lg hover:bg-purple-700 cursor-grab transition-colors"
                      >
                        Download Novel EPUB
                      </a>
                      <button
                        type="button"
                        onClick={handleCopyBookmarklet}
                        className="px-3 py-2 rounded-lg border border-gray-300 bg-gray-50 hover:bg-gray-100 font-medium text-gray-700 cursor-pointer"
                      >
                        {copiedBookmarklet ? "Copied!" : "Copy Bookmarklet Code"}
                      </button>
                    </div>
                  </div>

                  <div className="p-3 bg-white rounded-lg border border-gray-200 space-y-1.5">
                    <div className="font-bold text-gray-900">
                      Option 3: Stock Mobile Browser directly on Vercel
                      (Self-Hosted Home Relay)
                    </div>
                    <p className="text-gray-600 leading-relaxed">
                      To make stock mobile browsers work directly on this Vercel
                      page with zero phone setup, run{" "}
                      <code>PROXY_TOKEN=secret node proxy/server.mjs</code> on a
                      home PC/Pi behind <code>cloudflared tunnel</code> and set{" "}
                      <code>SYOSETU_PROXY_URL</code> &amp;{" "}
                      <code>SYOSETU_PROXY_TOKEN</code> in Vercel Environment
                      Variables.
                    </p>
                  </div>
                </div>
              )}
          </div>
        )}
      </main>

      {/* Floating Mini Download Progress Bar when browsing other tabs */}
      {loading && activeTab !== "downloader" && (
        <button
          type="button"
          onClick={() => setActiveTab("downloader")}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md px-4 py-3 rounded-xl bg-slate-900/95 text-white shadow-xl border border-slate-700 flex items-center justify-between gap-3 cursor-pointer z-40"
        >
          <div className="min-w-0 text-left">
            <div className="text-xs font-bold truncate">
              {novelTitle || "Downloading novel..."}
            </div>
            <div className="text-[11px] text-slate-300 truncate">{status}</div>
          </div>
          <span className="shrink-0 px-2.5 py-1 rounded-lg bg-indigo-600 text-[11px] font-bold">
            {progressPercent !== null ? `${progressPercent}%` : "View"}
          </span>
        </button>
      )}

      {/* Subtle Toast Feedback */}
      {toastMessage && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-slate-900 text-white text-xs font-semibold shadow-lg z-50">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
