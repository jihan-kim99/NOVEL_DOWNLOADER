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

function parseNarouInfo(html: string, firstUrl: string, userAgent: string) {
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

async function handleNarouInfo(
  bookId: string,
  userAgent: string,
  domain: string = "ncode.syosetu.com"
) {
  // Narou doesn't always have a clean "info" page that links to the first chapter in a simple way for scraping without listing all chapters.
  // The Python script strategy is to go directly to chapter 1.
  const firstUrl = `https://${domain}/${bookId}/1/`;
  console.log(`[INFO] Fetching Narou info (via ep 1) from: ${firstUrl}`);

  const response = await fetch(firstUrl, {
    headers: {
      "User-Agent": userAgent,
      Cookie: "over18=yes",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "Accept-Language": "en-US,en;q=0.9,ja;q=0.8",
      Referer: "https://syosetu.com/",
      "Sec-Ch-Ua":
        '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "cross-site",
      "Upgrade-Insecure-Requests": "1",
    },
  });

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(
        "Access Forbidden (403). The server IP is likely blocked by Syosetu. This is common with cloud hosting like Vercel."
      );
    }
    throw new Error(`Failed to fetch Narou info: ${response.status}`);
  }

  const html = await response.text();
  return parseNarouInfo(html, firstUrl, userAgent);
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

function parseNarouEpisode(html: string, url: string) {
  const $ = cheerio.load(html);

  // Improved selectors for Narou (2024/2025 layout)
  let title = $("h1.p-novel__title").text().trim();
  if (!title) title = $("h1").text().trim();
  if (!title) title = "Episode";

  // Content selectors: try new layout first, then old
  let content = "";

  const pNovelBody = $("div.p-novel__body");
  if (pNovelBody.length > 0) {
    // The new layout usually has inner divs with class "p-novel__text" (preface, body, afterword)
    const textDivs = pNovelBody.find("div.p-novel__text");

    if (textDivs.length > 0) {
      // Iterate through each text block (preface, main, afterword)
      textDivs.each((_, div) => {
        $(div)
          .find("p")
          .each((_, p) => {
            // Use xmlMode to ensure self-closing tags like <br /> for EPUB compatibility
            content += $.html(p, { xmlMode: true });
          });
      });
    } else {
      // Fallback: just get all p tags inside body if no text divs found
      pNovelBody.find("p").each((_, p) => {
        content += $.html(p, { xmlMode: true });
      });
    }

    // If still no content found via p tags (unlikely), try raw html
    if (!content) {
      content = $.html(pNovelBody.contents(), { xmlMode: true }) || "";
    }
  }

  if (!content)
    content = $.html($("div.novel_view").contents(), { xmlMode: true }) || "";
  if (!content)
    content = $.html($("#novel_honbun").contents(), { xmlMode: true }) || "";

  if (!content) {
    console.warn(`[WARN] No content found for ${url}`);
    // Return empty content instead of throwing to allow graceful exit
    return {
      title: title || "Unknown",
      content: "",
      nextUrl: null,
    };
  }

  // Next link logic
  let nextUrl: string | null = null;
  let nextHref: string | undefined;

  // 1. Try modern class-based selector
  const nextLink = $("a.c-pager__item--next");
  if (nextLink.length > 0) {
    nextHref = nextLink.attr("href");
  }

  // 2. Fallback to old "novel_bn" structure
  if (!nextHref) {
    const bnLinks = $("div.novel_bn").first().find("a");
    if (bnLinks.length > 0) {
      const lastBn = bnLinks.last();
      if (lastBn.text().includes("次")) {
        nextHref = lastBn.attr("href");
      }
    }
  }

  // 3. Fallback to positional logic (from original code)
  if (!nextHref) {
    const topNav = $("body > div.l-container > main > article > div").first();
    const navLinks = topNav.find("a");
    const lastLink = navLinks.last();
    if (lastLink.text().includes("次")) {
      nextHref = lastLink.attr("href");
    } else if (navLinks.length >= 2 && !lastLink.text().includes("前")) {
      nextHref = lastLink.attr("href");
    }
  }

  if (nextHref) {
    if (nextHref.startsWith("http")) {
      nextUrl = nextHref;
    } else {
      // Construct absolute URL based on the current URL's origin
      try {
        const currentUrlObj = new URL(url);
        nextUrl = `${currentUrlObj.origin}${nextHref}`;
      } catch (e) {
        // Fallback to ncode if URL parsing fails (shouldn't happen if url is valid)
        nextUrl = `https://ncode.syosetu.com${nextHref}`;
      }
    }
  }

  return {
    title,
    content: content || "",
    nextUrl,
  };
}

