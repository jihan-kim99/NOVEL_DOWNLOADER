import { DownloadRequest } from "../types";

export async function fetchWithFallback(
  url: string,
  options: any,
  fallbackType: string,
  fallbackUrl: string,
  setStatus: (status: string) => void
) {
  let useFallback = false;

  if (!useFallback) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) {
        if (res.status === 403 || res.status === 500) {
          throw new Error("Server blocked");
        }
        throw new Error(`Failed with status ${res.status}`);
      }
      return res.json();
    } catch (error) {
      console.warn("Primary fetch failed, trying fallback...", error);
      setStatus("Primary fetch failed, switching to client-side fallback...");
      useFallback = true;
    }
  }

  // Fallback: Fetch via CORS proxy
  let html = "";

  // 1. Try corsproxy.io
  try {
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(fallbackUrl)}`;

    // Extract userAgent from options if available
    const bodyObj = options.body ? JSON.parse(options.body) : {};
    const ua =
      bodyObj.userAgent ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    const proxyRes = await fetch(proxyUrl, {
      headers: {
        "User-Agent": ua,
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
    if (proxyRes.ok) {
      html = await proxyRes.text();
    }
  } catch (e) {
    console.warn("corsproxy.io failed", e);
  }

  // 2. Try allorigins.win if first failed
  if (!html) {
    try {
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(
        fallbackUrl
      )}&timestamp=${Date.now()}`;
      const proxyRes = await fetch(proxyUrl);
      if (proxyRes.ok) {
        const proxyData = await proxyRes.json();
        html = proxyData.contents;
      }
    } catch (e) {
      console.warn("allorigins failed", e);
    }
  }

  if (!html) throw new Error("All proxies failed to fetch content");

  // Send HTML to server for parsing
  // Determine which API to call for parsing based on the original URL or options
  // Since this is a generic fetcher, we might need to know the platform.
  // However, the original code called /api/download. Now we have /api/narou and /api/kakuyomu.
  // We can infer from the URL or pass it in.
  // For now, let's assume the caller passes the correct parsing endpoint in `url` if it was a direct call,
  // but here we are doing a fallback. The fallback needs to call the parsing endpoint.
  // The original code called /api/download with type=parse-info/parse-episode.
  // We should probably pass the parsing endpoint as an argument or derive it.

  // Let's assume the `url` passed to this function was the API endpoint (e.g. /api/narou).
  // So we can reuse it for parsing.
  const parseRes = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...JSON.parse(options.body),
      type: fallbackType,
      html,
    }),
  });

  if (!parseRes.ok) throw new Error("Parse request failed");
  return parseRes.json();
}
