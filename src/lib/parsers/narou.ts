import type { Episode, NovelInfo } from "../../types";
import { buildNarouHeaders, fetchWithRetry } from "../http";
import {
  canonicalizeNarouDomain,
  extractNarouTocPage,
  HttpStatusError,
  parseNarouEpisode,
  parseNarouInfo,
} from "./narou-parse";

export {
  canonicalizeNarouDomain,
  extractNarouTocPage,
  HttpStatusError,
  parseNarouEpisode,
  parseNarouInfo,
};

async function fetchNarouApiMeta(
  bookId: string,
  domain: string,
  userAgent: string
): Promise<{ totalEpisodes?: number; author?: string }> {
  const endpoint =
    domain === "novel18.syosetu.com"
      ? `https://api.syosetu.com/novel18api/api/?out=json&ncode=${encodeURIComponent(bookId)}&of=ga-w`
      : `https://api.syosetu.com/novelapi/api/?out=json&ncode=${encodeURIComponent(bookId)}&of=ga-w`;

  try {
    const res = await fetch(endpoint, {
      headers: { "User-Agent": userAgent },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return {};
    const data = await res.json();
    if (Array.isArray(data) && data.length > 1 && data[1]) {
      const total = Number(data[1].general_all_no);
      const writer =
        typeof data[1].writer === "string" ? data[1].writer.trim() : undefined;
      return {
        totalEpisodes: Number.isFinite(total) && total > 0 ? total : undefined,
        author: writer || undefined,
      };
    }
  } catch {
    // Best-effort metadata only
  }
  return {};
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export async function fetchNarouPage(
  initialUrl: string,
  userAgent: string,
  extraCookie?: string,
  maxRedirects = 5
): Promise<{ response: Response; finalUrl: string }> {
  const customProxyTemplate =
    process.env.SYOSETU_PROXY_URL || process.env.FETCH_PROXY_URL;
  if (customProxyTemplate) {
    const proxiedUrl = customProxyTemplate.includes("{url}")
      ? customProxyTemplate.replace("{url}", encodeURIComponent(initialUrl))
      : `${customProxyTemplate}${encodeURIComponent(initialUrl)}`;
    const headers = buildNarouHeaders(userAgent, extraCookie);
    const proxyToken =
      process.env.SYOSETU_PROXY_TOKEN || process.env.FETCH_PROXY_TOKEN;
    if (proxyToken) {
      headers["x-proxy-token"] = proxyToken;
    }
    const response = await fetchWithRetry(proxiedUrl, { headers });
    const resolvedUrl = response.headers.get("x-final-url") || initialUrl;
    return { response, finalUrl: resolvedUrl };
  }

  let currentUrl = initialUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const response = await fetchWithRetry(currentUrl, {
      redirect: "manual",
      headers: buildNarouHeaders(userAgent, extraCookie),
    });

    if (!REDIRECT_STATUSES.has(response.status)) {
      return { response, finalUrl: currentUrl };
    }

    const location = response.headers.get("location");
    if (!location) {
      return { response, finalUrl: currentUrl };
    }

    let nextUrl = new URL(location, currentUrl).toString();

    if (nextUrl.includes("nl.syosetu.com/redirect/ageauth")) {
      const targetParam = new URL(nextUrl).searchParams.get("url");
      if (targetParam && targetParam !== currentUrl) {
        nextUrl = targetParam;
      } else {
        return { response, finalUrl: nextUrl };
      }
    }

    const nextHost = new URL(nextUrl).hostname.toLowerCase();
    if (nextHost !== "syosetu.com" && !nextHost.endsWith(".syosetu.com")) {
      return { response, finalUrl: nextUrl };
    }

    currentUrl = nextUrl;
  }

  throw new HttpStatusError("Too many redirects from Syosetu.", 502);
}

export async function handleNarouInfo(
  bookId: string,
  userAgent: string,
  domain: string = "ncode.syosetu.com",
  allowDomainFallback: boolean = true
): Promise<NovelInfo> {
  const normalizedId = bookId.toLowerCase();
  const primaryDomain = canonicalizeNarouDomain(domain);
  const domainsToTry = allowDomainFallback
    ? [
        primaryDomain,
        primaryDomain === "ncode.syosetu.com"
          ? "novel18.syosetu.com"
          : "ncode.syosetu.com",
      ]
    : [primaryDomain];

  let lastStatus = 500;

  for (const currentDomain of domainsToTry) {
    const infoUrl = `https://${currentDomain}/${normalizedId}/`;
    console.log(`[INFO] Fetching Narou info from: ${infoUrl}`);

    const { response, finalUrl } = await fetchNarouPage(infoUrl, userAgent);

    if (response.status === 404) {
      lastStatus = 404;
      continue;
    }

    if (response.status === 403) {
      throw new HttpStatusError(
        "Access Forbidden (403). The server IP is likely blocked by Syosetu.",
        403
      );
    }

    if (!response.ok) {
      throw new HttpStatusError(
        `Failed to fetch Narou info (${response.status})`,
        response.status
      );
    }

    let resolvedDomain = currentDomain;
    try {
      resolvedDomain = canonicalizeNarouDomain(new URL(finalUrl).hostname);
    } catch {
      // Keep currentDomain
    }

    const html = await response.text();
    const parsed = parseNarouInfo(
      html,
      normalizedId,
      resolvedDomain,
      userAgent,
      finalUrl
    );

    // Fetch remaining TOC pages in parallel so long serialized novels (>100 eps)
    // can be downloaded concurrently with exact chapter URLs.
    if (parsed.tocPages && parsed.tocPages > 1 && parsed.episodeUrls) {
      const maxPages = Math.min(parsed.tocPages, 50);
      const pageNums = Array.from({ length: maxPages - 1 }, (_, i) => i + 2);
      const pageResults: string[][] = new Array(pageNums.length);
      let cursor = 0;

      const tocWorker = async () => {
        while (cursor < pageNums.length) {
          const idx = cursor++;
          const pageNum = pageNums[idx];
          try {
            const tocUrl = `https://${resolvedDomain}/${normalizedId}/?p=${pageNum}`;
            const tocRes = await fetchNarouPage(tocUrl, userAgent);
            if (tocRes.response.ok) {
              const tocHtml = await tocRes.response.text();
              const { episodeUrls } = extractNarouTocPage(
                tocHtml,
                normalizedId,
                resolvedDomain
              );
              pageResults[idx] = episodeUrls;
            }
          } catch {
            // Leave empty; handled below
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(4, pageNums.length) }, () => tocWorker())
      );

      if (pageResults.every((r) => Array.isArray(r) && r.length > 0)) {
        const merged = [...parsed.episodeUrls];
        const seen = new Set(merged);
        for (const list of pageResults) {
          for (const u of list) {
            if (!seen.has(u)) {
              seen.add(u);
              merged.push(u);
            }
          }
        }
        parsed.episodeUrls = merged;
        parsed.totalEpisodes = merged.length;
      } else {
        // Incomplete TOC -> let client fall back cleanly to sequential nextUrl traversal
        parsed.episodeUrls = undefined;
      }
    }

    if (!parsed.totalEpisodes || !parsed.author) {
      const apiMeta = await fetchNarouApiMeta(
        normalizedId,
        resolvedDomain,
        userAgent
      );
      if (!parsed.totalEpisodes && apiMeta.totalEpisodes) {
        parsed.totalEpisodes = apiMeta.totalEpisodes;
      }
      if (!parsed.author && apiMeta.author) {
        parsed.author = apiMeta.author;
      }
    }

    return parsed;
  }

  throw new HttpStatusError(
    `Novel "${normalizedId}" was not found on Syosetu (ncode / novel18).`,
    lastStatus
  );
}

export async function handleNarouEpisode(
  url: string,
  userAgent: string
): Promise<Episode> {
  console.log(`[INFO] Fetching Narou episode: ${url}`);

  const { response, finalUrl } = await fetchNarouPage(url, userAgent);

  if (response.status === 403) {
    throw new HttpStatusError(
      "Access Forbidden (403). The server IP is likely blocked by Syosetu.",
      403
    );
  }

  if (!response.ok) {
    throw new HttpStatusError(
      `Failed to fetch Narou episode (${response.status})`,
      response.status
    );
  }

  const html = await response.text();
  return parseNarouEpisode(html, finalUrl, finalUrl);
}
