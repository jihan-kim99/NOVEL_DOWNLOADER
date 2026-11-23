import * as cheerio from "cheerio";
import type { Episode, NovelInfo } from "../../types";
import { paragraphsToXhtml } from "../xhtml";
import { HttpStatusError } from "./narou-parse";

interface ApolloRef {
  __ref?: string;
}

interface ApolloWork {
  title?: string;
  publicEpisodeCount?: number;
  author?: ApolloRef;
  firstPublicEpisodeUnion?: ApolloRef;
  tableOfContentsV2?: ApolloRef[];
  tableOfContents?: ApolloRef[];
}

interface ApolloChapter {
  episodeUnions?: ApolloRef[];
}

interface ApolloUser {
  activityName?: string;
  name?: string;
}

function extractRefId(ref?: string): string | null {
  if (!ref || typeof ref !== "string") return null;
  const parts = ref.split(":");
  return parts.length >= 2 && parts[1] ? parts[1] : null;
}

function cleanKakuyomuTitle(raw: string): string {
  return raw.replace(/\s*-\s*カクヨム\s*$/, "").trim();
}

export function parseKakuyomuInfo(
  html: string,
  bookId: string,
  userAgent: string
): NovelInfo {
  const $ = cheerio.load(html);

  let title = "";
  let author: string | undefined;
  let firstEpisodeId: string | null = null;
  let totalEpisodes: number | undefined;

  const nextDataText = $("#__NEXT_DATA__").html();
  if (nextDataText) {
    try {
      const nextData = JSON.parse(nextDataText);
      const apollo = nextData?.props?.pageProps?.__APOLLO_STATE__ as
        | Record<string, unknown>
        | undefined;

      if (apollo && typeof apollo === "object") {
        const workKey =
          `Work:${bookId}` in apollo
            ? `Work:${bookId}`
            : Object.keys(apollo).find((k) => k.startsWith("Work:"));

        const work = workKey
          ? (apollo[workKey] as ApolloWork | undefined)
          : undefined;

        if (work) {
          if (typeof work.title === "string" && work.title.trim()) {
            title = work.title.trim();
          }

          if (
            typeof work.publicEpisodeCount === "number" &&
            work.publicEpisodeCount > 0
          ) {
            totalEpisodes = work.publicEpisodeCount;
          }

          const authorRef = work.author?.__ref;
          if (authorRef && apollo[authorRef]) {
            const user = apollo[authorRef] as ApolloUser;
            author =
              (user.activityName || user.name || "").trim() || undefined;
          }

          firstEpisodeId = extractRefId(work.firstPublicEpisodeUnion?.__ref);

          if (!firstEpisodeId) {
            const tocRefs =
              work.tableOfContentsV2 || work.tableOfContents || [];
            for (const chapterRef of tocRefs) {
              if (!chapterRef?.__ref) continue;
              const chapter = apollo[chapterRef.__ref] as
                | ApolloChapter
                | undefined;
              const firstEpRef = chapter?.episodeUnions?.[0]?.__ref;
              const id = extractRefId(firstEpRef);
              if (id) {
                firstEpisodeId = id;
                break;
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn("[WARN] Failed to parse Kakuyomu __NEXT_DATA__:", err);
    }
  }

  if (!title) {
    title =
      $(`h1 a[href="/works/${bookId}"]`).first().text().trim() ||
      $("h1").first().text().trim() ||
      cleanKakuyomuTitle(
        $('meta[property="og:title"]').attr("content") || ""
      ) ||
      cleanKakuyomuTitle($("title").text());
  }

  let firstHref = firstEpisodeId
    ? `/works/${bookId}/episodes/${firstEpisodeId}`
    : undefined;

  if (!firstHref) {
    const epRegex = new RegExp(`^/works/${bookId}/episodes/\\d+$`);
    $(`a[href^="/works/${bookId}/episodes/"]`).each((_, el) => {
      if (firstHref) return;
      const href = $(el).attr("href");
      if (href && epRegex.test(href)) {
        firstHref = href;
      }
    });
  }

  if (!firstHref) {
    throw new HttpStatusError(
      "Could not find the first episode link for this Kakuyomu work.",
      404
    );
  }

  return {
    title: title || "Unknown Title",
    author,
    firstUrl: `https://kakuyomu.jp${firstHref}`,
    userAgent,
    domain: "kakuyomu.jp",
    totalEpisodes,
  };
}

export function parseKakuyomuEpisode(html: string, url: string): Episode {
  const $ = cheerio.load(html);

  const title =
    $(".widget-episodeTitle").first().text().trim() ||
    $("h1").first().text().trim() ||
    cleanKakuyomuTitle($("title").text()) ||
    "Unknown Episode";

  let content = "";
  const candidates = [
    ".widget-episodeBody.js-episode-body",
    ".widget-episodeBody",
    "#contentMain-inner .js-episode-body",
    "#contentMain-inner > div > div > div",
  ];

  for (const selector of candidates) {
    const container = $(selector).first();
    if (container.length > 0) {
      const xhtml = paragraphsToXhtml($, container).trim();
      if (xhtml) {
        content = xhtml;
        break;
      }
    }
  }

  if (!content) {
    console.warn(`[WARN] Could not find Kakuyomu content for ${url}`);
  }

  const nextHref =
    $("#contentMain-readNextEpisode").first().attr("href") ||
    $("a.js-read-next-episode").first().attr("href");

  let nextUrl: string | null = null;
  if (nextHref) {
    nextUrl = nextHref.startsWith("http")
      ? nextHref
      : `https://kakuyomu.jp${nextHref}`;
  }

  return {
    title,
    content,
    nextUrl,
  };
}
