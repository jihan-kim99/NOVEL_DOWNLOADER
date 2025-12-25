import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";

// Helper to get a random user agent
function getRandomUserAgent() {
  try {
    const userAgentPath = path.join(process.cwd(), "public", "useragent.json");
    const userAgents = JSON.parse(fs.readFileSync(userAgentPath, "utf-8"));
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  } catch (error) {
    console.error("Error reading useragent.json:", error);
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    let { type, bookId, url, userAgent } = body;

    // If no user agent provided, pick one
    if (!userAgent) {
      userAgent = getRandomUserAgent();
    }

    const headers = {
      "User-Agent": userAgent,
    };

    if (type === "info") {
      if (!bookId) {
        return NextResponse.json(
          { error: "Book ID is required" },
          { status: 400 }
        );
      }

      const baseUrl = `https://kakuyomu.jp/works/${bookId}`;
      console.log(
        `[INFO] Fetching novel info from: ${baseUrl} with UA: ${userAgent}`
      );

      const response = await fetch(baseUrl, { headers });
      if (!response.ok) {
        return NextResponse.json(
          { error: "Failed to fetch novel page" },
          { status: response.status }
        );
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Selectors from the Python script
      const titleSelector =
        "#app > div.DefaultTemplate_fixed__DLjCr.DefaultTemplate_isWeb__QRPlB.DefaultTemplate_fixedGlobalFooter___dZog > div > div > main > div.NewBox_box__45ont.NewBox_padding-px-4l__Kx_xT.NewBox_padding-pt-7l__Czm59 > div > div.Gap_size-2l__HWqrr.Gap_direction-y__Ee6Qv > div.Gap_size-3s__fjxCP.Gap_direction-y__Ee6Qv > h1 > span > a";
      const firstLinkSelector =
        "#app > div.DefaultTemplate_fixed__DLjCr.DefaultTemplate_isWeb__QRPlB.DefaultTemplate_fixedGlobalFooter___dZog > div > div > main > div.NewBox_box__45ont.NewBox_padding-px-4l__Kx_xT.NewBox_padding-pt-7l__Czm59 > div > div.Gap_size-2l__HWqrr.Gap_direction-y__Ee6Qv > div.Gap_size-m__thYv4.Gap_direction-y__Ee6Qv > div > a";

      const titleElement = $(titleSelector);
      const title = titleElement.text().trim();

      const firstLinkElement = $(firstLinkSelector);
      const firstHref = firstLinkElement.attr("href");

      if (!title) {
        console.error("[ERROR] Could not find title");
        // Fallback or error?
      }

      if (!firstHref) {
        console.error("[ERROR] Could not find first episode link");
        return NextResponse.json(
          { error: "Could not find first episode link" },
          { status: 404 }
        );
      }

      const firstUrl = `https://kakuyomu.jp${firstHref}`;

      return NextResponse.json({ title, firstUrl, userAgent });
    } else if (type === "episode") {
      if (!url) {
        return NextResponse.json({ error: "URL is required" }, { status: 400 });
      }

      console.log(`[INFO] Fetching episode from: ${url} with UA: ${userAgent}`);

      const response = await fetch(url, { headers });
      if (!response.ok) {
        return NextResponse.json(
          { error: "Failed to fetch episode page" },
          { status: response.status }
        );
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      const episodeTitleSelector =
        ".widget-episodeTitle.js-vertical-composition-item";
      const episodeContentSelector = ".widget-episodeBody.js-episode-body";
      const nextLinkSelector = "#contentMain-readNextEpisode";

      const episodeTitle =
        $(episodeTitleSelector).text().trim() || "Unknown Episode";
      const episodeContent = $(episodeContentSelector).html() || "";
      const nextHref = $(nextLinkSelector).attr("href");
      const nextUrl = nextHref ? `https://kakuyomu.jp${nextHref}` : null;

      return NextResponse.json({
        title: episodeTitle,
        content: episodeContent,
        nextUrl: nextUrl,
      });
    } else {
      return NextResponse.json(
        { error: "Invalid request type" },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("Error processing request:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
