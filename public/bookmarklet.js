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
      "position:fixed;bottom:20px;right:20px;z-index:2147483647;background:#1e1b4b;color:#fff;padding:16px 18px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,0.4);font-family:system-ui,-apple-system,sans-serif;font-size:13px;width:320px;line-height:1.5;";
    box.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
      '<strong style="font-size:14px;">Novel Downloader</strong>' +
      '<button id="novel-dl-cancel" style="background:#ef4444;color:#fff;border:none;border-radius:6px;padding:3px 9px;cursor:pointer;font-size:12px;font-weight:600;">Cancel</button>' +
      "</div>" +
      '<div id="novel-dl-title" style="font-weight:600;color:#c7d2fe;margin-bottom:6px;word-break:break-word;"></div>' +
      '<div id="novel-dl-status" style="color:#e0e7ff;">Initializing...</div>' +
      '<div style="margin-top:8px;height:6px;background:rgba(255,255,255,0.2);border-radius:999px;overflow:hidden;">' +
      '<div id="novel-dl-bar" style="height:100%;width:10%;background:linear-gradient(90deg,#60a5fa,#c084fc);transition:width .2s;"></div>' +
      "</div>";
    document.body.appendChild(box);
    const cancelBtn = box.querySelector("#novel-dl-cancel");
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

  function parseNarouInfoDoc(doc, ncode) {
    let title =
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

    const epRegex = new RegExp(`^/${ncode}/(\\d+)/?$`, "i");
    let firstHref = null;
    const epLinks = doc.querySelectorAll(
      "a.p-eplist__subtitle, .novel_sublist2 a, dd.subtitle a"
    );
    for (const a of epLinks) {
      const h = a.getAttribute("href");
      if (h && epRegex.test(h)) {
        firstHref = h;
        break;
      }
    }
    if (!firstHref) {
      for (const a of doc.querySelectorAll("a[href]")) {
        const h = a.getAttribute("href");
        if (h && epRegex.test(h)) {
          firstHref = h;
          break;
        }
      }
    }

    const hasBody =
      !!doc.querySelector("div.p-novel__body") ||
      !!doc.querySelector("#novel_honbun") ||
      !!doc.querySelector("div.novel_view");

    if (firstHref) {
      const hasMorePages = !!doc.querySelector(
        "a.c-pager__item--next, a.c-pager__item--last"
      );
      return {
        title,
        author,
        firstUrl: location.origin + firstHref,
        totalEpisodes: !hasMorePages && epLinks.length ? epLinks.length : null,
      };
    }
    if (hasBody) {
      return {
        title,
        author,
        firstUrl: `${location.origin}/${ncode}/`,
        totalEpisodes: 1,
      };
    }
    return {
      title,
      author,
      firstUrl: `${location.origin}/${ncode}/1/`,
      totalEpisodes: null,
    };
  }

  function parseNarouEpDoc(doc, ncode) {
    const title =
      doc.querySelector("h1.p-novel__title")?.textContent?.trim() ||
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
          if (work.firstPublicEpisodeUnion?.__ref) {
            firstEpId = work.firstPublicEpisodeUnion.__ref.split(":")[1];
          }
          if (!firstEpId) {
            for (const chRef of work.tableOfContentsV2 ||
              work.tableOfContents ||
              []) {
              const ch = apollo[chRef?.__ref];
              const ref = ch?.episodeUnions?.[0]?.__ref;
              if (ref) {
                firstEpId = ref.split(":")[1];
                break;
              }
            }
          }
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
    let firstHref = firstEpId ? `/works/${workId}/episodes/${firstEpId}` : null;
    if (!firstHref) {
      const epRegex = new RegExp(`^/works/${workId}/episodes/\\d+$`);
      for (const a of doc.querySelectorAll(
        `a[href^="/works/${workId}/episodes/"]`
      )) {
        const h = a.getAttribute("href");
        if (h && epRegex.test(h)) {
          firstHref = h;
          break;
        }
      }
    }
    if (!firstHref) throw new Error("Could not find first episode link.");
    return {
      title,
      author,
      firstUrl: "https://kakuyomu.jp" + firstHref,
      totalEpisodes,
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
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sanitizeFilename(title)}.epub`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
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

      const chapters = [];
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

        if (currentUrl) {
          await new Promise((resolve, reject) => {
            const t = setTimeout(resolve, 250);
            controller.signal.addEventListener(
              "abort",
              () => {
                clearTimeout(t);
                reject(new DOMException("Cancelled", "AbortError"));
              },
              { once: true }
            );
          });
        }
      }

      if (chapters.length === 0) {
        throw new Error("No episode content found.");
      }

      ui.setStatus("Building EPUB...");
      ui.setProgress(100);
      await buildAndSaveEpub(
        JSZip,
        info.title,
        bookId,
        info.author,
        chapters
      );
      ui.done(`Done! Saved ${chapters.length} episodes.`);
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
