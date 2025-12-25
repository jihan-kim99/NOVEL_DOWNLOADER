"use client";

import { useState } from "react";
import JSZip from "jszip";
import { saveAs } from "file-saver";

export default function Home() {
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("");
  const [novelTitle, setNovelTitle] = useState("");
  const [downloadedCount, setDownloadedCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const handleDownload = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus("Initializing...");
    setNovelTitle("");
    setDownloadedCount(0);

    let useFallback = false;

    const fetchWithFallback = async (
      url: string,
      options: any,
      fallbackType: string,
      fallbackUrl: string
    ) => {
      if (!useFallback) {
        try {
          const res = await fetch(url, options);
          if (!res.ok) {
            // If 403 or 500, try fallback
            if (res.status === 403 || res.status === 500) {
              throw new Error("Server blocked");
            }
            throw new Error(`Failed with status ${res.status}`);
          }
          return res.json();
        } catch (error) {
          console.warn("Primary fetch failed, trying fallback...", error);
          setStatus(
            "Primary fetch failed, switching to client-side fallback..."
          );
          useFallback = true;
        }
      }

      // Fallback: Fetch via CORS proxy
      let html = "";

      // 1. Try corsproxy.io
      try {
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(
          fallbackUrl
        )}`;

        // Extract userAgent from options if available
        const bodyObj = options.body ? JSON.parse(options.body) : {};
        const ua =
          bodyObj.userAgent ||
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

        const proxyRes = await fetch(proxyUrl, {
          headers: {
            "User-Agent": ua,
            Cookie: "over18=yes",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "Accept-Language": "en-US,en;q=0.9,ja;q=0.8",
            Referer: "https://syosetu.com/",
            "Sec-Ch-Ua":
              '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "cross-site",
            "Upgrade-Insecure-Requests": "1",
          },
        });
        if (proxyRes.ok) {
          html = await proxyRes.text();
        }
      } catch (e) {
        console.warn("corsproxy.io failed", e);
      }

      // 2. Try allorigins.win if first failed
      if (!html) {
        try {
          const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(
            fallbackUrl
          )}&timestamp=${Date.now()}`;
          const proxyRes = await fetch(proxyUrl);
          if (proxyRes.ok) {
            const proxyData = await proxyRes.json();
            html = proxyData.contents;
          }
        } catch (e) {
          console.warn("allorigins failed", e);
        }
      }

      if (!html) throw new Error("All proxies failed to fetch content");

      // Send HTML to server for parsing
      const parseRes = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...JSON.parse(options.body),
          type: fallbackType,
          html,
        }),
      });

      if (!parseRes.ok) throw new Error("Parse request failed");
      return parseRes.json();
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

      // Get Novel Info
      setStatus(`Fetching novel info from ${platform}...`);

      let targetUrlForInfo = "";
      if (platform === "narou") {
        targetUrlForInfo = `https://${
          domain || "ncode.syosetu.com"
        }/${bookId}/1/`;
      } else {
        targetUrlForInfo = `https://kakuyomu.jp/works/${bookId}`;
      }

      const { title, firstUrl, userAgent } = await fetchWithFallback(
        "/api/download",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "info", bookId, platform, domain }),
        },
        "parse-info",
        targetUrlForInfo
      );

      setStatus(`Found novel: ${title}`);
      setNovelTitle(title);

      // Initialize EPUB
      const zip = new JSZip();
      zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
      zip.folder("META-INF")?.file(
        "container.xml",
        `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
   <rootfiles>
      <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
   </rootfiles>
</container>`
      );

      const oebps = zip.folder("OEBPS");
      if (!oebps) throw new Error("Failed to create OEBPS folder");

      const chapters: { title: string; fileName: string }[] = [];
      let currentUrl = firstUrl;
      let episodeNum = 1;

      while (currentUrl) {
        setStatus(`Downloading episode ${episodeNum}...`);

        const {
          title: epTitle,
          content,
          nextUrl,
        } = await fetchWithFallback(
          "/api/download",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "episode",
              url: currentUrl,
              userAgent,
              platform,
            }),
          },
          "parse-episode",
          currentUrl
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

      // Generate content.opf
      const manifestItems = chapters
        .map(
          (ch, i) =>
            `<item id="chapter_${i + 1}" href="${
              ch.fileName
            }" media-type="application/xhtml+xml"/>`
        )
        .join("\n");
      const spineItems = chapters
        .map((ch, i) => `<itemref idref="chapter_${i + 1}"/>`)
        .join("\n");

      const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${title}</dc:title>
    <dc:language>ja</dc:language>
    <dc:identifier id="BookId">urn:uuid:${bookId}</dc:identifier>
    <meta property="dcterms:modified">${
      new Date().toISOString().split(".")[0]
    }Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    ${manifestItems}
  </manifest>
  <spine toc="ncx">
    <itemref idref="nav"/>
    ${spineItems}
  </spine>
</package>`;

      oebps.file("content.opf", contentOpf);

      // Generate nav.xhtml
      const navLinks = chapters
        .map((ch) => `<li><a href="${ch.fileName}">${ch.title}</a></li>`)
        .join("\n");
      const navXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="ja">
<head><title>Table of Contents</title></head>
<body>
<nav epub:type="toc" id="toc">
  <h1>Table of Contents</h1>
  <ol>
    ${navLinks}
  </ol>
</nav>
</body>
</html>`;
      oebps.file("nav.xhtml", navXhtml);

      // Generate toc.ncx
      const ncxPoints = chapters
        .map(
          (ch, i) => `
    <navPoint id="navPoint-${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${ch.title}</text></navLabel>
      <content src="${ch.fileName}"/>
    </navPoint>`
        )
        .join("");

      const tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${bookId}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${title}</text></docTitle>
  <navMap>
    ${ncxPoints}
  </navMap>
</ncx>`;
      oebps.file("toc.ncx", tocNcx);

      // Generate and save file
      const content = await zip.generateAsync({ type: "blob" });
      saveAs(content, `${title}.epub`);

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
