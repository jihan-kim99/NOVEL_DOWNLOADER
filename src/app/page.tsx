"use client";

import { useState } from "react";
import { saveAs } from "file-saver";
import { initializeEpub, generateEpub, Chapter } from "../lib/epub";
import { fetchWithFallback } from "../lib/narou-client";

export default function Home() {
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("");
  const [novelTitle, setNovelTitle] = useState("");
  const [downloadedCount, setDownloadedCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [forceClientSide, setForceClientSide] = useState(false);

  const handleDownload = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus("Initializing...");
    setNovelTitle("");
    setDownloadedCount(0);

    // Local flag to track fallback status within this download session
    let currentUseClientSide = forceClientSide;
    const enableClientSide = () => {
      currentUseClientSide = true;
      setForceClientSide(true);
    };

    try {
      // Extract Book ID and Platform
      let bookId = input.trim();
      let platform = "kakuyomu"; // Default
      let domain = "";

      if (bookId.includes("kakuyomu.jp/works/")) {
        const parts = bookId.split("kakuyomu.jp/works/");
        bookId = parts[1].split("/")[0];
        platform = "kakuyomu";
      } else if (bookId.includes("ncode.syosetu.com/")) {
        const parts = bookId.split("ncode.syosetu.com/");
        bookId = parts[1].split("/")[0];
        platform = "narou";
        domain = "ncode.syosetu.com";
      } else if (bookId.includes("novel18.syosetu.com/")) {
        const parts = bookId.split("novel18.syosetu.com/");
        bookId = parts[1].split("/")[0];
        platform = "narou";
        domain = "novel18.syosetu.com";
      } else if (bookId.toLowerCase().startsWith("n")) {
        // Simple heuristic: Narou IDs often start with 'n' (e.g., n5511kh)
        platform = "narou";
        // Default to ncode if just ID is provided, but this might fail for R18
        domain = "ncode.syosetu.com";
      }

      if (!bookId) {
        throw new Error("Invalid Book ID or URL");
      }

      // Determine API endpoint
      const apiEndpoint = platform === "narou" ? "/api/narou" : "/api/kakuyomu";

      // Get Novel Info
      setStatus(`Fetching novel info from ${platform}...`);

      let targetUrlForInfo = "";
      if (platform === "narou") {
        targetUrlForInfo = `https://${
          domain || "ncode.syosetu.com"
        }/${bookId}/`;
      } else {
        targetUrlForInfo = `https://kakuyomu.jp/works/${bookId}`;
      }

      const { title, firstUrl, userAgent } = await fetchWithFallback(
        apiEndpoint,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "info", bookId, platform, domain }),
        },
        "parse-info",
        targetUrlForInfo,
        setStatus,
        currentUseClientSide,
        enableClientSide
      );

      setStatus(`Found novel: ${title}`);
      setNovelTitle(title);

      // Initialize EPUB
      const { zip, oebps } = initializeEpub();

      const chapters: Chapter[] = [];
      let currentUrl = firstUrl;
      let episodeNum = 1;

      while (currentUrl) {
        setStatus(`Downloading episode ${episodeNum}...`);

        const {
          title: epTitle,
          content,
          nextUrl,
        } = await fetchWithFallback(
          apiEndpoint,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "episode",
              url: currentUrl,
              userAgent,
              platform,
              domain, // Pass domain for Narou parsing if needed
            }),
          },
          "parse-episode",
          currentUrl,
          setStatus,
          currentUseClientSide,
          enableClientSide
        );

        if (!content) {
          break;
        }

        const fileName = `chapter_${episodeNum}.xhtml`;
        oebps.file(
          fileName,
          `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="ja">
<head>
<title>${epTitle}</title>
</head>
<body>
<h3>${epTitle}</h3>
${content}
</body>
</html>`
        );

        chapters.push({ title: epTitle, fileName });

        currentUrl = nextUrl;
        episodeNum++;
        setDownloadedCount((prev) => prev + 1);
      }

      setStatus("Generating EPUB...");
      await generateEpub(title, bookId, chapters, zip);

      setStatus("Download complete!");
    } catch (error: any) {
      console.error(error);
      setStatus(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center p-4 font-[family-name:var(--font-geist-sans)]">
      <main className="bg-white/95 backdrop-blur-md p-8 rounded-2xl shadow-2xl w-full max-w-lg transition-all duration-300 hover:shadow-indigo-500/20">
        <h1 className="text-3xl font-extrabold text-center mb-8 bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-purple-600">
          Novel Downloader
        </h1>

        <form onSubmit={handleDownload} className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="url"
              className="text-sm font-semibold text-gray-700"
            >
              Novel URL or ID (Kakuyomu / Narou)
            </label>
            <div className="relative">
              <input
                id="url"
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="https://kakuyomu.jp/works/... or https://ncode.syosetu.com/..."
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
              Force Client-Side Download (Use if server fails)
            </label>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold py-3 px-4 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
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
        </form>

        {(novelTitle || status) && (
          <div className="mt-8 p-6 bg-gray-50 rounded-xl border border-gray-100 shadow-inner">
            {novelTitle && (
              <div className="mb-4 pb-4 border-b border-gray-200">
                <h2 className="text-sm text-gray-500 uppercase tracking-wide font-semibold mb-1">
                  Target Novel
                </h2>
                <p className="text-xl font-bold text-gray-800">{novelTitle}</p>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-600">
                  Status
                </span>
                <span className="text-sm font-bold text-purple-600">
                  {status}
                </span>
              </div>

              {downloadedCount > 0 && (
                <div className="mt-2">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Progress</span>
                    <span>{downloadedCount} episodes</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-blue-500 to-purple-500 h-2.5 rounded-full transition-all duration-500 ease-out"
                      style={{ width: "100%" }} // Indeterminate or we could calculate if we knew total
                    >
                      <div className="w-full h-full animate-pulse bg-white/30"></div>
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
