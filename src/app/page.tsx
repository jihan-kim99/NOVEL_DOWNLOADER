"use client";

import { useState } from "react";
import JSZip from "jszip";
import { saveAs } from "file-saver";

export default function Home() {
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("");
  const [downloadedCount, setDownloadedCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const handleDownload = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus("Initializing...");
    setDownloadedCount(0);

    try {
      // Extract Book ID
      let bookId = input.trim();
      if (bookId.includes("kakuyomu.jp/works/")) {
        const parts = bookId.split("kakuyomu.jp/works/");
        bookId = parts[1].split("/")[0];
      }

      if (!bookId) {
        throw new Error("Invalid Book ID or URL");
      }

      // Get Novel Info
      setStatus("Fetching novel info...");
      const infoRes = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "info", bookId }),
      });

      if (!infoRes.ok) {
        throw new Error("Failed to fetch novel info");
      }

      const { title, firstUrl, userAgent } = await infoRes.json();
      setStatus(`Found novel: ${title}`);

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

        const epRes = await fetch("/api/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "episode", url: currentUrl, userAgent }),
        });

        if (!epRes.ok) {
          console.error(`Failed to download episode ${episodeNum}`);
          break;
        }

        const { title: epTitle, content, nextUrl } = await epRes.json();

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
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-8 row-start-2 items-center sm:items-start w-full max-w-md">
        <h1 className="text-2xl font-bold text-center w-full">
          Novel Downloader
        </h1>

        <form onSubmit={handleDownload} className="flex flex-col gap-4 w-full">
          <div className="flex flex-col gap-2">
            <label htmlFor="url" className="text-sm font-medium">
              Novel URL or ID (Kakuyomu)
            </label>
            <input
              id="url"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="https://kakuyomu.jp/works/..."
              className="p-2 border rounded text-black"
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 text-white p-2 rounded hover:bg-blue-700 disabled:bg-gray-400"
          >
            {loading ? "Processing..." : "Download EPUB"}
          </button>
        </form>

        {status && (
          <div className="w-full p-4 bg-gray-100 text-black rounded">
            <p className="font-medium">{status}</p>
            {downloadedCount > 0 && (
              <p className="text-sm mt-2">
                Downloaded episodes: {downloadedCount}
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
