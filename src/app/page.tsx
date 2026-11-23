"use client";

import { saveAs } from "file-saver";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BrowseCatalog from "../components/BrowseCatalog";
import InternalBrowserTab from "../components/InternalBrowserTab";
import NovelLibrary from "../components/NovelLibrary";
import {
  isNativeApp,
  nativeCheckNovelUpdate,
  nativeDeleteCachedEpub,
  nativeFetchKakuyomuEpisode,
  nativeFetchKakuyomuInfo,
  nativeFetchNarouEpisode,
  nativeFetchNarouInfo,
  nativeSaveEpub,
  nativeShareEpub,
  nativeShareLibraryEpub,
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
  buildCanonicalNovelUrl,
  buildLibraryNovelId,
  deleteLibraryAssets,
  formatSiteLabelFromDomain,
  getLibraryChapters,
  getLibraryEpub,
  loadLibraryNovels,
  saveLibraryAssets,
  saveLibraryNovels,
  upsertLibraryNovel,
} from "../lib/library-storage";
import {
  AgeAuthError,
  CloudBlockError,
  fetchWithFallback,
  probeBrowserBridge,
} from "../lib/narou-client";
import { parseNovelInput } from "../lib/url-parser";
import type {
  CachedEpisode,
  Episode,
  LibraryNovel,
  NovelInfo,
  NovelUpdateCheckResult,
  QueuedNovel,
} from "../types";

declare global {
  interface Window {
    __SHARED_NOVEL_URL__?: string;
  }
}

type AppTab = "catalog" | "library" | "browser" | "downloader";

const QUEUE_STORAGE_KEY = "novel_downloader_queue_v1";
const LATEST_BRIDGE_VERSION = "2.1.0";

function isBridgeOutdated(version: string | null): boolean {
  if (!version) return false;
  const parse = (v: string) =>
    v
      .replace(/^v/i, "")
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const current = parse(version);
  const target = parse(LATEST_BRIDGE_VERSION);
  for (let i = 0; i < 3; i++) {
    const a = current[i] || 0;
    const b = target[i] || 0;
    if (a < b) return true;
    if (a > b) return false;
  }
  return false;
}

