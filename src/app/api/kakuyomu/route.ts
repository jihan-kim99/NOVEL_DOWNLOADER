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
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  }
}

async function handleKakuyomuInfo(bookId: string, userAgent: string) {
  const baseUrl = `https://kakuyomu.jp/works/${bookId}`;
  console.log(`[INFO] Fetching Kakuyomu info from: ${baseUrl}`);

  const response = await fetch(baseUrl, {
    headers: { "User-Agent": userAgent },
  });
  if (!response.ok)
    throw new Error(`Failed to fetch novel page: ${response.status}`);

  const html = await response.text();
  const $ = cheerio.load(html);

  const titleSelector =
    "#app > div.DefaultTemplate_fixed__DLjCr.DefaultTemplate_isWeb__QRPlB.DefaultTemplate_fixedGlobalFooter___dZog > div > div > main > div.NewBox_box__45ont.NewBox_padding-px-4l__Kx_xT.NewBox_padding-pt-7l__Czm59 > div > div.Gap_size-2l__HWqrr.Gap_direction-y__Ee6Qv > div.Gap_size-3s__fjxCP.Gap_direction-y__Ee6Qv > h1 > span > a";
  const firstLinkSelector =
    "#app > div.DefaultTemplate_fixed__DLjCr.DefaultTemplate_isWeb__QRPlB.DefaultTemplate_fixedGlobalFooter___dZog > div > div > main > div.NewBox_box__45ont.NewBox_padding-px-4l__Kx_xT.NewBox_padding-pt-7l__Czm59 > div > div.Gap_size-2l__HWqrr.Gap_direction-y__Ee6Qv > div.Gap_size-m__thYv4.Gap_direction-y__Ee6Qv > div > a";

  const title = $(titleSelector).text().trim();
  const firstHref = $(firstLinkSelector).attr("href");

  if (!firstHref) throw new Error("Could not find first episode link");

  return {
    title: title || "Unknown Title",
    firstUrl: `https://kakuyomu.jp${firstHref}`,
    userAgent,
  };
}

async function handleKakuyomuEpisode(url: string, userAgent: string) {
  console.log(`[INFO] Fetching Kakuyomu episode: ${url}`);
  const response = await fetch(url, { headers: { "User-Agent": userAgent } });
  if (!response.ok)
    throw new Error(`Failed to fetch episode: ${response.status}`);

  const html = await response.text();
  const $ = cheerio.load(html);

  const episodeTitleSelector =
    ".widget-episodeTitle.js-vertical-composition-item";
  const nextLinkSelector = "#contentMain-readNextEpisode";

  const title = $(episodeTitleSelector).text().trim() || "Unknown Episode";

  // Content extraction
  let content = "";

  // Try the user suggested selector: #contentMain-inner > div > div > div
  // This seems to be the container for the episode body text in some views
  const userSelector = $("#contentMain-inner > div > div > div");
  if (userSelector.length > 0) {
    const paragraphs = userSelector.find("p");
    if (paragraphs.length > 0) {
      content = paragraphs
        .map((i, el) => `<p>${$(el).text()}</p>`)
        .get()
        .join("");
    } else {
      content = userSelector.html() || "";
    }
  }

  // Fallback to the original selector if empty
  if (!content) {
    const episodeContentSelector = ".widget-episodeBody.js-episode-body";
    const contentContainer = $(episodeContentSelector);
    if (contentContainer.length > 0) {
      const paragraphs = contentContainer.find("p");
      if (paragraphs.length > 0) {
        content = paragraphs
          .map((i, el) => `<p>${$(el).text()}</p>`)
          .get()
          .join("");
      } else {
        content = contentContainer.html() || "";
      }
    }
  }

  if (!content) {
    console.error(`[ERROR] Could not find content for ${url}`);
    // Debug log
    console.log("HTML Preview:", html.substring(0, 500));
  } else {
    console.log(`[DEBUG] Content found, length: ${content.length}`);
  }

  const nextHref = $(nextLinkSelector).attr("href");

  return {
    title,
    content,
    nextUrl: nextHref ? `https://kakuyomu.jp${nextHref}` : null,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    let { type, bookId, url, userAgent } = body;

    if (!userAgent) {
      userAgent = getRandomUserAgent();
    }

    if (type === "info") {
      if (!bookId)
        return NextResponse.json(
          { error: "Book ID is required" },
          { status: 400 }
        );
      const data = await handleKakuyomuInfo(bookId, userAgent);
      return NextResponse.json(data);
    } else if (type === "episode") {
      if (!url)
        return NextResponse.json({ error: "URL is required" }, { status: 400 });
      const data = await handleKakuyomuEpisode(url, userAgent);
      return NextResponse.json(data);
    } else {
      return NextResponse.json(
        { error: "Invalid request type" },
        { status: 400 }
      );
    }
  } catch (error: any) {
    console.error("Error processing Kakuyomu request:", error);
    return NextResponse.json(
      {
        error: error.message || "Internal Server Error",
        details: error.toString(),
      },
      { status: 500 }
    );
  }
}
