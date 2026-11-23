import * as cheerio from "cheerio";
import type { Episode, NovelInfo } from "../../types";
import { buildNarouHeaders, fetchWithRetry } from "../http";
import { paragraphsToXhtml } from "../xhtml";

export class HttpStatusError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpStatusError";
    this.status = status;
  }
}

const R18_HOSTS = new Set([
  "novel18.syosetu.com",
  "noc.syosetu.com",
  "mnlt.syosetu.com",
  "mid.syosetu.com",
]);

export function canonicalizeNarouDomain(domain?: string): string {
  const lower = (domain || "").trim().toLowerCase();
  if (R18_HOSTS.has(lower)) {
    return "novel18.syosetu.com";
  }
  return "ncode.syosetu.com";
}

function isAgeAuthPage(html: string, finalUrl?: string): boolean {
  if (finalUrl && finalUrl.includes("nl.syosetu.com/redirect/ageauth")) {
    return true;
  }
  const $ = cheerio.load(html);
  const hasNovelStructure =
    $(".p-novel__title").length > 0 ||
    $(".p-novel__body").length > 0 ||
    $(".p-eplist").length > 0 ||
    $("#novel_honbun").length > 0 ||
    $(".novel_title").length > 0;
  if (hasNovelStructure) {
    return false;
  }
  const pageTitle = $("title").text();
  return pageTitle.includes("年齢確認") || html.includes("nl.syosetu.com/redirect/ageauth");
}

function cleanNarouTitle(raw: string): string {
  return raw
    .replace(/\s*-\s*小説家になろう\s*$/, "")
    .replace(/\s*\|\|\s*(ノクターンノベルズ|ムーンライトノベルズ|ミッドナイトノベルズ)\s*$/, "")
    .trim();
}

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
      const writer = typeof data[1].writer === "string" ? data[1].writer.trim() : undefined;
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

