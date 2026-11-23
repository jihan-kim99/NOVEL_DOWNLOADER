"use client";

import { useEffect, useRef, useState } from "react";
import {
  buildChapterXhtml,
  Chapter,
  generateEpub,
  initializeEpub,
} from "../lib/epub";
import {
  CloudBlockError,
  fetchWithFallback,
  probeBrowserBridge,
} from "../lib/narou-client";
import { parseNovelInput } from "../lib/url-parser";
import type { Episode, NovelInfo } from "../types";

export default function Home() {
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [cloudBlocked, setCloudBlocked] = useState(false);
  const [novelTitle, setNovelTitle] = useState("");
  const [novelAuthor, setNovelAuthor] = useState("");
  const [downloadedCount, setDownloadedCount] = useState(0);
  const [totalEpisodes, setTotalEpisodes] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [bridgeVersion, setBridgeVersion] = useState<string | null>(null);
  const [useBridgeForAll, setUseBridgeForAll] = useState(false);
  const [copiedBookmarklet, setCopiedBookmarklet] = useState(false);
  const [showBypassHelp, setShowBypassHelp] = useState(false);
  const [readyEpub, setReadyEpub] = useState<{
    url: string;
    blob: Blob;
    fileName: string;
  } | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const attachBookmarkletHref = (el: HTMLAnchorElement | null) => {
    if (!el || typeof window === "undefined") return;
    const code = `javascript:(function(){var s=document.createElement('script');s.src='${window.location.origin}/bookmarklet.js?t='+Date.now();document.head.appendChild(s);})();`;
    el.setAttribute("href", code);
  };

  useEffect(() => {
    let active = true;

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
    };
  }, []);

  useEffect(() => {
    return () => {
      if (readyEpub) {
        URL.revokeObjectURL(readyEpub.url);
      }
    };
  }, [readyEpub]);

  const handleShareEpub = async () => {
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

  const handleDownload = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setIsError(false);
    setCloudBlocked(false);
    setStatus("Initializing...");
    setNovelTitle("");
    setNovelAuthor("");
    setDownloadedCount(0);
    setTotalEpisodes(null);
    setReadyEpub((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const parsed = parseNovelInput(input);
      const { platform, bookId, explicitDomain, siteLabel } = parsed;
      let domain = parsed.domain;

      const apiEndpoint = platform === "narou" ? "/api/narou" : "/api/kakuyomu";
      const bridgeAvailable = Boolean(bridgeVersion);
      // Always prefer the Browser Helper for Narou/R18 when installed so Vercel's IP is never hit
      const preferBridge =
        bridgeAvailable && (platform === "narou" || useBridgeForAll);

      setStatus(
        preferBridge
          ? `Fetching novel info from ${siteLabel} via Browser Helper...`
          : `Fetching novel info from ${siteLabel}...`
      );

      const targetUrlForInfo =
        platform === "narou"
          ? `https://${domain}/${bookId}/`
          : `https://kakuyomu.jp/works/${bookId}`;

      const info = await fetchWithFallback<NovelInfo>(
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

      if (info.domain) {
        domain = info.domain;
      }

      setNovelTitle(info.title);
      if (info.author) setNovelAuthor(info.author);
      if (info.totalEpisodes) setTotalEpisodes(info.totalEpisodes);
      setStatus(`Found novel: ${info.title}`);

      const { zip, oebps } = initializeEpub();
      const chapters: Chapter[] = [];
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

        const ep: Episode = await fetchWithFallback<Episode>(
          apiEndpoint,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              type: "episode",
              url: currentUrl,
              userAgent: info.userAgent,
              platform,
              domain,
            }),
          },
          "parse-episode",
          currentUrl,
          setStatus,
          preferBridge,
          bridgeAvailable
        );

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
            const timer = setTimeout(resolve, 200);
            controller.signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(new DOMException("Download cancelled", "AbortError"));
              },
              { once: true }
            );
          });
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
        info.author
      );
      setReadyEpub({
        url: URL.createObjectURL(generated.blob),
        blob: generated.blob,
        fileName: generated.fileName,
      });
      setStatus(`Download complete! (${chapters.length} episodes saved)`);
    } catch (error: unknown) {
      if (
        (error instanceof DOMException || error instanceof Error) &&
        error.name === "AbortError"
      ) {
        setStatus("Download cancelled.");
        setIsError(false);
      } else {
        console.error(error);
        if (error instanceof CloudBlockError) {
          setCloudBlocked(true);
          setShowBypassHelp(true);
        }
        const message =
          error instanceof Error ? error.message : "Unknown error occurred";
        setStatus(`Error: ${message}`);
        setIsError(true);
      }
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
    }
  };

  const progressPercent =
    totalEpisodes && totalEpisodes > 0
      ? Math.min(100, Math.round((downloadedCount / totalEpisodes) * 100))
      : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center p-4 font-[family-name:var(--font-geist-sans)]">
      <main className="bg-white/95 backdrop-blur-md p-8 rounded-2xl shadow-2xl w-full max-w-lg transition-all duration-300 hover:shadow-indigo-500/20">
        <h1 className="text-3xl font-extrabold text-center mb-2 bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-purple-600">
          Novel Downloader
        </h1>
        <p className="text-xs text-center text-gray-500 mb-5">
          Supports Kakuyomu, Shosetsuka ni Narou (ncode), and Narou R18
          (Nocturne / Moonlight / Midnight — novel18)
        </p>

        {/* Browser Helper Status Banner */}
        <div
          className={`mb-5 px-3.5 py-2.5 rounded-xl border text-xs flex items-center justify-between gap-2 ${
            bridgeVersion
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-amber-50 border-amber-200 text-amber-900"
          }`}
        >
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                bridgeVersion ? "bg-emerald-500" : "bg-amber-500"
              }`}
            />
            {bridgeVersion ? (
              <span>
                <strong>Browser Helper Active (v{bridgeVersion})</strong> —
                Narou &amp; R18 fetch directly via your browser IP &amp;
                over18 cookie
              </span>
            ) : (
              <span>
                <strong>Server Mode</strong> — Syosetu blocks Vercel/cloud IPs.
                For Narou &amp; R18, enable the browser helper.
              </span>
            )}
          </div>
          {!bridgeVersion && (
            <button
              type="button"
              onClick={() => setShowBypassHelp((v) => !v)}
              className="shrink-0 font-semibold text-purple-700 underline hover:text-purple-900"
            >
              {showBypassHelp ? "Hide" : "Setup"}
            </button>
          )}
        </div>

        <form onSubmit={handleDownload} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
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
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all text-gray-800 placeholder-gray-400"
              required
            />
          </div>

          {bridgeVersion && (
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
              className="flex-1 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold py-3 px-4 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
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
                className="px-4 py-3 rounded-lg bg-red-500 text-white font-semibold hover:bg-red-600 transition-colors shadow-md"
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        {(novelTitle || status) && (
          <div className="mt-6 p-5 bg-gray-50 rounded-xl border border-gray-100 shadow-inner">
            {novelTitle && (
              <div className="mb-4 pb-4 border-b border-gray-200">
                <h2 className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">
                  Target Novel
                </h2>
                <p className="text-lg font-bold text-gray-800">{novelTitle}</p>
                {novelAuthor && (
                  <p className="text-sm text-gray-500 mt-1">{novelAuthor}</p>
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
              {readyEpub && (
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
                        className="flex-1 bg-indigo-600 text-white text-sm font-bold py-2.5 px-4 rounded-lg hover:bg-indigo-700 transition-colors"
                      >
                        Share / Open in Books
                      </button>
                    )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Cloud-IP / R18 Age-Verification Bypass Helper Panel */}
        {(showBypassHelp || cloudBlocked) && !bridgeVersion && (
          <div
            className={`mt-6 p-5 rounded-xl border text-xs space-y-4 ${
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
                Syosetu blocks datacenter IPs (like Vercel/AWS) and public CORS
                proxies cannot send the <code>over18=yes</code> cookie. Pick the
                option that fits Desktop or Mobile:
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
                <strong>Android:</strong> Use{" "}
                <strong>Firefox for Android</strong> +{" "}
                <strong>Violentmonkey</strong> (or Edge Android).
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
                Option 2: Zero-Extension Bookmarklet (Stock iOS Safari &amp;
                Android Chrome)
              </div>
              <p className="text-gray-600 leading-relaxed">
                <strong>On Desktop:</strong> Drag the purple button to your
                bookmarks bar.
                <br />
                <strong>On Mobile (no apps needed):</strong> Tap{" "}
                <strong>Copy Bookmarklet Code</strong> → bookmark any page →
                edit that bookmark&apos;s URL and paste the code (name it{" "}
                <code>dl</code>). Then open a novel on{" "}
                <code>ncode.syosetu.com</code>,{" "}
                <code>novel18.syosetu.com</code>, or <code>kakuyomu.jp</code>,
                type <code>dl</code> in the address bar, and tap the bookmark!
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
                  className="px-3 py-2 rounded-lg border border-gray-300 bg-gray-50 hover:bg-gray-100 font-medium text-gray-700"
                >
                  {copiedBookmarklet ? "Copied!" : "Copy Bookmarklet Code"}
                </button>
              </div>
            </div>

            <div className="p-3 bg-white rounded-lg border border-gray-200 space-y-1.5">
              <div className="font-bold text-gray-900">
                Option 3: Stock Mobile Browser directly on Vercel (Self-Hosted
                Home Relay)
              </div>
              <p className="text-gray-600 leading-relaxed">
                To make stock mobile browsers work directly on this Vercel page
                with zero phone setup, run{" "}
                <code>PROXY_TOKEN=secret node proxy/server.mjs</code> on a home
                PC/Pi behind <code>cloudflared tunnel</code> and set{" "}
                <code>SYOSETU_PROXY_URL</code> &amp;{" "}
                <code>SYOSETU_PROXY_TOKEN</code> in Vercel Environment
                Variables.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
