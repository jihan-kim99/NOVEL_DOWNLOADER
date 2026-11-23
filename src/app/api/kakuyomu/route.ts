import { NextResponse } from "next/server";
import { getRandomUserAgent } from "../../../lib/http";
import {
  handleKakuyomuEpisode,
  handleKakuyomuInfo,
  parseKakuyomuEpisode,
  parseKakuyomuInfo,
} from "../../../lib/parsers/kakuyomu";
import { HttpStatusError } from "../../../lib/parsers/narou";

function isAllowedKakuyomuUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      (parsed.hostname === "kakuyomu.jp" ||
        parsed.hostname.endsWith(".kakuyomu.jp"))
    );
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { type, bookId, url, html } = body;
    const userAgent = body.userAgent || getRandomUserAgent();

    if (type === "info") {
      if (!bookId) {
        return NextResponse.json(
          { error: "Book ID is required" },
          { status: 400 }
        );
      }
      const data = await handleKakuyomuInfo(bookId, userAgent);
      return NextResponse.json(data);
    }

    if (type === "episode") {
      if (!url || !isAllowedKakuyomuUrl(url)) {
        return NextResponse.json(
          { error: "A valid Kakuyomu URL is required" },
          { status: 400 }
        );
      }
      const data = await handleKakuyomuEpisode(url, userAgent);
      return NextResponse.json(data);
    }

    if (type === "parse-info") {
      if (!html || !bookId) {
        return NextResponse.json(
          { error: "HTML and Book ID are required" },
          { status: 400 }
        );
      }
      const data = parseKakuyomuInfo(html, bookId, userAgent);
      return NextResponse.json(data);
    }

    if (type === "parse-episode") {
      if (!html || !url) {
        return NextResponse.json(
          { error: "HTML and URL are required" },
          { status: 400 }
        );
      }
      const data = parseKakuyomuEpisode(html, url);
      return NextResponse.json(data);
    }

    return NextResponse.json(
      { error: "Invalid request type" },
      { status: 400 }
    );
  } catch (error: unknown) {
    console.error("Error processing Kakuyomu request:", error);
    const status = error instanceof HttpStatusError ? error.status : 500;
    const message =
      error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status });
  }
}
