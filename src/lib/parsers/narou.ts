import type { Episode, NovelInfo, NovelUpdateCheckResult } from "../../types";
import { buildNarouHeaders, fetchWithRetry } from "../http";
import {
  canonicalizeNarouDomain,
  extractNarouTocPage,
  HttpStatusError,
  parseNarouEpisode,
  parseNarouInfo,
  parseSyosetuApiMeta,
} from "./narou-parse";

export {
  canonicalizeNarouDomain,
  extractNarouTocPage,
  HttpStatusError,
  parseNarouEpisode,
  parseNarouInfo,
  parseSyosetuApiMeta,
};

async function fetchNarouApiMeta(
  bookId: string,
  domain: string,
  userAgent: string
): Promise<NovelUpdateCheckResult | null> {
  const endpoint =
    domain === "novel18.syosetu.com"
      ? `https://api.syosetu.com/novel18api/api/?out=json&ncode=${encodeURIComponent(bookId)}`
      : `https://api.syosetu.com/novelapi/api/?out=json&ncode=${encodeURIComponent(bookId)}`;

  try {
    const res = await fetch(endpoint, {
      headers: { "User-Agent": userAgent },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return parseSyosetuApiMeta(data, domain);
  } catch {
    // Best-effort metadata only
  }
  return null;
}

/**
 * Fast, cloud-IP-safe update check for Narou / Narou R18 using Syosetu's public JSON API,
 * falling back to full TOC scraping only if the API returns no entry.
 */
export async function checkNarouUpdate(
  bookId: string,
  userAgent: string,
  domain: string = "ncode.syosetu.com"
): Promise<NovelUpdateCheckResult> {
  const normalizedId = bookId.toLowerCase();
  const primaryDomain = canonicalizeNarouDomain(domain);
  const domainsToTry = [
    primaryDomain,
    primaryDomain === "ncode.syosetu.com"
      ? "novel18.syosetu.com"
      : "ncode.syosetu.com",
  ];

  for (const currentDomain of domainsToTry) {
    const meta = await fetchNarouApiMeta(normalizedId, currentDomain, userAgent);
    if (meta && meta.totalEpisodes > 0) {
      return meta;
    }
  }

  // Fallback to HTML info scrape if Syosetu API has no record yet
  const info = await handleNarouInfo(normalizedId, userAgent, primaryDomain, true);
  const totalEpisodes =
    info.totalEpisodes || info.episodeUrls?.length || (info.isShortStory ? 1 : 0);

  return {
    title: info.title,
    author: info.author,
    domain: info.domain || primaryDomain,
    totalEpisodes,
    status: info.status || (info.isShortStory ? "short" : "unknown"),
    isShortStory: info.isShortStory,
    remoteUpdatedAt: info.remoteUpdatedAt,
  };
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function extractSetCookiePairs(headers: Headers): string {
  const rawList: string[] =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : (() => {
          const single = headers.get("set-cookie");
          return single ? single.split(/,(?=\s*[^;=]+=[^;]+)/) : [];
        })();

  const pairs: string[] = [];
  for (const raw of rawList) {
    const firstSegment = raw.split(";")[0]?.trim();
    if (firstSegment && firstSegment.includes("=")) {
      pairs.push(firstSegment);
    }
  }
  return pairs.join("; ");
}

function normalizeSyosetuHttps(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (
      parsed.protocol === "http:" &&
      (parsed.hostname === "syosetu.com" ||
        parsed.hostname.endsWith(".syosetu.com"))
    ) {
      parsed.protocol = "https:";
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

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

  let currentUrl = normalizeSyosetuHttps(initialUrl);
  let accumulatedCookie = extraCookie || "";
  let referer = "https://syosetu.com/";
  let retriedSameAgeAuth = false;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const response = await fetchWithRetry(currentUrl, {
      redirect: "manual",
      headers: buildNarouHeaders(userAgent, accumulatedCookie, referer),
    });

    const newCookies = extractSetCookiePairs(response.headers);
    if (newCookies) {
      accumulatedCookie = accumulatedCookie
        ? `${accumulatedCookie}; ${newCookies}`
        : newCookies;
    }

    if (!REDIRECT_STATUSES.has(response.status)) {
      return { response, finalUrl: currentUrl };
    }

    const location = response.headers.get("location");
    if (!location) {
      return { response, finalUrl: currentUrl };
    }

    let nextUrl = normalizeSyosetuHttps(
      new URL(location, currentUrl).toString()
    );

    if (nextUrl.includes("nl.syosetu.com/redirect/ageauth")) {
      const targetParam = new URL(nextUrl).searchParams.get("url");
      const unwrapped = targetParam
        ? normalizeSyosetuHttps(targetParam)
        : null;
      if (unwrapped && unwrapped !== currentUrl) {
        referer = "https://nl.syosetu.com/";
        nextUrl = unwrapped;
      } else if (unwrapped && !retriedSameAgeAuth) {
        retriedSameAgeAuth = true;
        referer = "https://nl.syosetu.com/";
        nextUrl = unwrapped;
      } else {
        throw new HttpStatusError(
          "Syosetu R18 age verification blocked this request.",
          403
        );
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
  allowDomainFallback: boolean = true,
  extraCookie?: string
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

    const { response, finalUrl } = await fetchNarouPage(
      infoUrl,
      userAgent,
      extraCookie
    );

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
            const tocRes = await fetchNarouPage(tocUrl, userAgent, extraCookie);
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

    if (
      !parsed.totalEpisodes ||
      !parsed.author ||
      !parsed.status ||
      !parsed.remoteUpdatedAt
    ) {
      const apiMeta = await fetchNarouApiMeta(
        normalizedId,
        resolvedDomain,
        userAgent
      );
      if (apiMeta) {
        if (!parsed.totalEpisodes && apiMeta.totalEpisodes) {
          parsed.totalEpisodes = apiMeta.totalEpisodes;
        }
        if (!parsed.author && apiMeta.author) {
          parsed.author = apiMeta.author;
        }
        if (!parsed.status && apiMeta.status) {
          parsed.status = apiMeta.status;
        }
        if (!parsed.remoteUpdatedAt && apiMeta.remoteUpdatedAt) {
          parsed.remoteUpdatedAt = apiMeta.remoteUpdatedAt;
        }
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
  userAgent: string,
  extraCookie?: string
): Promise<Episode> {
  console.log(`[INFO] Fetching Narou episode: ${url}`);

  const { response, finalUrl } = await fetchNarouPage(
    url,
    userAgent,
    extraCookie
  );

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
