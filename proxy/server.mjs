#!/usr/bin/env node
/**
 * Lightweight Residential Relay for Novel Downloader (zero external dependencies).
 *
 * Run on a home PC / Mac / Raspberry Pi and expose via Cloudflare Tunnel:
 *   PROXY_TOKEN=your-secret-token node proxy/server.mjs
 *   cloudflared tunnel --url http://localhost:8787
 *
 * Then set in your Vercel project Environment Variables:
 *   SYOSETU_PROXY_URL=https://<your-tunnel-domain>/fetch?url={url}
 *   SYOSETU_PROXY_TOKEN=your-secret-token
 *
 * Once configured, any stock mobile browser (iOS Safari / Android Chrome)
 * can download Narou, Nocturne/Moonlight/Midnight (novel18), and Kakuyomu
 * directly from your Vercel app with zero browser extensions or bookmarklets.
 */

import http from "http";

const PORT = Number(process.env.PORT || 8787);
const PROXY_TOKEN = process.env.PROXY_TOKEN || "";
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function isAllowedTarget(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === "syosetu.com" ||
      host.endsWith(".syosetu.com") ||
      host === "kakuyomu.jp" ||
      host.endsWith(".kakuyomu.jp")
    );
  } catch {
    return false;
  }
}

async function fetchFollowingRedirects(initialUrl, userAgent, maxRedirects = 5) {
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const host = new URL(currentUrl).hostname.toLowerCase();
    const isSyosetu = host === "syosetu.com" || host.endsWith(".syosetu.com");

    const headers = {
      "User-Agent": userAgent || DEFAULT_UA,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
      Referer: isSyosetu ? "https://syosetu.com/" : "https://kakuyomu.jp/",
    };

    if (isSyosetu) {
      headers.Cookie = "over18=yes";
    }

    const res = await fetch(currentUrl, {
      redirect: "manual",
      headers,
      signal: AbortSignal.timeout(20000),
    });

    if (!REDIRECT_STATUSES.has(res.status)) {
      const body = await res.text();
      return {
        status: res.status,
        contentType:
          res.headers.get("content-type") || "text/html; charset=utf-8",
        finalUrl: currentUrl,
        body,
      };
    }

    const location = res.headers.get("location");
    if (!location) {
      const body = await res.text();
      return {
        status: res.status,
        contentType: "text/html; charset=utf-8",
        finalUrl: currentUrl,
        body,
      };
    }

    let nextUrl = new URL(location, currentUrl).toString();
    if (nextUrl.includes("nl.syosetu.com/redirect/ageauth")) {
      const unwrapped = new URL(nextUrl).searchParams.get("url");
      if (unwrapped && unwrapped !== currentUrl) {
        nextUrl = unwrapped;
      }
    }

    if (!isAllowedTarget(nextUrl)) {
      return {
        status: 403,
        contentType: "application/json",
        finalUrl: currentUrl,
        body: JSON.stringify({ error: "Disallowed redirect target" }),
      };
    }

    currentUrl = nextUrl;
  }

  return {
    status: 502,
    contentType: "application/json",
    finalUrl: currentUrl,
    body: JSON.stringify({ error: "Too many redirects" }),
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (reqUrl.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (reqUrl.pathname !== "/fetch") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found. Use /fetch?url=..." }));
      return;
    }

    if (PROXY_TOKEN) {
      const provided = req.headers["x-proxy-token"] || reqUrl.searchParams.get("token");
      if (provided !== PROXY_TOKEN) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }

    const targetUrl = reqUrl.searchParams.get("url");
    if (!targetUrl || !isAllowedTarget(targetUrl)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "A valid syosetu.com or kakuyomu.jp url query parameter is required",
        })
      );
      return;
    }

    const ua =
      typeof req.headers["user-agent"] === "string"
        ? req.headers["user-agent"]
        : DEFAULT_UA;

    const result = await fetchFollowingRedirects(targetUrl, ua);
    res.writeHead(result.status, {
      "Content-Type": result.contentType,
      "X-Final-Url": result.finalUrl,
    });
    res.end(result.body);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Novel Downloader relay listening on http://127.0.0.1:${PORT}/fetch`);
  if (!PROXY_TOKEN) {
    console.warn("WARNING: PROXY_TOKEN is not set. Set PROXY_TOKEN before exposing publicly.");
  }
});
