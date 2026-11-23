"use client";

import { useRef, useState } from "react";
import {
  buildChapterXhtml,
  Chapter,
  generateEpub,
  initializeEpub,
} from "../lib/epub";
import { fetchWithFallback } from "../lib/narou-client";
import { parseNovelInput } from "../lib/url-parser";
import type { Episode, NovelInfo } from "../types";

export default function Home() {
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [novelTitle, setNovelTitle] = useState("");
  const [novelAuthor, setNovelAuthor] = useState("");
  const [downloadedCount, setDownloadedCount] = useState(0);
  const [totalEpisodes, setTotalEpisodes] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [forceClientSide, setForceClientSide] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  const handleCancel = () => {
    abortControllerRef.current?.abort();
  };

  const handleDownload = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setIsError(false);
    setStatus("Initializing...");
    setNovelTitle("");
    setNovelAuthor("");
    setDownloadedCount(0);
    setTotalEpisodes(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    let currentUseClientSide = forceClientSide;
    const enableClientSide = () => {
      currentUseClientSide = true;
      setForceClientSide(true);
    };

    try {
      const parsed = parseNovelInput(input);
      const { platform, bookId, explicitDomain, siteLabel } = parsed;
      let domain = parsed.domain;

      const apiEndpoint = platform === "narou" ? "/api/narou" : "/api/kakuyomu";

      setStatus(`Fetching novel info from ${siteLabel}...`);

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
        currentUseClientSide,
        enableClientSide
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
          currentUseClientSide,
          enableClientSide
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

        // Polite short delay between episodes to avoid rate limiting
        if (currentUrl) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 150);
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
      await generateEpub(info.title, bookId, chapters, zip, info.author);
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
        <p className="text-xs text-center text-gray-500 mb-6">
          Supports Kakuyomu, Shosetsuka ni Narou (ncode), and Narou R18
          (Nocturne / Moonlight / Midnight — novel18)
        </p>

        <form onSubmit={handleDownload} className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="url"
              className="text-sm font-semibold text-gray-700"
            >
              Novel URL or ID
            </label>
            <div className="relative">
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
          </div>

          <div className="flex items-center gap-2">
            <input
              id="forceClientSide"
              type="checkbox"
              checked={forceClientSide}
              onChange={(e) => setForceClientSide(e.target.checked)}
              className="w-4 h-4 text-purple-600 bg-gray-100 border-gray-300 rounded focus:ring-purple-500 focus:ring-2"
            />
            <label
              htmlFor="forceClientSide"
              className="text-sm font-medium text-gray-700"
            >
              Force Client-Side Proxy (not recommended for R18 novel18)
            </label>
          </div>

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
          <div className="mt-8 p-6 bg-gray-50 rounded-xl border border-gray-100 shadow-inner">
            {novelTitle && (
              <div className="mb-4 pb-4 border-b border-gray-200">
                <h2 className="text-sm text-gray-500 uppercase tracking-wide font-semibold mb-1">
                  Target Novel
                </h2>
                <p className="text-xl font-bold text-gray-800">{novelTitle}</p>
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
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
