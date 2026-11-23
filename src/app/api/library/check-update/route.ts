import { NextResponse } from "next/server";
import { getRandomUserAgent } from "../../../../lib/http";
import { handleKakuyomuInfo } from "../../../../lib/parsers/kakuyomu";
import {
  checkNarouUpdate,
  HttpStatusError,
} from "../../../../lib/parsers/narou";
import type { NovelUpdateCheckResult, Platform } from "../../../../types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      platform?: Platform;
      bookId?: string;
      domain?: string;
    };

    const platform = body.platform;
    const bookId = typeof body.bookId === "string" ? body.bookId.trim() : "";
    const domain = typeof body.domain === "string" ? body.domain.trim() : undefined;

    if (!bookId || (platform !== "narou" && platform !== "kakuyomu")) {
      return NextResponse.json(
        { error: "Valid platform and bookId are required." },
        { status: 400 }
      );
    }

    const userAgent = getRandomUserAgent();

    if (platform === "narou") {
      const result: NovelUpdateCheckResult = await checkNarouUpdate(
        bookId,
        userAgent,
        domain
      );
      return NextResponse.json(result);
    }

    const info = await handleKakuyomuInfo(bookId, userAgent);
    const totalEpisodes = info.totalEpisodes || info.episodeUrls?.length || 0;

    const result: NovelUpdateCheckResult = {
      title: info.title,
      author: info.author,
      domain: "kakuyomu.jp",
      totalEpisodes,
      status: info.status || "unknown",
      remoteUpdatedAt: info.remoteUpdatedAt,
    };
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("Error checking novel update:", error);
    const status = error instanceof HttpStatusError ? error.status : 500;
    const message =
      error instanceof Error ? error.message : "Failed to check novel update";
    return NextResponse.json({ error: message }, { status });
  }
}
