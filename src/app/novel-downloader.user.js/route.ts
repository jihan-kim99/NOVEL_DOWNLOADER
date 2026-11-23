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
    "https://syosetu.com/*",
    "https://*.syosetu.com/*",
    "https://kakuyomu.jp/works/*",
  ]);

  const matchLines = Array.from(matchSet)
    .map((m) => `// @match        ${m}`)
    .join("\n");

  const script = `// ==UserScript==
// @name         Novel Downloader Helper (Narou / R18 / Kakuyomu)
// @namespace    novel-downloader-helper
// @version      2.1.0
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
// @grant        GM.xmlHttpRequest
// @grant        GM_cookie
// @grant        GM.cookie
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  const BRIDGE_VERSION = "2.1.0";
  const host = location.hostname.toLowerCase();
  const isSyosetuSite =
    host === "syosetu.com" || host.endsWith(".syosetu.com");
  const isNovelSite = isSyosetuSite || host === "kakuyomu.jp";

  const gmRequest =
    typeof GM_xmlhttpRequest === "function"
      ? GM_xmlhttpRequest
      : typeof GM !== "undefined" &&
        GM &&
        typeof GM.xmlHttpRequest === "function"
      ? GM.xmlHttpRequest.bind(GM)
      : null;

  // ---------------------------------------------------------------------------
  // 1. Web App Bridge (postMessage <-> GM_xmlhttpRequest + GM_cookie)
  //    Fetches Syosetu / novel18 / Kakuyomu using the user's residential IP
  //    and over18=yes cookie (works on Chrome MV3, Firefox, Safari, Vercel).
  // ---------------------------------------------------------------------------
  if (!isNovelSite) {
    let cookieSeedPromise = null;
    let preferredSyosetuMode = 0;

    function getCookieApi() {
      if (typeof GM_cookie !== "undefined" && typeof GM_cookie.set === "function") {
        return GM_cookie;
      }
      if (
        typeof GM !== "undefined" &&
        GM &&
        GM.cookie &&
        typeof GM.cookie.set === "function"
      ) {
        return GM.cookie;
      }
      return null;
    }

    function setSingleCookie(cookieApi, details) {
      return new Promise((resolve) => {
        let settled = false;
        const finish = (ok) => {
          if (settled) return;
          settled = true;
          resolve(ok);
        };
        const timer = setTimeout(() => finish(false), 2500);
        try {
          const maybePromise = cookieApi.set(details, (err) => {
            clearTimeout(timer);
            finish(!err);
          });
          if (maybePromise && typeof maybePromise.then === "function") {
            maybePromise
              .then(() => {
                clearTimeout(timer);
                finish(true);
              })
              .catch(() => {
                clearTimeout(timer);
                finish(false);
              });
          }
        } catch {
          clearTimeout(timer);
          finish(false);
        }
      });
    }

    function ensureOver18Cookie(force) {
      if (!force && cookieSeedPromise) return cookieSeedPromise;
      cookieSeedPromise = (async () => {
        const cookieApi = getCookieApi();
        if (!cookieApi) return false;

        const expirationDate = Math.floor(Date.now() / 1000) + 31536000;
        const domainOk = await setSingleCookie(cookieApi, {
          url: "https://novel18.syosetu.com/",
          name: "over18",
          value: "yes",
          domain: ".syosetu.com",
          path: "/",
          secure: true,
          expirationDate,
        });
        if (domainOk) return true;

        // Fallback to host-specific cookies if wildcard domain fails
        const results = await Promise.all([
          setSingleCookie(cookieApi, {
            url: "https://novel18.syosetu.com/",
            name: "over18",
            value: "yes",
            path: "/",
            secure: true,
            expirationDate,
          }),
          setSingleCookie(cookieApi, {
            url: "https://ncode.syosetu.com/",
            name: "over18",
            value: "yes",
            path: "/",
            secure: true,
            expirationDate,
          }),
          setSingleCookie(cookieApi, {
            url: "https://nl.syosetu.com/",
            name: "over18",
            value: "yes",
            path: "/",
            secure: true,
            expirationDate,
          }),
        ]);
        return results.some(Boolean);
      })();
      return cookieSeedPromise;
    }

    function isAgeAuthResponse(finalUrl, html) {
      if (finalUrl && finalUrl.includes("nl.syosetu.com/redirect/ageauth")) {
        return true;
      }
      const hasNovelStructure =
        html.includes("p-novel__title") ||
        html.includes("p-novel__body") ||
        html.includes("p-eplist") ||
        html.includes("novel_honbun") ||
        html.includes("novel_title") ||
        html.includes("novel_view") ||
        html.includes("novel_subtitle") ||
        html.includes("p-novel__subtitle") ||
        html.includes("p-novel__text") ||
        html.includes("index_box");
      if (hasNovelStructure) {
        return false;
      }
      return (
        html.includes("年齢確認") ||
        html.includes("nl.syosetu.com/redirect/ageauth")
      );
    }

    function normalizeSyosetuHttps(rawUrl) {
      if (!rawUrl) return null;
      try {
        const u = new URL(rawUrl);
        if (
          u.protocol === "http:" &&
          (u.hostname === "syosetu.com" || u.hostname.endsWith(".syosetu.com"))
        ) {
          u.protocol = "https:";
        }
        return u.toString();
      } catch {
        return rawUrl;
      }
    }

    async function gmFetch(targetUrl, depth, modeOverride) {
      if (!gmRequest) {
        return {
          ok: false,
          status: 0,
          finalUrl: targetUrl,
          html: "",
          error: "GM_xmlhttpRequest is not available in this userscript manager.",
        };
      }

      const isSyosetu = /(^|\\.)syosetu\\.com$/i.test(new URL(targetUrl).hostname);
      const mode =
        typeof modeOverride === "number"
          ? modeOverride
          : isSyosetu
          ? preferredSyosetuMode
          : 0;

      if (isSyosetu) {
        await ensureOver18Cookie(false);
      }

      return new Promise((resolve) => {
        const headers = {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
        };
        if (isSyosetu) {
          headers["Referer"] = "https://syosetu.com/";
          if (mode === 0 || mode === 2) {
            headers["Cookie"] = "over18=yes";
          }
        }

        // Mode 0: Real browser cookies (anonymous: false) + cookie/Cookie header (TM MV3/MV2, VM, Safari)
        // Mode 1: Pure browser cookie jar (anonymous: false, no custom Cookie header)
        // Mode 2: Legacy anonymous mode with explicit Cookie header (fallback for older managers)
        const requestOptions = {
          method: "GET",
          url: targetUrl,
          anonymous: isSyosetu && mode === 2,
          headers,
          timeout: 25000,
          onload(res) {
            const finalUrl = res.finalUrl || targetUrl;
            const html = res.responseText || "";

            if (isSyosetu && isAgeAuthResponse(finalUrl, html)) {
              let unwrappedUrl = null;
              try {
                if (finalUrl.includes("nl.syosetu.com/redirect/ageauth")) {
                  unwrappedUrl = normalizeSyosetuHttps(
                    new URL(finalUrl).searchParams.get("url")
                  );
                }
                if (!unwrappedUrl) {
                  const m = targetUrl.match(/\\/(n\\d{4}[a-z]{1,2})(\\/\\d+)?\\/?$/i);
                  if (m && !targetUrl.includes("novel18.syosetu.com")) {
                    unwrappedUrl =
                      "https://novel18.syosetu.com/" +
                      m[1].toLowerCase() +
                      (m[2] ? m[2] + "/" : "/");
                  }
                }
              } catch {
                // Ignore URL parse issues
              }

              const retryTarget = unwrappedUrl || targetUrl;

              // 1) If ncode redirected to novel18 via ageauth, retry on novel18 directly
              if (depth < 4 && retryTarget !== targetUrl) {
                gmFetch(retryTarget, depth + 1, mode).then(resolve);
                return;
              }

              // 2) Same URL hit ageauth -> force re-seed cookie and try next request mode
              if (depth < 4 && mode < 2) {
                const nextMode = mode + 1;
                ensureOver18Cookie(true).then(() => {
                  gmFetch(retryTarget, depth + 1, nextMode).then(resolve);
                });
                return;
              }

              resolve({
                ok: res.status >= 200 && res.status < 300,
                status: res.status,
                finalUrl,
                html,
                ageAuthBlocked: true,
              });
              return;
            }

            if (isSyosetu && res.status >= 200 && res.status < 300) {
              preferredSyosetuMode = mode;
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
        };

        if (isSyosetu && (mode === 0 || mode === 2)) {
          requestOptions.cookie = "over18=yes";
        }

        gmRequest(requestOptions);
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

    // Proactively seed over18=yes cookie if supported, and announce readiness
    ensureOver18Cookie(false).catch(() => {});
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
  // 2. Syosetu R18 Cookie Seeding & Direct Floating "Download EPUB" Button
  // ---------------------------------------------------------------------------
  if (isSyosetuSite) {
    try {
      const secureFlag = location.protocol === "https:" ? "; Secure" : "";
      document.cookie =
        "over18=yes; domain=.syosetu.com; path=/; max-age=31536000; SameSite=Lax" +
        secureFlag;
    } catch {
      // Ignore cookie write errors
    }
  }

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
      s.onerror = () => {
        alert(
          "Could not load the downloader script from ${origin}. Open the Novel Downloader web app directly to download with the Browser Helper."
        );
      };
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