async function handleNarouEpisode(url: string, userAgent: string) {
  console.log(`[INFO] Fetching Narou episode: ${url}`);

  const response = await fetch(url, {
    headers: {
      "User-Agent": userAgent,
      Cookie: "over18=yes",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "Accept-Language": "en-US,en;q=0.9,ja;q=0.8",
      Referer: "https://syosetu.com/",
      "Sec-Ch-Ua":
        '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "cross-site",
      "Upgrade-Insecure-Requests": "1",
    },
  });

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(
        "Access Forbidden (403). The server IP is likely blocked by Syosetu. This is common with cloud hosting like Vercel."
      );
    }
    throw new Error(`Failed to fetch Narou episode: ${response.status}`);
  }

  const html = await response.text();
  return parseNarouEpisode(html, url);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    let { type, bookId, url, userAgent, platform, domain, html } = body;

    // If no user agent provided, pick one
    if (!userAgent) {
      userAgent = getRandomUserAgent();
    }

    // Detect platform if not provided
    if (!platform) {
      if (url && url.includes("syosetu.com")) platform = "narou";
      else if (url && url.includes("kakuyomu.jp")) platform = "kakuyomu";
      else if (bookId && bookId.startsWith("n"))
        platform = "narou"; // Simple heuristic
      else platform = "kakuyomu"; // Default
    }

    if (type === "info") {
      if (!bookId)
        return NextResponse.json(
          { error: "Book ID is required" },
          { status: 400 }
        );

      if (platform === "narou") {
        const data = await handleNarouInfo(bookId, userAgent, domain);
        return NextResponse.json(data);
      } else {
        const data = await handleKakuyomuInfo(bookId, userAgent);
        return NextResponse.json(data);
      }
    } else if (type === "episode") {
      if (!url)
        return NextResponse.json({ error: "URL is required" }, { status: 400 });

      if (platform === "narou" || url.includes("syosetu.com")) {
        const data = await handleNarouEpisode(url, userAgent);
        return NextResponse.json(data);
      } else {
        const data = await handleKakuyomuEpisode(url, userAgent);
        return NextResponse.json(data);
      }
    } else if (type === "parse-info") {
      if (!html)
        return NextResponse.json(
          { error: "HTML is required" },
          { status: 400 }
        );
      if (platform === "narou") {
        // For parse-info, we need to reconstruct the firstUrl
        const firstUrl = `https://${
          domain || "ncode.syosetu.com"
        }/${bookId}/1/`;
        const data = parseNarouInfo(html, firstUrl, userAgent);
        return NextResponse.json(data);
      } else {
        return NextResponse.json(
          { error: "Parse info not supported for this platform" },
          { status: 400 }
        );
      }
    } else if (type === "parse-episode") {
      if (!html || !url)
        return NextResponse.json(
          { error: "HTML and URL are required" },
          { status: 400 }
        );
      if (platform === "narou") {
        const data = parseNarouEpisode(html, url);
        return NextResponse.json(data);
      } else {
        return NextResponse.json(
          { error: "Parse episode not supported for this platform" },
          { status: 400 }
        );
      }
    } else {
      return NextResponse.json(
        { error: "Invalid request type" },
        { status: 400 }
      );
    }
  } catch (error: any) {
    console.error("Error processing request:", error);
    return NextResponse.json(
      {
        error: error.message || "Internal Server Error",
        details: error.toString(),
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
