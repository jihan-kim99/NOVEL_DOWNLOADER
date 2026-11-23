/**
 * Standalone browser-side EPUB downloader for:
 * - Shosetsuka ni Narou (ncode.syosetu.com)
 * - Narou R18: Nocturne / Moonlight / Midnight (novel18.syosetu.com)
 * - Kakuyomu (kakuyomu.jp)
 *
 * Runs directly on the novel website using same-origin fetch() with the user's
 * residential IP and browser cookies (zero CORS, zero cloud IP blocks).
 */
(function () {
  "use strict";

  if (window.__NOVEL_DL_RUNNING__) {
    alert("Novel Downloader is already running on this page.");
    return;
  }

  const host = location.hostname.toLowerCase();
  const isNarou =
    host === "ncode.syosetu.com" || host === "novel18.syosetu.com";
  const isKakuyomu = host === "kakuyomu.jp";

  if (!isNarou && !isKakuyomu) {
    alert(
      "Open a novel page on Kakuyomu (kakuyomu.jp), Narou (ncode.syosetu.com), or Narou R18 (novel18.syosetu.com) first, then click this bookmarklet."
    );
    return;
  }

  function escapeXml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function sanitizeFilename(name) {
    const cleaned = String(name || "")
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^\.+|\.+$/g, "");
    return (cleaned || "novel").slice(0, 180);
  }

  const VOID_TAGS = new Set(["br", "hr", "img"]);
  const ALLOWED_TAGS = new Set([
    "p",
    "br",
    "hr",
    "ruby",
    "rb",
    "rp",
    "rt",
    "rtc",
    "em",
    "strong",
    "b",
    "i",
    "u",
    "s",
    "span",
    "sub",
    "sup",
    "a",
    "img",
    "div",
    "blockquote",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
  ]);
  const SKIP_TAGS = new Set(["script", "style", "noscript", "iframe", "svg"]);
  const ALLOWED_ATTRS = {
    a: new Set(["href"]),
    img: new Set(["src", "alt"]),
    em: new Set(["class"]),
    span: new Set(["class"]),
    p: new Set(["class", "id"]),
    div: new Set(["class"]),
  };

  function serializeDomNode(node) {
    if (node.nodeType === 3) {
      return escapeXml(node.nodeValue || "");
    }
    if (node.nodeType !== 1) return "";
    const tag = node.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return "";
    if (!ALLOWED_TAGS.has(tag)) {
      return Array.from(node.childNodes).map(serializeDomNode).join("");
    }
    let attrs = "";
    const allowed = ALLOWED_ATTRS[tag];
    if (allowed && node.attributes) {
      for (const attr of Array.from(node.attributes)) {
        const k = attr.name.toLowerCase();
        if (!allowed.has(k)) continue;
        let v = attr.value || "";
        if (k === "href" || k === "src") {
          v = v.trim();
          if (!v || /^javascript:/i.test(v)) continue;
          if (v.startsWith("//")) v = "https:" + v;
        }
        attrs += ` ${k}="${escapeXml(v)}"`;
      }
    }
    if (VOID_TAGS.has(tag)) {
      return `<${tag}${attrs} />`;
    }
    const inner = Array.from(node.childNodes).map(serializeDomNode).join("");
    return `<${tag}${attrs}>${inner}</${tag}>`;
  }

  function containerToXhtml(container) {
    if (!container) return "";
    const ps = container.querySelectorAll("p");
    if (ps.length > 0) {
      return Array.from(ps).map(serializeDomNode).join("\n");
    }
    return Array.from(container.childNodes).map(serializeDomNode).join("");
  }

  function loadJSZip() {
    if (typeof window.JSZip !== "undefined") {
      return Promise.resolve(window.JSZip);
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src =
        "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
      script.onload = () => {
        if (typeof window.JSZip !== "undefined") resolve(window.JSZip);
        else reject(new Error("JSZip loaded but window.JSZip is undefined"));
      };
      script.onerror = () => reject(new Error("Failed to load JSZip from CDN"));
      document.head.appendChild(script);
    });
  }

  function createOverlay(onCancel) {
    const box = document.createElement("div");
    box.id = "novel-dl-overlay";
    box.style.cssText =
      "position:fixed;bottom:14px;right:14px;left:14px;margin-left:auto;z-index:2147483647;background:#1e1b4b;color:#fff;padding:16px 18px;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,0.45);font-family:system-ui,-apple-system,sans-serif;font-size:14px;max-width:360px;line-height:1.5;box-sizing:border-box;";
    box.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
      '<strong style="font-size:15px;">Novel Downloader</strong>' +
      '<button id="novel-dl-cancel" style="background:#ef4444;color:#fff;border:none;border-radius:8px;padding:5px 11px;cursor:pointer;font-size:12px;font-weight:600;">Cancel</button>' +
      "</div>" +
      '<div id="novel-dl-title" style="font-weight:600;color:#c7d2fe;margin-bottom:6px;word-break:break-word;"></div>' +
      '<div id="novel-dl-status" style="color:#e0e7ff;">Initializing...</div>' +
      '<div style="margin-top:8px;height:7px;background:rgba(255,255,255,0.2);border-radius:999px;overflow:hidden;">' +
      '<div id="novel-dl-bar" style="height:100%;width:10%;background:linear-gradient(90deg,#60a5fa,#c084fc);transition:width .2s;"></div>' +
      "</div>" +
      '<div id="novel-dl-actions" style="display:none;margin-top:12px;gap:8px;flex-wrap:wrap;"></div>';
    document.body.appendChild(box);
    const cancelBtn = box.querySelector("#novel-dl-cancel");
    const actionsEl = box.querySelector("#novel-dl-actions");
    cancelBtn.addEventListener("click", onCancel);
    return {
      setTitle(t) {
        box.querySelector("#novel-dl-title").textContent = t;
      },
      setStatus(s) {
        box.querySelector("#novel-dl-status").textContent = s;
      },
      setProgress(pct) {
        box.querySelector("#novel-dl-bar").style.width =
          Math.max(5, Math.min(100, pct)) + "%";
      },
      showDownloadActions(blob, fileName) {
        const blobUrl = URL.createObjectURL(blob);
        actionsEl.style.display = "flex";
        actionsEl.innerHTML = "";

        const dlLink = document.createElement("a");
        dlLink.href = blobUrl;
        dlLink.download = fileName;
        dlLink.textContent = "Save EPUB";
        dlLink.style.cssText =
          "flex:1;text-align:center;background:#10b981;color:#fff;text-decoration:none;font-weight:700;padding:9px 12px;border-radius:8px;font-size:13px;";
        actionsEl.appendChild(dlLink);

        if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
          try {
            const file = new File([blob], fileName, {
              type: "application/epub+zip",
            });
            if (!navigator.canShare || navigator.canShare({ files: [file] })) {
              const shareBtn = document.createElement("button");
              shareBtn.type = "button";
              shareBtn.textContent = "Share / Books";
              shareBtn.style.cssText =
                "flex:1;background:#6366f1;color:#fff;border:none;font-weight:700;padding:9px 12px;border-radius:8px;font-size:13px;cursor:pointer;";
              shareBtn.onclick = () => {
                navigator.share({ files: [file], title: fileName }).catch(() => {});
              };
              actionsEl.appendChild(shareBtn);
            }
          } catch {
            // Share API not supported for files
          }
        }

        // Also trigger automatic download (works on desktop & Android; iOS users can tap Save/Share above)
        dlLink.click();
      },
      done(msg) {
        box.querySelector("#novel-dl-status").textContent = msg;
        cancelBtn.textContent = "Close";
        cancelBtn.style.background = "#4f46e5";
        cancelBtn.onclick = () => box.remove();
      },
      remove() {
        box.remove();
      },
    };
  }

  async function fetchDoc(url, signal) {
    const res = await fetch(url, { credentials: "include", signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const html = await res.text();
    return new DOMParser().parseFromString(html, "text/html");
  }

  function extractNarouTocLinks(doc, ncode) {
    const epRegex = new RegExp(`^/${ncode}/(\\d+)/?$`, "i");
    const urls = [];
    const seen = new Set();
    const add = (h) => {
      if (!h || !epRegex.test(h)) return;
      const full = location.origin + (h.endsWith("/") ? h : h + "/");
      if (!seen.has(full)) {
        seen.add(full);
        urls.push(full);
      }
    };
    doc
      .querySelectorAll("a.p-eplist__subtitle, .novel_sublist2 a, dd.subtitle a")
      .forEach((a) => add(a.getAttribute("href")));
    if (urls.length === 0) {
      doc.querySelectorAll("a[href]").forEach((a) => add(a.getAttribute("href")));
    }

    let lastTocPage = 1;
    const pageRegex = new RegExp(`^/${ncode}/\\?p=(\\d+)$`, "i");
    const lastA = doc.querySelector("a.c-pager__item--last");
    const lastM = lastA ? (lastA.getAttribute("href") || "").match(pageRegex) : null;
    if (lastM) {
      lastTocPage = Math.max(1, Number(lastM[1]));
    } else {
      doc.querySelectorAll("a.c-pager__item[href]").forEach((a) => {
        const m = (a.getAttribute("href") || "").match(pageRegex);
        if (m) lastTocPage = Math.max(lastTocPage, Number(m[1]));
      });
    }
    return { urls, lastTocPage };
  }

  function parseNarouInfoDoc(doc, ncode) {
    const title =
      doc.querySelector("h1.p-novel__title")?.textContent?.trim() ||
      doc.querySelector(".p-novel__title")?.textContent?.trim() ||
      doc.querySelector(".novel_title")?.textContent?.trim() ||
      doc.title.replace(/\s*-\s*小説家になろう\s*$/, "").trim() ||
      ncode;
    const author =
      (
        doc.querySelector(".p-novel__author")?.textContent ||
        doc.querySelector(".novel_writername")?.textContent ||
        ""
      )
        .replace(/^作者[：:]\s*/, "")
        .trim() || undefined;

    const { urls, lastTocPage } = extractNarouTocLinks(doc, ncode);
    const hasBody =
      !!doc.querySelector("div.p-novel__body") ||
      !!doc.querySelector("#novel_honbun") ||
      !!doc.querySelector("div.novel_view");

    if (urls.length > 0) {
      return {
        title,
        author,
        firstUrl: urls[0],
        episodeUrls: urls,
        lastTocPage,
        totalEpisodes: lastTocPage <= 1 ? urls.length : null,
      };
    }
    if (hasBody) {
      const singleUrl = `${location.origin}/${ncode}/`;
      return {
        title,
        author,
        firstUrl: singleUrl,
        episodeUrls: [singleUrl],
        lastTocPage: 1,
        totalEpisodes: 1,
      };
    }
    return {
      title,
      author,
      firstUrl: `${location.origin}/${ncode}/1/`,
      episodeUrls: null,
      lastTocPage: 1,
      totalEpisodes: null,
    };
  }

  function parseNarouEpDoc(doc, ncode) {
    const title =
      doc.querySelector("h1.p-novel__title")?.textContent?.trim() ||
      doc.querySelector(".p-novel__title")?.textContent?.trim() ||
      doc.querySelector(".p-novel__subtitle-episode")?.textContent?.trim() ||
      doc.querySelector(".p-novel__subtitle")?.textContent?.trim() ||
      doc.querySelector(".novel_subtitle")?.textContent?.trim() ||
      doc.querySelector("h1")?.textContent?.trim() ||
      "Episode";

    let content = "";
    const body = doc.querySelector("div.p-novel__body");
    if (body) {
      const blocks = body.querySelectorAll("div.p-novel__text");
      if (blocks.length > 0) {
        content = Array.from(blocks)
          .map((b) => containerToXhtml(b).trim())
          .filter(Boolean)
          .join('\n<hr class="section-break" />\n');
      } else {
        content = containerToXhtml(body).trim();
      }
    }
    if (!content) {
      content = containerToXhtml(
        doc.querySelector("div.novel_view") || doc.querySelector("#novel_honbun")
      ).trim();
    }

    const epRegex = new RegExp(`^/${ncode}/\\d+/?$`, "i");
    let nextHref = null;
    const nextA = doc.querySelector("a.c-pager__item--next");
    if (nextA) {
      const h = nextA.getAttribute("href");
      if (h && epRegex.test(h)) nextHref = h;
    }
    if (!nextHref) {
      for (const a of doc.querySelectorAll("div.novel_bn a")) {
        const h = a.getAttribute("href");
        if (a.textContent.includes("次") && h && epRegex.test(h)) {
          nextHref = h;
          break;
        }
      }
    }

    return {
      title,
      content,
      nextUrl: nextHref ? location.origin + nextHref : null,
    };
  }

  function parseKakuyomuInfoDoc(doc, workId) {
    let title = "";
    let author;
    let firstEpId = null;
    let totalEpisodes = null;
    const epIds = [];
    const seen = new Set();
    const addId = (id) => {
      if (id && !seen.has(id)) {
        seen.add(id);
        epIds.push(id);
      }
    };
    const nd = doc.querySelector("#__NEXT_DATA__")?.textContent;
    if (nd) {
      try {
        const json = JSON.parse(nd);
        const apollo = json?.props?.pageProps?.__APOLLO_STATE__ || {};
        const work =
          apollo[`Work:${workId}`] ||
          apollo[Object.keys(apollo).find((k) => k.startsWith("Work:"))];
        if (work) {
          title = (work.title || "").trim();
          totalEpisodes = work.publicEpisodeCount || null;
          if (work.author?.__ref && apollo[work.author.__ref]) {
            author =
              apollo[work.author.__ref].activityName ||
              apollo[work.author.__ref].name;
          }
          for (const chRef of work.tableOfContentsV2 ||
            work.tableOfContents ||
            []) {
            const ch = apollo[chRef?.__ref];
            for (const epRef of ch?.episodeUnions || []) {
              if (epRef?.__ref) addId(epRef.__ref.split(":")[1]);
            }
          }
          firstEpId = epIds[0] || work.firstPublicEpisodeUnion?.__ref?.split(":")[1] || null;
          if (firstEpId && epIds.length === 0) addId(firstEpId);
        }
      } catch {
        // Fallback to DOM
      }
    }
    if (!title) {
      title =
        doc.querySelector("h1")?.textContent?.trim() ||
        doc.title.replace(/\s*-\s*カクヨム\s*$/, "").trim() ||
        workId;
    }
    if (epIds.length === 0) {
      const epRegex = new RegExp(`^/works/${workId}/episodes/(\\d+)$`);
      for (const a of doc.querySelectorAll(
        `a[href^="/works/${workId}/episodes/"]`
      )) {
        const m = (a.getAttribute("href") || "").match(epRegex);
        if (m) addId(m[1]);
      }
      if (!firstEpId && epIds.length > 0) firstEpId = epIds[0];
    }
    if (!firstEpId) throw new Error("Could not find first episode link.");
    const episodeUrls =
      epIds.length > 0 && (!totalEpisodes || epIds.length >= totalEpisodes)
        ? epIds.map((id) => `https://kakuyomu.jp/works/${workId}/episodes/${id}`)
        : null;
    return {
      title,
      author,
      firstUrl: `https://kakuyomu.jp/works/${workId}/episodes/${firstEpId}`,
      episodeUrls,
      lastTocPage: 1,
      totalEpisodes: totalEpisodes || (episodeUrls ? episodeUrls.length : null),
    };
  }

  function parseKakuyomuEpDoc(doc) {
    const title =
      doc.querySelector(".widget-episodeTitle")?.textContent?.trim() ||
      doc.querySelector("h1")?.textContent?.trim() ||
      "Episode";
    const body =
      doc.querySelector(".widget-episodeBody.js-episode-body") ||
      doc.querySelector(".widget-episodeBody") ||
      doc.querySelector("#contentMain-inner > div > div > div");
    const content = containerToXhtml(body).trim();
    const nextHref =
      doc.querySelector("#contentMain-readNextEpisode")?.getAttribute("href") ||
      doc.querySelector("a.js-read-next-episode")?.getAttribute("href");
    return {
      title,
      content,
      nextUrl: nextHref
        ? nextHref.startsWith("http")
          ? nextHref
          : "https://kakuyomu.jp" + nextHref
        : null,
    };
  }

  async function buildAndSaveEpub(JSZip, title, bookId, author, chapters) {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.folder("META-INF").file(
      "container.xml",
      `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
    );
    const oebps = zip.folder("OEBPS");
    oebps.file(
      "styles.css",
      `body{font-family:"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif;line-height:1.8;margin:1.2em;}
h1,h2,h3{line-height:1.4;margin-bottom:1em;}
p{margin:.4em 0;}
hr.section-break{border:none;border-top:1px solid #bbb;margin:1.5em 2em;}
em.emphasisDots{font-style:normal;-webkit-text-emphasis:filled sesame;text-emphasis:filled sesame;}`
    );

    const safeTitle = escapeXml(title);
    const safeId = escapeXml(bookId);
    const creatorXml = author
      ? `\n    <dc:creator>${escapeXml(author)}</dc:creator>`
      : "";

    chapters.forEach((ch, idx) => {
      const safeEpTitle = escapeXml(ch.title);
      oebps.file(
        ch.fileName,
        `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="ja">
<head>
  <meta charset="utf-8" />
  <title>${safeEpTitle}</title>
  <link rel="stylesheet" type="text/css" href="styles.css" />
</head>
<body>
  <h3>${safeEpTitle}</h3>
  ${ch.content}
</body>
</html>`
      );
      ch.idx = idx + 1;
    });

    oebps.file(
      "content.opf",
      `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${safeTitle}</dc:title>${creatorXml}
    <dc:language>ja</dc:language>
    <dc:identifier id="BookId">urn:uuid:${safeId}</dc:identifier>
    <meta property="dcterms:modified">${new Date().toISOString().split(".")[0]}Z</meta>
  </metadata>
  <manifest>
    <item id="styles" href="styles.css" media-type="text/css"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
${chapters.map((c) => `    <item id="chapter_${c.idx}" href="${escapeXml(c.fileName)}" media-type="application/xhtml+xml"/>`).join("\n")}
  </manifest>
  <spine toc="ncx">
    <itemref idref="nav"/>
${chapters.map((c) => `    <itemref idref="chapter_${c.idx}"/>`).join("\n")}
  </spine>
</package>`
    );

    oebps.file(
      "nav.xhtml",
      `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="ja">
<head>
  <meta charset="utf-8" />
  <title>Table of Contents</title>
  <link rel="stylesheet" type="text/css" href="styles.css" />
</head>
<body>
<nav epub:type="toc" id="toc">
  <h1>${safeTitle}</h1>
  <ol>
${chapters.map((c) => `    <li><a href="${escapeXml(c.fileName)}">${escapeXml(c.title)}</a></li>`).join("\n")}
  </ol>
</nav>
</body>
</html>`
    );

    oebps.file(
      "toc.ncx",
      `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${safeId}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${safeTitle}</text></docTitle>
  <navMap>
${chapters
  .map(
    (c) => `    <navPoint id="navPoint-${c.idx}" playOrder="${c.idx}">
      <navLabel><text>${escapeXml(c.title)}</text></navLabel>
      <content src="${escapeXml(c.fileName)}"/>
    </navPoint>`
  )
  .join("\n")}
  </navMap>
</ncx>`
    );

    const blob = await zip.generateAsync({
      type: "blob",
      mimeType: "application/epub+zip",
    });
    return { blob, fileName: `${sanitizeFilename(title)}.epub` };
  }

  async function run() {
    window.__NOVEL_DL_RUNNING__ = true;
    const controller = new AbortController();
    const ui = createOverlay(() => controller.abort());

    try {
      if (isNarou) {
        // Ensure over18=yes cookie is set for novel18.syosetu.com
        document.cookie =
          "over18=yes; domain=.syosetu.com; path=/; max-age=31536000; SameSite=Lax";
      }

      ui.setStatus("Loading EPUB builder...");
      const JSZip = await loadJSZip();

      let bookId = "";
      let info;

      if (isNarou) {
        const m = location.pathname.match(/\/(n\d{4}[a-z]{1,2})\b/i);
        if (!m) throw new Error("Open a specific Narou / R18 novel page first.");
        bookId = m[1].toLowerCase();
        ui.setStatus("Fetching novel info...");
        const infoDoc = await fetchDoc(
          `${location.origin}/${bookId}/`,
          controller.signal
        );
        info = parseNarouInfoDoc(infoDoc, bookId);
      } else {
        const m = location.pathname.match(/\/works\/(\d+)/);
        if (!m) throw new Error("Open a Kakuyomu work page (/works/<id>) first.");
        bookId = m[1];
        ui.setStatus("Fetching novel info...");
        const infoDoc = await fetchDoc(
          `https://kakuyomu.jp/works/${bookId}`,
          controller.signal
        );
        info = parseKakuyomuInfoDoc(infoDoc, bookId);
      }

      ui.setTitle(info.title);

      // Fetch remaining Narou TOC pages if paginated (>100 episodes)
      if (isNarou && info.lastTocPage > 1 && info.episodeUrls) {
        ui.setStatus(`Loading table of contents (${info.lastTocPage} pages)...`);
        const maxPages = Math.min(info.lastTocPage, 50);
        const pages = Array.from({ length: maxPages - 1 }, (_, i) => i + 2);
        const pageUrls = new Array(pages.length);
        let pCursor = 0;
        const tocWorker = async () => {
          while (pCursor < pages.length) {
            const idx = pCursor++;
            const pDoc = await fetchDoc(
              `${location.origin}/${bookId}/?p=${pages[idx]}`,
              controller.signal
            );
            pageUrls[idx] = extractNarouTocLinks(pDoc, bookId).urls;
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(4, pages.length) }, () => tocWorker())
        );
        const merged = [...info.episodeUrls];
        const seen = new Set(merged);
        for (const list of pageUrls) {
          for (const u of list || []) {
            if (!seen.has(u)) {
              seen.add(u);
              merged.push(u);
            }
          }
        }
        info.episodeUrls = merged;
        info.totalEpisodes = merged.length;
      }

      const chapters = [];
      const CONCURRENCY = 5;

      if (info.episodeUrls && info.episodeUrls.length > 0) {
        const total = info.episodeUrls.length;
        const workerCount = Math.min(CONCURRENCY, total);
        const ordered = new Array(total).fill(null);
        let nextIdx = 0;
        let completed = 0;

        ui.setStatus(`Downloading ${total} episodes (${workerCount}x)...`);
        const worker = async (wid) => {
          if (wid > 0) await new Promise((r) => setTimeout(r, wid * 60));
          while (true) {
            if (controller.signal.aborted) {
              throw new DOMException("Cancelled", "AbortError");
            }
            const idx = nextIdx++;
            if (idx >= total) return;
            const epDoc = await fetchDoc(
              info.episodeUrls[idx],
              controller.signal
            );
            ordered[idx] = isNarou
              ? parseNarouEpDoc(epDoc, bookId)
              : parseKakuyomuEpDoc(epDoc);
            completed++;
            ui.setStatus(
              `Downloading ${completed} / ${total} (${workerCount}x)...`
            );
            ui.setProgress(Math.round((completed / total) * 95));
          }
        };
        await Promise.all(
          Array.from({ length: workerCount }, (_, w) => worker(w))
        );
        let num = 1;
        for (const ep of ordered) {
          if (!ep || !ep.content) continue;
          chapters.push({
            title: ep.title,
            fileName: `chapter_${num}.xhtml`,
            content: ep.content,
          });
          num++;
        }
      } else {
        const visited = new Set();
        let currentUrl = info.firstUrl;
        let epNum = 1;

        while (currentUrl) {
          if (controller.signal.aborted) {
            throw new DOMException("Cancelled", "AbortError");
          }
          if (visited.has(currentUrl)) break;
          visited.add(currentUrl);

          ui.setStatus(
            info.totalEpisodes
              ? `Downloading episode ${epNum} / ${info.totalEpisodes}...`
              : `Downloading episode ${epNum}...`
          );
          if (info.totalEpisodes) {
            ui.setProgress(Math.round((epNum / info.totalEpisodes) * 95));
          }

          const epDoc = await fetchDoc(currentUrl, controller.signal);
          const ep = isNarou
            ? parseNarouEpDoc(epDoc, bookId)
            : parseKakuyomuEpDoc(epDoc);

          if (!ep.content) break;

          chapters.push({
            title: ep.title,
            fileName: `chapter_${epNum}.xhtml`,
            content: ep.content,
          });

          currentUrl = ep.nextUrl;
          epNum++;
        }
      }

      if (chapters.length === 0) {
        throw new Error("No episode content found.");
      }

      ui.setStatus("Building EPUB...");
      ui.setProgress(100);
      const { blob, fileName } = await buildAndSaveEpub(
        JSZip,
        info.title,
        bookId,
        info.author,
        chapters
      );
      ui.showDownloadActions(blob, fileName);
      ui.done(`Ready! ${chapters.length} episodes. Tap Save EPUB if download didn't start.`);
    } catch (err) {
      if (err && err.name === "AbortError") {
        ui.done("Download cancelled.");
      } else {
        ui.done(`Error: ${err?.message || err}`);
      }
    } finally {
      window.__NOVEL_DL_RUNNING__ = false;
    }
  }

  run();
})();
