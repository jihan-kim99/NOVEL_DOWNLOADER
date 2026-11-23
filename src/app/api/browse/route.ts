import { NextRequest, NextResponse } from "next/server";
import {
  buildKakuyomuHeaders,
  fetchWithRetry,
  getRandomUserAgent,
} from "../../../lib/http";
import {
  buildKakuyomuBrowseUrl,
  buildSyosetuBrowseUrl,
  parseKakuyomuBrowseHtml,
  parseSyosetuBrowseResponse,
} from "../../../lib/parsers/browse-parse";
import { isValidBrowseSite } from "../../../lib/sites";
import type {
  BrowseQueryParams,
  BrowseSiteId,
  BrowseSort,
  BrowseStatusFilter,
} from "../../../types";

function parseParams(input: Record<string, string | number | undefined>): BrowseQueryParams {
  const rawSite = String(input.site || "narou").toLowerCase();
  const site: BrowseSiteId = isValidBrowseSite(rawSite) ? rawSite : "narou";
  const query = typeof input.query === "string" ? input.query : "";
  const sort = (typeof input.sort === "string" ? input.sort : "daily") as BrowseSort;
  const status = (typeof input.status === "string" ? input.status : "all") as BrowseStatusFilter;
  const pageNum = Number(input.page || 1);
  const page = Number.isFinite(pageNum) && pageNum >= 1 ? Math.floor(pageNum) : 1;

  return { site, query, sort, status, page };
}

async function handleBrowse(params: BrowseQueryParams) {
  const userAgent = getRandomUserAgent();

  if (params.site === "kakuyomu") {
    const url = buildKakuyomuBrowseUrl(params);
    const res = await fetchWithRetry(url, {
      headers: buildKakuyomuHeaders(userAgent),
      redirect: "follow",
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to fetch Kakuyomu catalog (HTTP ${res.status})` },
        { status: res.status }
      );
    }

    const html = await res.text();
    const result = parseKakuyomuBrowseHtml(html, params);
    return NextResponse.json(result);
  }

  const url = buildSyosetuBrowseUrl(params);
  const res = await fetchWithRetry(url, {
    headers: {
      "User-Agent": userAgent,
      Accept: "application/json,text/plain,*/*",
      "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
    },
    redirect: "follow",
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: `Failed to fetch Syosetu catalog (HTTP ${res.status})` },
      { status: res.status }
    );
  }

  const json = await res.json();
  const result = parseSyosetuBrowseResponse(json, params);
  return NextResponse.json(result);
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const params = parseParams({
      site: sp.get("site") || undefined,
      query: sp.get("query") || sp.get("q") || undefined,
      sort: sp.get("sort") || undefined,
      status: sp.get("status") || undefined,
      page: sp.get("page") || undefined,
    });
    return await handleBrowse(params);
  } catch (error: unknown) {
    console.error("Browse API GET Error:", error);
    const message = error instanceof Error ? error.message : "Failed to load catalog";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, string | number | undefined>;
    const params = parseParams(body);
    return await handleBrowse(params);
  } catch (error: unknown) {
    console.error("Browse API POST Error:", error);
    const message = error instanceof Error ? error.message : "Failed to load catalog";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
