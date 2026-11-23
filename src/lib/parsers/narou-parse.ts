import * as cheerio from "cheerio";
import type { Episode, NovelInfo } from "../../types";
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
  return (
    pageTitle.includes("年齢確認") ||
    html.includes("nl.syosetu.com/redirect/ageauth")
  );
}

function cleanNarouTitle(raw: string): string {
  return raw
    .replace(/\s*-\s*小説家になろう\s*$/, "")
    .replace(
      /\s*\|\|\s*(ノクターンノベルズ|ムーンライトノベルズ|ミッドナイトノベルズ)\s*$/,
      ""
    )
    .trim();
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
      "Syosetu R18 age verification blocked this request.",
      403
    );
  }

  const $ = cheerio.load(html);

  let title = $("h1.p-novel__title").first().text().trim();
  if (!title) title = $(".p-novel__title").first().text().trim();
  if (!title) title = $(".novel_title").first().text().trim();
  if (!title) {
    title = cleanNarouTitle(
      $('meta[property="og:title"]').attr("content") || ""
    );
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

  const epPathRegex = new RegExp(`^/${normalizedId}/(\\d+)/?$`, "i");
  let firstHref: string | undefined;

  const epListLinks = $(
    "a.p-eplist__subtitle, .novel_sublist2 a, dd.subtitle a"
  );
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
    const hasNextTocPage =
      $("a.c-pager__item--next, a.c-pager__item--last").length > 0;
    if (!hasNextTocPage && epListLinks.length > 0) {
      totalEpisodes = epListLinks.length;
    }
  } else if (hasBodyOnIndex) {
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

export function parseNarouEpisode(
  html: string,
  url: string,
  finalUrl?: string
): Episode {
  if (isAgeAuthPage(html, finalUrl)) {
    throw new HttpStatusError(
      "Syosetu R18 age verification blocked this episode.",
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

  const nextAnchor = $("a.c-pager__item--next").first();
  if (nextAnchor.length > 0) {
    const candidate = nextAnchor.attr("href");
    if (isEpisodeHref(candidate)) {
      nextHref = candidate;
    }
  }

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
