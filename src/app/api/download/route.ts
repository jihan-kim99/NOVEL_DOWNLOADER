import { NextResponse } from "next/server";
import { getRandomUserAgent } from "../../../lib/http";
import {
  handleKakuyomuEpisode,
  handleKakuyomuInfo,
  parseKakuyomuEpisode,
  parseKakuyomuInfo,
} from "../../../lib/parsers/kakuyomu";
import {
  canonicalizeNarouDomain,
  handleNarouEpisode,
  handleNarouInfo,
  HttpStatusError,
  parseNarouEpisode,
  parseNarouInfo,
} from "../../../lib/parsers/narou";
import { parseNovelInput } from "../../../lib/url-parser";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    let { type, bookId, platform, domain } = body;
    const { url, html } = body;
    const userAgent = body.userAgent || getRandomUserAgent();

    // If caller sent just { url } without type, treat as an info request
    if (!type && url) {
      const parsed = parseNovelInput(url);
      type = "info";
      bookId = parsed.bookId;
      platform = parsed.platform;
      domain = parsed.domain;
    }

    if (!platform) {
      if (url && url.includes("syosetu.com")) platform = "narou";
      else if (url && url.includes("kakuyomu.jp")) platform = "kakuyomu";
      else if (bookId && /^n\d/i.test(bookId)) platform = "narou";
      else platform = "kakuyomu";
    }

    if (type === "info") {
      if (!bookId) {
        return NextResponse.json(
          { error: "Book ID is required" },
          { status: 400 }
        );
      }
      const data =
        platform === "narou"
          ? await handleNarouInfo(bookId, userAgent, domain, true)
          : await handleKakuyomuInfo(bookId, userAgent);
      return NextResponse.json(data);
    }

    if (type === "episode") {
      if (!url) {
        return NextResponse.json({ error: "URL is required" }, { status: 400 });
      }
      const data =
        platform === "narou" || url.includes("syosetu.com")
          ? await handleNarouEpisode(url, userAgent)
          : await handleKakuyomuEpisode(url, userAgent);
      return NextResponse.json(data);
    }

    if (type === "parse-info") {
      if (!html || !bookId) {
        return NextResponse.json(
          { error: "HTML and Book ID are required" },
          { status: 400 }
        );
      }
      const data =
        platform === "narou"
          ? parseNarouInfo(
              html,
              bookId,
              canonicalizeNarouDomain(domain),
              userAgent
            )
          : parseKakuyomuInfo(html, bookId, userAgent);
      return NextResponse.json(data);
    }

    if (type === "parse-episode") {
      if (!html || !url) {
        return NextResponse.json(
          { error: "HTML and URL are required" },
          { status: 400 }
        );
      }
      const data =
        platform === "narou" || url.includes("syosetu.com")
          ? parseNarouEpisode(html, url)
          : parseKakuyomuEpisode(html, url);
      return NextResponse.json(data);
    }

    return NextResponse.json(
      { error: "Invalid request type" },
      { status: 400 }
    );
  } catch (error: unknown) {
    console.error("Error processing download request:", error);
    const status = error instanceof HttpStatusError ? error.status : 500;
    const message =
      error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status });
  }
}
