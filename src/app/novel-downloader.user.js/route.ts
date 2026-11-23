import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const forwardedHost =
    request.headers.get("x-forwarded-host") || request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const protocol = forwardedProto
    ? `${forwardedProto.split(",")[0].trim()}:`
    : url.protocol;
  const host = forwardedHost ? forwardedHost.split(",")[0].trim() : url.host;
  const origin = `${protocol}//${host}`;

  const matchSet = new Set<string>([
    `${origin}/*`,
    "https://*.vercel.app/*",
    "http://localhost:*/*",
    "http://127.0.0.1:*/*",
    "https://ncode.syosetu.com/*",
    "https://novel18.syosetu.com/*",
    "https://kakuyomu.jp/works/*",
  ]);

  const matchLines = Array.from(matchSet)
    .map((m) => `// @match        ${m}`)
    .join("\n");

  const script = `// ==UserScript==
// @name         Novel Downloader Helper (Narou / R18 / Kakuyomu)
// @namespace    novel-downloader-helper
// @version      2.0.0
// @description  Bridges the Novel Downloader web app directly through your browser (bypassing cloud IP blocks & R18 age checks) and adds a Download EPUB button on Narou, novel18, and Kakuyomu pages.
${matchLines}
// @connect      syosetu.com
// @connect      ncode.syosetu.com
// @connect      novel18.syosetu.com
// @connect      noc.syosetu.com
// @connect      mnlt.syosetu.com
// @connect      mid.syosetu.com
// @connect      nl.syosetu.com
// @connect      api.syosetu.com
// @connect      kakuyomu.jp
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  const BRIDGE_VERSION = "2.0.0";
  const host = location.hostname.toLowerCase();
  const isNovelSite =
    host === "ncode.syosetu.com" ||
    host === "novel18.syosetu.com" ||
    host === "kakuyomu.jp";

  // ---------------------------------------------------------------------------
  // 1. Web App Bridge (postMessage <-> GM_xmlhttpRequest)
  //    Fetches Syosetu / novel18 / Kakuyomu using the user's residential IP
  //    with explicit Cookie: over18=yes (works on Vercel with zero 403 blocks!)
  // ---------------------------------------------------------------------------
  if (!isNovelSite) {
    function gmFetch(targetUrl, depth) {
      return new Promise((resolve) => {
        const isSyosetu = /(^|\\.)syosetu\\.com$/i.test(new URL(targetUrl).hostname);
        const headers = {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
        };
        if (isSyosetu) {
          headers["Cookie"] = "over18=yes";
          headers["Referer"] = "https://syosetu.com/";
        }

        GM_xmlhttpRequest({
          method: "GET",
          url: targetUrl,
          anonymous: isSyosetu,
          cookie: isSyosetu ? "over18=yes" : undefined,
          headers,
          timeout: 25000,
          onload(res) {
            const finalUrl = res.finalUrl || targetUrl;
            const html = res.responseText || "";

            // Handle Syosetu age-check redirect (e.g. ncode -> nl.syosetu.com/redirect/ageauth/?url=...)
            if (
              depth < 3 &&
              isSyosetu &&
              (finalUrl.includes("nl.syosetu.com/redirect/ageauth") ||
                (html.includes("年齢確認") &&
                  !html.includes("p-novel__title") &&
                  !html.includes("p-novel__body") &&
                  !html.includes("p-eplist")))
            ) {
              try {
                let nextUrl = null;
                if (finalUrl.includes("nl.syosetu.com/redirect/ageauth")) {
                  nextUrl = new URL(finalUrl).searchParams.get("url");
                }
                if (!nextUrl) {
                  const m = targetUrl.match(/\\/(n\\d{4}[a-z]{1,2})(\\/\\d+)?\\/?$/i);
                  if (m) {
                    nextUrl =
                      "https://novel18.syosetu.com/" +
                      m[1].toLowerCase() +
                      (m[2] ? m[2] + "/" : "/");
                  }
                }
                if (nextUrl && nextUrl !== targetUrl) {
                  gmFetch(nextUrl, depth + 1).then(resolve);
                  return;
                }
              } catch {
                // Fall through with original response
              }
            }

            resolve({
              ok: res.status >= 200 && res.status < 300,
              status: res.status,
              finalUrl,
              html,
            });
          },
          onerror(err) {
            resolve({
              ok: false,
              status: 0,
              finalUrl: targetUrl,
              html: "",
              error: err?.error || "GM_xmlhttpRequest network error",
            });
          },
          ontimeout() {
            resolve({
              ok: false,
              status: 0,
              finalUrl: targetUrl,
              html: "",
              error: "Request timed out",
            });
          },
        });
      });
    }

    window.addEventListener("message", (event) => {
      if (event.source !== window || !event.data || typeof event.data !== "object") {
        return;
      }

      if (event.data.type === "NOVEL_DL_PING") {
        window.postMessage(
          { type: "NOVEL_DL_PONG", version: BRIDGE_VERSION },
          "*"
        );
        return;
      }

      if (event.data.type === "NOVEL_DL_FETCH_REQ") {
        const { id, url: reqUrl } = event.data;
        if (!id || typeof reqUrl !== "string") return;

        // Only allow syosetu.com and kakuyomu.jp URLs
        let allowed = false;
        try {
          const parsed = new URL(reqUrl);
          allowed =
            parsed.hostname === "syosetu.com" ||
            parsed.hostname.endsWith(".syosetu.com") ||
            parsed.hostname === "kakuyomu.jp" ||
            parsed.hostname.endsWith(".kakuyomu.jp");
        } catch {
          allowed = false;
        }

        if (!allowed) {
          window.postMessage(
            {
              type: "NOVEL_DL_FETCH_RES",
              id,
              ok: false,
              status: 400,
              error: "Disallowed host",
            },
            "*"
          );
          return;
        }

        gmFetch(reqUrl, 0).then((result) => {
          window.postMessage(
            { type: "NOVEL_DL_FETCH_RES", id, ...result },
            "*"
          );
        });
      }
    });

    // Announce readiness once DOM is ready
    const announce = () => {
      window.postMessage(
        { type: "NOVEL_DL_PONG", version: BRIDGE_VERSION },
        "*"
      );
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", announce, { once: true });
    } else {
      announce();
    }
    return;
  }

  // ---------------------------------------------------------------------------
  // 2. Direct Floating "Download EPUB" Button on Narou / novel18 / Kakuyomu
  // ---------------------------------------------------------------------------
  function injectDirectButton() {
    const isValidNovelPage =
      (host === "kakuyomu.jp" && /\\/works\\/\\d+/.test(location.pathname)) ||
      ((host === "ncode.syosetu.com" || host === "novel18.syosetu.com") &&
        /\\/n\\d{4}[a-z]{1,2}\\b/i.test(location.pathname));

    if (!isValidNovelPage || document.getElementById("novel-dl-fab")) return;

    const btn = document.createElement("button");
    btn.id = "novel-dl-fab";
    btn.textContent = "Download EPUB";
    btn.style.cssText =
      "position:fixed;bottom:20px;right:20px;z-index:2147483646;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;border:none;border-radius:999px;padding:10px 18px;font-family:system-ui,-apple-system,sans-serif;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 6px 20px rgba(79,70,229,0.45);";
    btn.addEventListener("click", () => {
      const s = document.createElement("script");
      s.src = "${origin}/bookmarklet.js?t=" + Date.now();
      document.head.appendChild(s);
    });
    document.body.appendChild(btn);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectDirectButton, {
      once: true,
    });
  } else {
    injectDirectButton();
  }
})();
`;

  return new NextResponse(script, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