export function parseNarouInfo(
  html: string,
  bookId: string,
  domain: string,
  userAgent: string,
  finalUrl?: string
): NovelInfo {
  const normalizedId = bookId.toLowerCase();
  const canonicalDomain = canonicalizeNarouDomain(domain);

  if (isAgeAuthPage(html, finalUrl)) {
    throw new HttpStatusError(
      "Syosetu R18 age verification blocked this request. Server-side mode sends the over18=yes cookie automatically; public client-side CORS proxies strip cookies and cannot bypass R18 age checks.",
      403
    );
  }

  const $ = cheerio.load(html);

  // Extract title without truncating titles containing " - "
  let title = $("h1.p-novel__title").first().text().trim();
  if (!title) title = $(".p-novel__title").first().text().trim();
  if (!title) title = $(".novel_title").first().text().trim();
  if (!title) {
    title = cleanNarouTitle($('meta[property="og:title"]').attr("content") || "");
  }
  if (!title) {
    title = cleanNarouTitle($("title").text());
  }

  let author = $(".p-novel__author")
    .first()
    .text()
    .replace(/^作者[：:]\s*/, "")
    .trim();
  if (!author) {
    author = $(".novel_writername")
      .first()
      .text()
      .replace(/^作者[：:]\s*/, "")
      .trim();
  }

  // Detect serialized episode list vs short story (短編)
  const epPathRegex = new RegExp(`^/${normalizedId}/(\\d+)/?$`, "i");
  let firstHref: string | undefined;

  const epListLinks = $("a.p-eplist__subtitle, .novel_sublist2 a, dd.subtitle a");
  epListLinks.each((_, el) => {
    if (firstHref) return;
    const href = $(el).attr("href");
    if (href && epPathRegex.test(href)) {
      firstHref = href;
    }
  });

  if (!firstHref) {
    $("a[href]").each((_, el) => {
      if (firstHref) return;
      const href = $(el).attr("href");
      if (href && epPathRegex.test(href)) {
        firstHref = href;
      }
    });
  }

  const hasBodyOnIndex =
    $("div.p-novel__body").length > 0 ||
    $("#novel_honbun").length > 0 ||
    $("div.novel_view").length > 0;

  let firstUrl: string;
  let isShortStory = false;
  let totalEpisodes: number | undefined;

  if (firstHref) {
    firstUrl = `https://${canonicalDomain}${firstHref}`;
    // If there is no pagination on the TOC page, count visible episodes
    const hasNextTocPage = $("a.c-pager__item--next, a.c-pager__item--last").length > 0;
    if (!hasNextTocPage && epListLinks.length > 0) {
      totalEpisodes = epListLinks.length;
    }
  } else if (hasBodyOnIndex) {
    // Short story (短編): content lives directly on /<ncode>/
    firstUrl = `https://${canonicalDomain}/${normalizedId}/`;
    isShortStory = true;
    totalEpisodes = 1;
  } else {
    firstUrl = `https://${canonicalDomain}/${normalizedId}/1/`;
  }

  return {
    title: title || "Unknown Title",
    author: author || undefined,
    firstUrl,
    userAgent,
    domain: canonicalDomain,
    totalEpisodes,
    isShortStory,
  };
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Fetches a Syosetu URL while preserving the over18=yes Cookie across
 * cross-subdomain redirects (e.g. ncode.syosetu.com -> novel18.syosetu.com)
 * and unwrapping nl.syosetu.com/redirect/ageauth/?url=... redirects.
 */
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

    // If redirected to Syosetu's age-auth interstitial, unwrap the target URL and re-request with over18=yes
    if (nextUrl.includes("nl.syosetu.com/redirect/ageauth")) {
      const targetParam = new URL(nextUrl).searchParams.get("url");
      if (targetParam && targetParam !== currentUrl) {
        nextUrl = targetParam;
      } else {
        return { response, finalUrl: nextUrl };
      }
    }

    // Only follow redirects within syosetu.com
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

export function parseNarouEpisode(
  html: string,
  url: string,
  finalUrl?: string
): Episode {
  if (isAgeAuthPage(html, finalUrl)) {
    throw new HttpStatusError(
      "Syosetu R18 age verification blocked this episode. Server-side mode sends the over18=yes cookie automatically; public client-side CORS proxies cannot bypass R18 age checks.",
      403
    );
  }

  const $ = cheerio.load(html);

  let title = $("h1.p-novel__title").first().text().trim();
  if (!title) title = $(".p-novel__title").first().text().trim();
  if (!title) title = $(".p-novel__subtitle-episode").first().text().trim();
  if (!title) title = $(".p-novel__subtitle").first().text().trim();
  if (!title) title = $(".novel_subtitle").first().text().trim();
  if (!title) title = $("h1").first().text().trim();
  if (!title) title = "Episode";

  // Extract body content as valid XHTML
  let content = "";

  const pNovelBody = $("div.p-novel__body").first();
  if (pNovelBody.length > 0) {
    const textDivs = pNovelBody.find("div.p-novel__text");
    if (textDivs.length > 0) {
      const sections: string[] = [];
      textDivs.each((_, div) => {
        const sectionHtml = paragraphsToXhtml($, $(div)).trim();
        if (sectionHtml) {
          sections.push(sectionHtml);
        }
      });
      content = sections.join('\n<hr class="section-break" />\n');
    } else {
      content = paragraphsToXhtml($, pNovelBody).trim();
    }
  }

  if (!content) {
    const novelView = $("div.novel_view").first();
    if (novelView.length > 0) {
      content = paragraphsToXhtml($, novelView).trim();
    }
  }

  if (!content) {
    const honbun = $("#novel_honbun").first();
    if (honbun.length > 0) {
      content = paragraphsToXhtml($, honbun).trim();
    }
  }

  if (!content) {
    console.warn(`[WARN] No content found for ${url}`);
    return {
      title,
      content: "",
      nextUrl: null,
    };
  }

  // Next episode link extraction: ONLY follow valid episode paths (/<ncode>/<digits>/)
  let nextUrl: string | null = null;
  let nextHref: string | undefined;

  let origin = "https://ncode.syosetu.com";
  let ncodeFromUrl: string | null = null;
  try {
    const parsedUrl = new URL(url);
    origin = parsedUrl.origin;
    const m = parsedUrl.pathname.match(/^\/(n\d{4}[a-z]{1,2})\//i);
    if (m) ncodeFromUrl = m[1].toLowerCase();
  } catch {
    // Use fallback origin
  }

  const isEpisodeHref = (href: string | undefined): href is string => {
    if (!href) return false;
    const pathPart = href.startsWith("http")
      ? (() => {
          try {
            return new URL(href).pathname;
          } catch {
            return "";
          }
        })()
      : href;
    if (ncodeFromUrl) {
      return new RegExp(`^/${ncodeFromUrl}/\\d+/?$`, "i").test(pathPart);
    }
    return /^\/n\d{4}[a-z]{1,2}\/\d+\/?$/i.test(pathPart);
  };

  // 1. Modern Syosetu pager selector (only actual <a> tags with href, not disabled <span>)
  const nextAnchor = $("a.c-pager__item--next").first();
  if (nextAnchor.length > 0) {
    const candidate = nextAnchor.attr("href");
    if (isEpisodeHref(candidate)) {
      nextHref = candidate;
    }
  }

  // 2. Legacy Syosetu pager selector
  if (!nextHref) {
    $("div.novel_bn a").each((_, el) => {
      if (nextHref) return;
      const text = $(el).text();
      const candidate = $(el).attr("href");
      if (text.includes("次") && isEpisodeHref(candidate)) {
        nextHref = candidate;
      }
    });
  }

  if (nextHref) {
    nextUrl = nextHref.startsWith("http") ? nextHref : `${origin}${nextHref}`;
  }

  return {
    title,
    content,
    nextUrl,
  };
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
