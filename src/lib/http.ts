import fs from "fs";
import path from "path";

const DEFAULT_DESKTOP_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

let cachedUserAgents: string[] | null = null;

function loadDesktopUserAgents(): string[] {
  if (cachedUserAgents) return cachedUserAgents;
  try {
    const userAgentPath = path.join(process.cwd(), "public", "useragent.json");
    const raw = JSON.parse(fs.readFileSync(userAgentPath, "utf-8"));
    if (Array.isArray(raw)) {
      const desktopOnly = raw.filter(
        (ua): ua is string =>
          typeof ua === "string" &&
          !/Mobile|Android|iPhone|iPad|Trident|MSIE/i.test(ua)
      );
      if (desktopOnly.length > 0) {
        cachedUserAgents = desktopOnly;
        return cachedUserAgents;
      }
    }
  } catch {
    // Fall back to built-in desktop UAs
  }
  cachedUserAgents = DEFAULT_DESKTOP_USER_AGENTS;
  return cachedUserAgents;
}

export function getRandomUserAgent(): string {
  const list = loadDesktopUserAgents();
  return list[Math.floor(Math.random() * list.length)];
}

export function buildNarouHeaders(
  userAgent: string,
  extraCookie?: string
): Record<string, string> {
  const cookieParts = ["over18=yes"];
  const envCookie = extraCookie || process.env.NOVEL18_COOKIE;
  if (envCookie) {
    cookieParts.push(envCookie);
  }

  const headers: Record<string, string> = {
    "User-Agent": userAgent,
    Cookie: cookieParts.join("; "),
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
    Referer: "https://syosetu.com/",
    "Upgrade-Insecure-Requests": "1",
  };

  if (/Chrome\/\d+/.test(userAgent)) {
    const chromeMatch = userAgent.match(/Chrome\/(\d+)/);
    const major = chromeMatch ? chromeMatch[1] : "131";
    headers["Sec-Ch-Ua"] = `"Not_A Brand";v="8", "Chromium";v="${major}", "Google Chrome";v="${major}"`;
    headers["Sec-Ch-Ua-Mobile"] = "?0";
    headers["Sec-Ch-Ua-Platform"] = userAgent.includes("Macintosh")
      ? '"macOS"'
      : userAgent.includes("Linux")
      ? '"Linux"'
      : '"Windows"';
  }

  return headers;
}

export function buildKakuyomuHeaders(
  userAgent: string
): Record<string, string> {
  return {
    "User-Agent": userAgent,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
    Referer: "https://kakuyomu.jp/",
    "Upgrade-Insecure-Requests": "1",
  };
}

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 2,
  timeoutMs = 20000
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!RETRYABLE_STATUSES.has(response.status) || attempt === maxRetries) {
        return response;
      }

      const retryAfter = response.headers.get("retry-after");
      const delayMs = retryAfter
        ? Math.min(Number(retryAfter) * 1000 || 1500, 10000)
        : 800 * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries) break;
      await new Promise((resolve) =>
        setTimeout(resolve, 600 * Math.pow(2, attempt))
      );
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Network request failed");
}
