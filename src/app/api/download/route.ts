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

async function handleKakuyomuInfo(bookId: string, userAgent: string) {
  const baseUrl = `https://kakuyomu.jp/works/${bookId}`;
  console.log(`[INFO] Fetching Kakuyomu info from: ${baseUrl}`);

  const response = await fetch(baseUrl, { headers: { "User-Agent": userAgent } });
  if (!response.ok) throw new Error(`Failed to fetch novel page: ${response.status}`);

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

async function handleNarouInfo(bookId: string, userAgent: string) {
  // Narou doesn't always have a clean "info" page that links to the first chapter in a simple way for scraping without listing all chapters.
  // The Python script strategy is to go directly to chapter 1.
  const firstUrl = `https://ncode.syosetu.com/${bookId}/1/`;
  console.log(`[INFO] Fetching Narou info (via ep 1) from: ${firstUrl}`);

  const response = await fetch(firstUrl, { headers: { "User-Agent": userAgent } });
  if (!response.ok) throw new Error(`Failed to fetch first episode: ${response.status}`);

  const html = await response.text();
  const $ = cheerio.load(html);

  let title = $("title").text().trim();
  if (title.includes(" - ")) {
    title = title.split(" - ")[0];
  }

  return {
    title: title || "Unknown Title",
    firstUrl: firstUrl,
    userAgent,
  };
}

async function handleKakuyomuEpisode(url: string, userAgent: string) {
  console.log(`[INFO] Fetching Kakuyomu episode: ${url}`);
  const response = await fetch(url, { headers: { "User-Agent": userAgent } });
  if (!response.ok) throw new Error(`Failed to fetch episode: ${response.status}`);

  const html = await response.text();
  const $ = cheerio.load(html);

  const episodeTitleSelector = ".widget-episodeTitle.js-vertical-composition-item";
  const episodeContentSelector = ".widget-episodeBody.js-episode-body";
  const nextLinkSelector = "#contentMain-readNextEpisode";

  const title = $(episodeTitleSelector).text().trim() || "Unknown Episode";
  const content = $(episodeContentSelector).html() || "";
  const nextHref = $(nextLinkSelector).attr("href");

  return {
    title,
    content,
    nextUrl: nextHref ? `https://kakuyomu.jp${nextHref}` : null,
  };
}

async function handleNarouEpisode(url: string, userAgent: string) {
  console.log(`[INFO] Fetching Narou episode: ${url}`);
  const response = await fetch(url, { headers: { "User-Agent": userAgent } });
  if (!response.ok) throw new Error(`Failed to fetch episode: ${response.status}`);

  const html = await response.text();
  const $ = cheerio.load(html);

  // Selectors from Python script
  let title = $("body > div.l-container > main > article > h1").text().trim();
  if (!title) title = $("h1").text().trim();
  if (!title) title = "Episode";

  let content = $("body > div.l-container > main > article > div.p-novel__body").html();
  if (!content) content = $("div.novel_view").html();
  if (!content) throw new Error("Could not find content");

  // Next link logic
  // Python:
  // Ep 1: body > div.l-container > main > article > div:nth-of-type(1) > a:nth-of-type(2)
  // Ep N: body > div.l-container > main > article > div:nth-of-type(1) > a:nth-of-type(3)
  
  // We can try to find the link that contains "次" (Next) or use the specific selectors.
  // Let's try to be a bit more robust by looking for the "next" navigation link class if possible, 
  // but Narou structure is old.
  // The Python script relies on position.
  
  // Let's try to find the "bn" (before/next) div.
  // Usually <div class="novel_bn"> or similar.
  // But the Python script uses `div:nth-of-type(1)` inside article.
  
  // Let's try to find all links in the top nav and see which one points to next.
  // Usually the structure is [Before] [Table of Contents] [Next]
  
  let nextUrl: string | null = null;
  
  // Try to find a link that looks like a next link
  const links = $("div.novel_bn").first().find("a");
  // If we have 2 links, it's usually [Top] [Next] (for ep 1)
  // If we have 3 links, it's [Prev] [Top] [Next]
  
  // However, the Python script uses `div:nth-of-type(1)` which might be the top nav.
  // Let's stick to the Python script's logic but adapted for Cheerio.
  
  // Note: Cheerio nth-of-type is 1-indexed.
  const topNav = $("body > div.l-container > main > article > div").first();
  const navLinks = topNav.find("a");
  
  let nextHref: string | undefined;
  
  // Check if the last link text contains "次"
  const lastLink = navLinks.last();
  if (lastLink.text().includes("次")) {
      nextHref = lastLink.attr("href");
  } else {
      // Fallback to position
      // If 2 links, 2nd is likely next (if 1st is TOC)
      // If 3 links, 3rd is likely next
      if (navLinks.length >= 2) {
          // Check if it's not "前" (Prev)
          if (!lastLink.text().includes("前")) {
             nextHref = lastLink.attr("href");
          }
      }
  }

  if (nextHref) {
    if (nextHref.startsWith("http")) {
      nextUrl = nextHref;
    } else {
      nextUrl = `https://ncode.syosetu.com${nextHref}`;
    }
  }

  return {
    title,
    content: content || "",
    nextUrl,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    let { type, bookId, url, userAgent, platform } = body;

    // If no user agent provided, pick one
    if (!userAgent) {
      userAgent = getRandomUserAgent();
    }

    // Detect platform if not provided
    if (!platform) {
        if (url && url.includes("syosetu.com")) platform = "narou";
        else if (url && url.includes("kakuyomu.jp")) platform = "kakuyomu";
        else if (bookId && bookId.startsWith("n")) platform = "narou"; // Simple heuristic
        else platform = "kakuyomu"; // Default
    }

    if (type === "info") {
      if (!bookId) return NextResponse.json({ error: "Book ID is required" }, { status: 400 });
      
      if (platform === "narou") {
          const data = await handleNarouInfo(bookId, userAgent);
          return NextResponse.json(data);
      } else {
          const data = await handleKakuyomuInfo(bookId, userAgent);
          return NextResponse.json(data);
      }

    } else if (type === "episode") {
      if (!url) return NextResponse.json({ error: "URL is required" }, { status: 400 });

      if (platform === "narou" || url.includes("syosetu.com")) {
          const data = await handleNarouEpisode(url, userAgent);
          return NextResponse.json(data);
      } else {
          const data = await handleKakuyomuEpisode(url, userAgent);
          return NextResponse.json(data);
      }
    } else {
      return NextResponse.json({ error: "Invalid request type" }, { status: 400 });
    }
  } catch (error: any) {
    console.error("Error processing request:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