function normalizeEpisodeUrlKey(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<AppTab>("catalog");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [cloudBlocked, setCloudBlocked] = useState(false);
  const [ageAuthBlockedUrl, setAgeAuthBlockedUrl] = useState<string | null>(
    null
  );
  const [novelTitle, setNovelTitle] = useState("");
  const [novelAuthor, setNovelAuthor] = useState("");
  const [downloadedCount, setDownloadedCount] = useState(0);
  const [totalEpisodes, setTotalEpisodes] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeDownloadNovelId, setActiveDownloadNovelId] = useState<
    string | null
  >(null);
  const [lastSavedLibraryId, setLastSavedLibraryId] = useState<string | null>(
    null
  );
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
  const [library, setLibrary] = useState<LibraryNovel[]>([]);
  const [checkingIds, setCheckingIds] = useState<Set<string>>(new Set());
  const [checkingAllProgress, setCheckingAllProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [readyEpub, setReadyEpub] = useState<{
    url: string;
    blob: Blob;
    fileName: string;
  } | null>(null);
  const [nativeSaved, setNativeSaved] = useState<NativeSavedFile | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const checkAllAbortRef = useRef<AbortController | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingRef = useRef(false);
  const libraryRef = useRef<LibraryNovel[]>([]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    libraryRef.current = library;
  }, [library]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 2600);
  }, []);

  const persistLibraryEntry = useCallback((entry: LibraryNovel) => {
    setLibrary((prev) => {
      const updated = upsertLibraryNovel(prev, entry);
      saveLibraryNovels(updated);
      return updated;
    });
  }, []);

  const patchLibraryEntry = useCallback(
    (id: string, patch: Partial<LibraryNovel>) => {
      setLibrary((prev) => {
        const idx = prev.findIndex((item) => item.id === id);
        if (idx === -1) return prev;
        const updated = [...prev];
        updated[idx] = { ...updated[idx], ...patch };
        saveLibraryNovels(updated);
        return updated;
      });
    },
    []
  );

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

  const libraryById = useMemo(
    () => new Map(library.map((item) => [item.id, item])),
    [library]
  );

  const libraryUpdatesCount = useMemo(
    () => library.filter((item) => item.hasUpdate).length,
    [library]
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

    // Load persisted downloaded novels library
    const savedLibrary = loadLibraryNovels();
    if (savedLibrary.length > 0) {
      queueMicrotask(() => {
        if (active) setLibrary(savedLibrary);
      });
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
   * Core single-novel download execution.
   * Automatically saves/updates the novel in the Library (metadata + cached EPUB & chapters).
   * When forceFull is false and cached chapters match the TOC, fetches only new episodes!
   */
  const executeNovelDownload = useCallback(
    async (
      rawUrl: string,
      controller: AbortController,
      options?: { forceFull?: boolean }
    ): Promise<"success" | "cancelled" | "error"> => {
      const forceFull = Boolean(options?.forceFull);
      setIsError(false);
      setCloudBlocked(false);
      setAgeAuthBlockedUrl(null);
      setStatus("Initializing...");
      setNovelTitle("");
      setNovelAuthor("");
      setDownloadedCount(0);
      setTotalEpisodes(null);
      setNativeSaved(null);
      setLastSavedLibraryId(null);
      setReadyEpub((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return null;
      });

      try {
        const parsed = parseNovelInput(rawUrl);
        const { platform, bookId, explicitDomain, siteLabel } = parsed;
        let domain = parsed.domain;
        const novelId = buildLibraryNovelId(platform, bookId);
        setActiveDownloadNovelId(novelId);

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
        const cachedEpisodesToSave: CachedEpisode[] = [];

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

          // Check whether we can reuse already-cached chapters for a fast incremental update
          const cachedMap = new Map<string, CachedEpisode>();
          if (!forceFull) {
            const existingCached = await getLibraryChapters(novelId);
            if (existingCached) {
              for (const ep of existingCached) {
                if (ep.url && ep.content) {
                  cachedMap.set(normalizeEpisodeUrlKey(ep.url), ep);
                }
              }
            }
          }

          const orderedEpisodes: Array<CachedEpisode | null> = new Array(
            total
          ).fill(null);
          const missingIndices: number[] = [];

          for (let i = 0; i < total; i++) {
            const epUrl = episodeUrls[i];
            const cached = cachedMap.get(normalizeEpisodeUrlKey(epUrl));
            if (cached) {
              orderedEpisodes[i] = {
                url: epUrl,
                title: cached.title,
                content: cached.content,
              };
            } else {
              missingIndices.push(i);
            }
          }

          const reusedCount = total - missingIndices.length;
          let completed = reusedCount;
          if (reusedCount > 0) {
            setDownloadedCount(completed);
          }

          if (missingIndices.length > 0) {
            const workerCount = Math.max(
              1,
              Math.min(concurrency, missingIndices.length)
            );
            let cursor = 0;

            setStatus(
              reusedCount > 0
                ? `Fast update: downloading ${missingIndices.length} new episodes (${reusedCount} cached)...`
                : `Downloading ${total} episodes (${workerCount}x concurrent)...`
            );

            const worker = async (workerId: number) => {
              if (workerId > 0) {
                await new Promise((r) => setTimeout(r, workerId * 60));
              }
              while (true) {
                if (controller.signal.aborted) {
                  throw new DOMException("Download cancelled", "AbortError");
                }
                const slot = cursor++;
                if (slot >= missingIndices.length) return;
                const idx = missingIndices[slot];
                const epUrl = episodeUrls[idx];

                const ep = await fetchSingleEpisode(epUrl);
                orderedEpisodes[idx] = {
                  url: epUrl,
                  title: ep.title,
                  content: ep.content,
                };
                completed++;
                setDownloadedCount(completed);
                setStatus(
                  reusedCount > 0
                    ? `Updating ${completed} / ${total} episodes (${missingIndices.length} new)...`
                    : `Downloading ${completed} / ${total} episodes (${workerCount}x)...`
                );
              }
            };

            await Promise.all(
              Array.from({ length: workerCount }, (_, wIdx) => worker(wIdx))
            );
          } else {
            setStatus(
              `All ${total} episodes already cached — rebuilding EPUB...`
            );
          }

          let chapterNum = 1;
          for (const ep of orderedEpisodes) {
            if (!ep || !ep.content) continue;
            const fileName = `chapter_${chapterNum}.xhtml`;
            oebps.file(fileName, buildChapterXhtml(ep.title, ep.content));
            chapters.push({ title: ep.title, fileName });
            cachedEpisodesToSave.push(ep);
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
            cachedEpisodesToSave.push({
              url: currentUrl,
              title: ep.title,
              content: ep.content,
            });

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

        let savedNativeFile: NativeSavedFile | undefined;
        if (nativeMode) {
          setStatus("Saving EPUB to device...");
          const saved = await nativeSaveEpub(
            generated.blob,
            generated.fileName
          );
          savedNativeFile = saved;
          setNativeSaved(saved);
        } else {
          setReadyEpub({
            url: URL.createObjectURL(generated.blob),
            blob: generated.blob,
            fileName: generated.fileName,
          });
        }

        // Persist EPUB & chapters to Library automatically
        const assetResult = await saveLibraryAssets(
          novelId,
          { blob: generated.blob, fileName: generated.fileName },
          cachedEpisodesToSave
        );

        const now = Date.now();
        const existingEntry = libraryRef.current.find((n) => n.id === novelId);
        const resolvedStatus =
          info.status ||
          (info.isShortStory ? "short" : undefined) ||
          existingEntry?.status ||
          "unknown";

        const libraryEntry: LibraryNovel = {
          id: novelId,
          platform,
          bookId: platform === "narou" ? bookId.toLowerCase() : bookId,
          domain,
          siteLabel: formatSiteLabelFromDomain(platform, domain),
          url: buildCanonicalNovelUrl(platform, domain, bookId),
          title: info.title,
          author: info.author || existingEntry?.author,
          fileName: generated.fileName,
          fileSize: generated.blob.size,
          downloadedEpisodes: chapters.length,
          latestKnownEpisodes: Math.max(
            chapters.length,
            info.totalEpisodes || chapters.length
          ),
          hasUpdate: false,
          newEpisodeCount: 0,
          status: resolvedStatus,
          isShortStory: info.isShortStory ?? existingEntry?.isShortStory,
          downloadedAt: existingEntry?.downloadedAt ?? now,
          updatedAt: now,
          lastCheckedAt: now,
          remoteUpdatedAt:
            info.remoteUpdatedAt || existingEntry?.remoteUpdatedAt,
          lastCheckError: undefined,
          nativeFile: savedNativeFile || existingEntry?.nativeFile,
          hasCachedEpub: assetResult.savedEpub,
          hasCachedChapters: assetResult.savedChapters,
        };

        persistLibraryEntry(libraryEntry);
        setLastSavedLibraryId(novelId);

        if (savedNativeFile) {
          setStatus(
            `Saved to Library & ${savedNativeFile.documentsPath} (${chapters.length} episodes)`
          );
        } else {
          setStatus(
            `Download complete! Saved to Library (${chapters.length} episodes)`
          );
        }
        showToast(
          existingEntry
            ? `Updated "${info.title}" in Library`
            : `Saved "${info.title}" to Library`
        );
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
        const message =
          error instanceof Error ? error.message : "Unknown error occurred";
        if (error instanceof CloudBlockError) {
          setCloudBlocked(true);
          setShowBypassHelp(true);
        } else if (
          error instanceof AgeAuthError ||
          /age verification/i.test(message)
        ) {
          const fallbackTarget =
            error instanceof AgeAuthError && error.targetUrl
              ? error.targetUrl
              : /^https?:\/\//i.test(rawUrl.trim())
              ? rawUrl.trim()
              : "https://novel18.syosetu.com/";
          setAgeAuthBlockedUrl(fallbackTarget);
        }
        setStatus(`Error: ${message}`);
        setIsError(true);
        return "error";
      } finally {
        setActiveDownloadNovelId(null);
      }
    },
    [
      bridgeVersion,
      concurrency,
      nativeMode,
      persistLibraryEntry,
      showToast,
      useBridgeForAll,
    ]
  );

  const startSingleDownload = useCallback(
    async (
      targetUrl: string,
      switchToDownloader = true,
      options?: { forceFull?: boolean }
    ) => {
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
        const outcome = await executeNovelDownload(
          targetUrl,
          controller,
          options
        );
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
          `Batch finished: ${succeeded} / ${snapshot.length} novels saved to Library.`
        );
      }
    } finally {
      abortControllerRef.current = null;
      setBatchProgress(null);
      setLoading(false);
    }
  };

  const fetchNovelUpdateInfo = useCallback(
    async (
      novel: LibraryNovel,
      signal?: AbortSignal
    ): Promise<NovelUpdateCheckResult> => {
      if (nativeMode) {
        return nativeCheckNovelUpdate(
          novel.platform,
          novel.bookId,
          novel.domain,
          signal
        );
      }

      try {
        const res = await fetch("/api/library/check-update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal,
          body: JSON.stringify({
            platform: novel.platform,
            bookId: novel.bookId,
            domain: novel.domain,
          }),
        });

        if (res.ok) {
          return (await res.json()) as NovelUpdateCheckResult;
        }

        const errData = await res.json().catch(() => null);
        const errMessage =
          (errData && typeof errData.error === "string" && errData.error) ||
          `Update check failed (HTTP ${res.status})`;

        // If Browser Helper is available, fall back to direct browser fetch
        if (bridgeVersion) {
          const apiEndpoint =
            novel.platform === "narou" ? "/api/narou" : "/api/kakuyomu";
          const info = await fetchWithFallback<NovelInfo>(
            apiEndpoint,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal,
              body: JSON.stringify({
                type: "info",
                bookId: novel.bookId,
                platform: novel.platform,
                domain: novel.domain,
                explicitDomain: true,
              }),
            },
            "parse-info",
            novel.url,
            () => {},
            true,
            true
          );

          return {
            title: info.title,
            author: info.author,
            domain: info.domain || novel.domain,
            totalEpisodes:
              info.totalEpisodes ||
              info.episodeUrls?.length ||
              (info.isShortStory ? 1 : novel.downloadedEpisodes),
            status: info.status || (info.isShortStory ? "short" : undefined),
            isShortStory: info.isShortStory,
            remoteUpdatedAt: info.remoteUpdatedAt,
          };
        }

        throw new Error(errMessage);
      } catch (err) {
        if (
          (err instanceof DOMException || err instanceof Error) &&
          err.name === "AbortError"
        ) {
          throw err;
        }
        throw err instanceof Error
          ? err
          : new Error("Failed to check for updates");
      }
    },
    [bridgeVersion, nativeMode]
  );

  const checkSingleNovelUpdate = useCallback(
    async (
      novel: LibraryNovel,
      silent = false,
      signal?: AbortSignal
    ): Promise<{ ok: boolean; hasUpdate: boolean; newCount: number }> => {
      setCheckingIds((prev) => {
        const next = new Set(prev);
        next.add(novel.id);
        return next;
      });

      try {
        const result = await fetchNovelUpdateInfo(novel, signal);
        const now = Date.now();
        const latestTotal = Math.max(
          novel.downloadedEpisodes,
          result.totalEpisodes || 0
        );
        const newEpisodeCount = Math.max(
          0,
          latestTotal - novel.downloadedEpisodes
        );
        const hasUpdate = newEpisodeCount > 0;
        const resolvedDomain = result.domain || novel.domain;

        patchLibraryEntry(novel.id, {
          title: result.title || novel.title,
          author: result.author || novel.author,
          domain: resolvedDomain,
          siteLabel: formatSiteLabelFromDomain(novel.platform, resolvedDomain),
          url: buildCanonicalNovelUrl(
            novel.platform,
            resolvedDomain,
            novel.bookId
          ),
          latestKnownEpisodes: latestTotal,
          hasUpdate,
          newEpisodeCount,
          status:
            result.status && result.status !== "unknown"
              ? result.status
              : novel.status,
          isShortStory: result.isShortStory ?? novel.isShortStory,
          remoteUpdatedAt: result.remoteUpdatedAt || novel.remoteUpdatedAt,
          lastCheckedAt: now,
          lastCheckError: undefined,
        });

        if (!silent) {
          showToast(
            hasUpdate
              ? `+${newEpisodeCount} new ${
                  newEpisodeCount === 1 ? "episode" : "episodes"
                } found for "${result.title || novel.title}"!`
              : `"${result.title || novel.title}" is up to date (${novel.downloadedEpisodes} eps)`
          );
        }

        return { ok: true, hasUpdate, newCount: newEpisodeCount };
      } catch (err) {
        if (
          (err instanceof DOMException || err instanceof Error) &&
          err.name === "AbortError"
        ) {
          return { ok: false, hasUpdate: false, newCount: 0 };
        }
        const message =
          err instanceof Error ? err.message : "Failed to check update";
        patchLibraryEntry(novel.id, {
          lastCheckError: message,
        });
        if (!silent) {
          showToast(`Check failed: ${message}`);
        }
        return { ok: false, hasUpdate: false, newCount: 0 };
      } finally {
        setCheckingIds((prev) => {
          const next = new Set(prev);
          next.delete(novel.id);
          return next;
        });
      }
    },
    [fetchNovelUpdateInfo, patchLibraryEntry, showToast]
  );

  const handleCheckAllUpdates = useCallback(async () => {
    const snapshot = [...libraryRef.current];
    if (snapshot.length === 0 || checkAllAbortRef.current) return;

    const controller = new AbortController();
    checkAllAbortRef.current = controller;
    setCheckingAllProgress({ current: 0, total: snapshot.length });

    let cursor = 0;
    let completed = 0;
    let updatedNovels = 0;
    let totalNewEps = 0;
    let failedCount = 0;

    const workerCount = Math.min(3, snapshot.length);
    const worker = async () => {
      while (true) {
        if (controller.signal.aborted) return;
        const idx = cursor++;
        if (idx >= snapshot.length) return;
        const target = snapshot[idx];
        const res = await checkSingleNovelUpdate(target, true, controller.signal);
        if (controller.signal.aborted) return;
        if (res.ok) {
          if (res.hasUpdate) {
            updatedNovels++;
            totalNewEps += res.newCount;
          }
        } else {
          failedCount++;
        }
        completed++;
        setCheckingAllProgress({ current: completed, total: snapshot.length });
      }
    };

    try {
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
      if (controller.signal.aborted) {
        showToast("Update check cancelled.");
      } else if (updatedNovels > 0) {
        showToast(
          `Found ${totalNewEps} new ${
            totalNewEps === 1 ? "episode" : "episodes"
          } across ${updatedNovels} ${
            updatedNovels === 1 ? "novel" : "novels"
          }!`
        );
      } else if (failedCount > 0) {
        showToast(
          `Checked ${snapshot.length - failedCount}/${snapshot.length} novels (${failedCount} failed).`
        );
      } else {
        showToast(
          `All ${snapshot.length} ${
            snapshot.length === 1 ? "novel is" : "novels are"
          } up to date!`
        );
      }
    } finally {
      checkAllAbortRef.current = null;
      setCheckingAllProgress(null);
    }
  }, [checkSingleNovelUpdate, showToast]);

  const handleCancelCheckAll = useCallback(() => {
    checkAllAbortRef.current?.abort();
  }, []);

  const handleUpdateNovel = useCallback(
    async (novel: LibraryNovel, forceFull = false) => {
      await startSingleDownload(novel.url, true, { forceFull });
    },
    [startSingleDownload]
  );

  const handleUpdateAllOutdated = useCallback(async () => {
    if (loadingRef.current) return;
    const outdated = libraryRef.current.filter((n) => n.hasUpdate);
    if (outdated.length === 0) return;

    setActiveTab("downloader");
    setLoading(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    let succeeded = 0;
    try {
      for (let i = 0; i < outdated.length; i++) {
        if (controller.signal.aborted) break;
        const item = outdated[i];
        setBatchProgress({ current: i + 1, total: outdated.length });
        setInput(item.url);

        const outcome = await executeNovelDownload(item.url, controller, {
          forceFull: false,
        });
        if (outcome === "success") {
          succeeded++;
        } else if (outcome === "cancelled") {
          break;
        }
      }

      if (!controller.signal.aborted && outdated.length > 1) {
        setStatus(
          `Library updates finished: ${succeeded} / ${outdated.length} novels updated.`
        );
      }
    } finally {
      abortControllerRef.current = null;
      setBatchProgress(null);
      setLoading(false);
    }
  }, [executeNovelDownload]);

  const handleOpenOrSaveLibraryEpub = useCallback(
    async (novel: LibraryNovel) => {
      try {
        const cached = await getLibraryEpub(novel.id);
        if (nativeMode) {
          const file = await nativeShareLibraryEpub(
            novel.fileName,
            novel.nativeFile?.shareUri,
            cached?.blob
          );
          patchLibraryEntry(novel.id, { nativeFile: file });
          return;
        }

        if (!cached) {
          showToast(
            "Cached EPUB is no longer in browser storage — tap Re-download to regenerate."
          );
          return;
        }

        saveAs(cached.blob, cached.fileName || novel.fileName);
        showToast(`Saving ${cached.fileName || novel.fileName}`);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Could not open saved EPUB.";
        // Ignore user cancelling Android Share sheet
        if (!/cancel/i.test(msg)) {
          showToast(msg);
        }
      }
    },
    [nativeMode, patchLibraryEntry, showToast]
  );

  const handleShareWebLibraryEpub = useCallback(
    async (novel: LibraryNovel) => {
      if (typeof navigator === "undefined" || !navigator.share) return;
      try {
        const cached = await getLibraryEpub(novel.id);
        if (!cached) {
          showToast(
            "Cached EPUB is no longer in browser storage — tap Re-download first."
          );
          return;
        }
        const fileName = cached.fileName || novel.fileName;
        const file = new File([cached.blob], fileName, {
          type: "application/epub+zip",
        });
        await navigator.share({ files: [file], title: fileName });
      } catch {
        // User cancelled share sheet
      }
    },
    [showToast]
  );

  const handleRemoveLibraryNovel = useCallback(
    async (novel: LibraryNovel) => {
      setLibrary((prev) => {
        const updated = prev.filter((item) => item.id !== novel.id);
        saveLibraryNovels(updated);
        return updated;
      });
      await deleteLibraryAssets(novel.id);
      if (nativeMode) {
        await nativeDeleteCachedEpub(novel.fileName);
      }
      if (lastSavedLibraryId === novel.id) {
        setLastSavedLibraryId(null);
      }
      showToast(`Removed "${novel.title}" from Library`);
    },
    [lastSavedLibraryId, nativeMode, showToast]
  );

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

        {/* Main 4-Tab Navigation */}
        <nav
          aria-label="Primary sections"
          className="grid grid-cols-4 gap-1 p-1 mb-5 rounded-xl bg-gray-100 border border-gray-200"
        >
          <button
            type="button"
            onClick={() => setActiveTab("catalog")}
            className={`py-2 px-1.5 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
              activeTab === "catalog"
                ? "bg-white text-indigo-700 shadow-xs"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Catalog
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("library")}
            className={`py-2 px-1.5 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer flex items-center justify-center gap-1 ${
              activeTab === "library"
                ? "bg-white text-indigo-700 shadow-xs"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <span>Library</span>
            {libraryUpdatesCount > 0 ? (
              <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-amber-500 text-white leading-none">
                {libraryUpdatesCount}
              </span>
            ) : (
              library.length > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-gray-200 text-gray-700 leading-none">
                  {library.length}
                </span>
              )
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("browser")}
            className={`py-2 px-1.5 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
              activeTab === "browser"
                ? "bg-white text-indigo-700 shadow-xs"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {nativeMode ? "Browser" : "Sites"}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("downloader")}
            className={`py-2 px-1.5 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer flex items-center justify-center gap-1 ${
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
            libraryById={libraryById}
            onDownloadNovel={(url) => startSingleDownload(url, true)}
            onQueueNovel={addToQueue}
            onOpenInBrowser={handleOpenInBrowser}
          />
        </div>

        {/* Tab 2: Downloaded Novels Library & Update Checker */}
        {activeTab === "library" && (
          <NovelLibrary
            novels={library}
            nativeMode={nativeMode}
            isDownloading={loading}
            activeDownloadNovelId={activeDownloadNovelId}
            checkingIds={checkingIds}
            checkingAllProgress={checkingAllProgress}
            onCheckUpdate={(novel) => {
              void checkSingleNovelUpdate(novel, false);
            }}
            onCheckAllUpdates={() => {
              void handleCheckAllUpdates();
            }}
            onCancelCheckAll={handleCancelCheckAll}
            onUpdateNovel={(novel, forceFull) => {
              void handleUpdateNovel(novel, forceFull);
            }}
            onUpdateAllOutdated={() => {
              void handleUpdateAllOutdated();
            }}
            onOpenOrSaveEpub={(novel) => {
              void handleOpenOrSaveLibraryEpub(novel);
            }}
            onShareWebEpub={(novel) => {
              void handleShareWebLibraryEpub(novel);
            }}
            onRemoveNovel={(novel) => {
              void handleRemoveLibraryNovel(novel);
            }}
            onOpenInBrowser={handleOpenInBrowser}
            onGoToCatalog={() => setActiveTab("catalog")}
            onGoToDownloader={() => setActiveTab("downloader")}
          />
        )}

        {/* Tab 3: Internal WebView Browser / Supported Sites Launcher */}
        {activeTab === "browser" && (
          <InternalBrowserTab
            nativeMode={nativeMode}
            lastBrowserUrl={lastBrowserUrl}
            onOpenInBrowser={handleOpenInBrowser}
            onQuickDownloadUrl={(url) => startSingleDownload(url, true)}
          />
        )}

        {/* Tab 4: Direct Downloader, Queue & Setup */}
        {activeTab === "downloader" && (
          <div className="space-y-5">
            {/* Connection Mode Info Banner */}
            <div
              className={`px-3.5 py-2.5 rounded-xl border text-xs flex items-center justify-between gap-2 ${
                nativeMode || (bridgeVersion && !isBridgeOutdated(bridgeVersion))
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : "bg-amber-50 border-amber-200 text-amber-900"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    nativeMode ||
                    (bridgeVersion && !isBridgeOutdated(bridgeVersion))
                      ? "bg-emerald-500"
                      : "bg-amber-500"
                  }`}
                />
                {nativeMode ? (
                  <span>
                    <strong>Native Android Mode</strong> — Direct device fetch
                    (no cloud IP blocks, R18 <code>over18=yes</code> enabled)
                  </span>
                ) : bridgeVersion && isBridgeOutdated(bridgeVersion) ? (
                  <span>
                    <strong>
                      Browser Helper v{bridgeVersion} (Update Available → v
                      {LATEST_BRIDGE_VERSION})
                    </strong>{" "}
                    — Reinstall the helper script and refresh this page to fix
                    Syosetu R18 age verification cookies.
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
              {!nativeMode &&
                bridgeVersion &&
                isBridgeOutdated(bridgeVersion) && (
                  <a
                    href="/novel-downloader.user.js"
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 font-semibold text-indigo-700 underline hover:text-indigo-900"
                  >
                    Update v{LATEST_BRIDGE_VERSION}
                  </a>
                )}
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

                  {!nativeMode && ageAuthBlockedUrl && (
                    <div className="mt-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-950 space-y-2">
                      <p className="font-semibold">
                        How to unlock Syosetu R18 (<code>over18=yes</code>):
                      </p>
                      <ol className="list-decimal list-inside space-y-1 text-amber-900">
                        {(!bridgeVersion || isBridgeOutdated(bridgeVersion)) && (
                          <li>
                            Install/update the{" "}
                            <strong>
                              Helper Userscript v{LATEST_BRIDGE_VERSION}
                            </strong>{" "}
                            and refresh this tab.
                          </li>
                        )}
                        <li>
                          If using Violentmonkey, Safari Userscripts, or Chrome
                          MV3 without <code>GM_cookie</code>, open{" "}
                          <code>novel18.syosetu.com</code> once in your browser
                          to save the 18+ cookie, then click Retry.
                        </li>
                      </ol>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {(!bridgeVersion || isBridgeOutdated(bridgeVersion)) && (
                          <a
                            href="/novel-downloader.user.js"
                            target="_blank"
                            rel="noreferrer"
                            className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700"
                          >
                            {bridgeVersion
                              ? `Update Helper (v${LATEST_BRIDGE_VERSION})`
                              : `Install Helper (v${LATEST_BRIDGE_VERSION})`}
                          </a>
                        )}
                        <a
                          href={ageAuthBlockedUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="px-3 py-1.5 rounded-lg bg-amber-600 text-white font-semibold hover:bg-amber-700"
                        >
                          Open novel18.syosetu.com (Set 18+ Cookie)
                        </a>
                        <button
                          type="button"
                          disabled={loading || !input.trim()}
                          onClick={() => startSingleDownload(input, false)}
                          className="px-3 py-1.5 rounded-lg bg-purple-600 text-white font-semibold hover:bg-purple-700 disabled:opacity-50 cursor-pointer"
                        >
                          Retry Download
                        </button>
                      </div>
                    </div>
                  )}

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
                      {lastSavedLibraryId && (
                        <button
                          type="button"
                          onClick={() => setActiveTab("library")}
                          className="bg-indigo-600 text-white text-sm font-bold py-2.5 px-4 rounded-lg hover:bg-indigo-700 transition-colors cursor-pointer"
                        >
                          View in Library →
                        </button>
                      )}
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
                      {lastSavedLibraryId && (
                        <button
                          type="button"
                          onClick={() => setActiveTab("library")}
                          className="bg-purple-600 text-white text-sm font-bold py-2.5 px-4 rounded-lg hover:bg-purple-700 transition-colors cursor-pointer"
                        >
                          View in Library →
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
