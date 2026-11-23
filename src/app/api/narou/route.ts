import { NextResponse } from "next/server";
import { getRandomUserAgent } from "../../../lib/http";
import {
  canonicalizeNarouDomain,
  fetchNarouPage,
  handleNarouEpisode,
  handleNarouInfo,
  HttpStatusError,
  parseNarouEpisode,
  parseNarouInfo,
} from "../../../lib/parsers/narou";

function isAllowedSyosetuUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      (parsed.hostname === "syosetu.com" ||
        parsed.hostname.endsWith(".syosetu.com"))
    );
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { type, bookId, url, domain, explicitDomain, html } = body;
    const userAgent = body.userAgent || getRandomUserAgent();

    if (type === "info") {
      if (!bookId) {
        return NextResponse.json(
          { error: "Book ID is required" },
          { status: 400 }
        );
      }
      // Allow falling back between ncode and novel18 if the domain wasn't explicitly specified,
      // or even if explicit domain returned 404 (helpful when users confuse ncode/novel18).
      const data = await handleNarouInfo(
        bookId,
        userAgent,
        domain,
        explicitDomain === false ? true : true
      );
      return NextResponse.json(data);
    }

    if (type === "episode") {
      if (!url || !isAllowedSyosetuUrl(url)) {
        return NextResponse.json(
          { error: "A valid Syosetu URL is required" },
          { status: 400 }
        );
      }
      const data = await handleNarouEpisode(url, userAgent);
      return NextResponse.json(data);
    }

    if (type === "parse-info") {
      if (!html || !bookId) {
        return NextResponse.json(
          { error: "HTML and Book ID are required" },
          { status: 400 }
        );
      }
      const canonicalDomain = canonicalizeNarouDomain(domain);
      const data = parseNarouInfo(html, bookId, canonicalDomain, userAgent);
      return NextResponse.json(data);
    }

    if (type === "parse-episode") {
      if (!html || !url) {
        return NextResponse.json(
          { error: "HTML and URL are required" },
          { status: 400 }
        );
      }
      const data = parseNarouEpisode(html, url);
      return NextResponse.json(data);
    }

    if (type === "fetch") {
      if (!url || !isAllowedSyosetuUrl(url)) {
        return NextResponse.json(
          { error: "A valid Syosetu URL is required" },
          { status: 400 }
        );
      }

      const { response: res, finalUrl } = await fetchNarouPage(
        url,
        userAgent,
        body.novel18Cookie
      );

      if (!res.ok) {
        return NextResponse.json(
          { error: `Fetch failed with ${res.status}` },
          { status: res.status }
        );
      }

      const text = await res.text();
      return NextResponse.json({ html: text, url: finalUrl, userAgent });
    }

    return NextResponse.json(
      { error: "Invalid request type" },
      { status: 400 }
    );
  } catch (error: unknown) {
    console.error("Error processing Narou request:", error);
    const status = error instanceof HttpStatusError ? error.status : 500;
    const message =
      error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status });
  }
}
