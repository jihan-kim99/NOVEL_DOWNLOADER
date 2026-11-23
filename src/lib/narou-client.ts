import type { NovelInfo } from "../types";
import { extractNarouTocPage } from "./parsers/narou-parse";

export class CloudBlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudBlockError";
  }
}

interface FetchRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

interface BridgeFetchResult {
  ok: boolean;
  status: number;
  finalUrl: string;
  html: string;
  error?: string;
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (data && typeof data.error === "string" && data.error.trim()) {
      return data.error;
    }
  } catch {
    // Ignore JSON parse errors
  }
  return `Request failed with status ${res.status}`;
}

/**
 * Probes whether the Novel Downloader Helper userscript bridge is active in this tab.
 */
export function probeBrowserBridge(timeoutMs = 500): Promise<string | null> {
  if (typeof window === "undefined") return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (version: string | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve(version);
    };

    const onMessage = (event: MessageEvent) => {
      if (
        event.source === window &&
        event.data &&
        event.data.type === "NOVEL_DL_PONG"
      ) {
        finish(String(event.data.version || "1.0.0"));
      }
    };

    const timer = setTimeout(() => finish(null), timeoutMs);
    window.addEventListener("message", onMessage);
    window.postMessage({ type: "NOVEL_DL_PING" }, "*");
  });
}

/**
 * Fetches a target URL directly through the user's browser via the Helper Userscript
 * (GM_xmlhttpRequest with user's residential IP + over18=yes cookie, bypassing CORS & cloud IP blocks).
 */
export function fetchViaBrowserBridge(
  targetUrl: string,
  signal?: AbortSignal
): Promise<BridgeFetchResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Download cancelled", "AbortError"));
      return;
    }

    const id = `ndl_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    let settled = false;

    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new DOMException("Download cancelled", "AbortError"));
    };

    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== window ||
        !event.data ||
        event.data.type !== "NOVEL_DL_FETCH_RES" ||
        event.data.id !== id
      ) {
        return;
      }
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        ok: Boolean(event.data.ok),
        status: Number(event.data.status || 0),
        finalUrl: String(event.data.finalUrl || targetUrl),
        html: String(event.data.html || ""),
        error: event.data.error ? String(event.data.error) : undefined,
      });
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Browser Helper request timed out."));
    }, 30000);

    signal?.addEventListener("abort", onAbort, { once: true });
    window.addEventListener("message", onMessage);
    window.postMessage({ type: "NOVEL_DL_FETCH_REQ", id, url: targetUrl }, "*");
  });
}

async function fetchAndParseViaBridge<T>(
  apiEndpoint: string,
  options: FetchRequestOptions,
  fallbackType: "parse-info" | "parse-episode",
  targetUrl: string
): Promise<T> {
  const originalBody = options.body ? JSON.parse(options.body) : {};
  let res = await fetchViaBrowserBridge(targetUrl, options.signal);

  // Auto-fallback between ncode.syosetu.com and novel18.syosetu.com when info returns 404
  if (
    !res.ok &&
    res.status === 404 &&
    fallbackType === "parse-info" &&
    originalBody.platform === "narou" &&
    originalBody.bookId
  ) {
    const altDomain = targetUrl.includes("novel18.syosetu.com")
      ? "ncode.syosetu.com"
      : "novel18.syosetu.com";
    const altUrl = `https://${altDomain}/${String(
      originalBody.bookId
    ).toLowerCase()}/`;
    const altRes = await fetchViaBrowserBridge(altUrl, options.signal);
    if (altRes.ok) {
      res = altRes;
    }
  }

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(
        `Novel or episode not found (404) at ${res.finalUrl || targetUrl}.`
      );
    }
    throw new Error(
      res.error ||
        `Browser Helper fetch failed with HTTP ${res.status} for ${targetUrl}`
    );
  }

  const parseRes = await fetch(apiEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: options.signal,
    body: JSON.stringify({
      ...originalBody,
      type: fallbackType,
      html: res.html,
      finalUrl: res.finalUrl,
    }),
  });

  if (!parseRes.ok) {
    const parseErr = await readErrorMessage(parseRes);
    throw new Error(parseErr);
  }

  const parsed = (await parseRes.json()) as T;

  // If this is a multi-page Narou TOC fetched via Browser Helper Bridge,
  // fetch the remaining TOC pages concurrently via the bridge for fast downloads.
  if (
    fallbackType === "parse-info" &&
    originalBody.platform === "narou" &&
    originalBody.bookId
  ) {
    const info = parsed as unknown as NovelInfo;
    if (info.tocPages && info.tocPages > 1 && info.episodeUrls && info.domain) {
      const normalizedId = String(originalBody.bookId).toLowerCase();
      const maxPages = Math.min(info.tocPages, 50);
      const pageNums = Array.from({ length: maxPages - 1 }, (_, i) => i + 2);
      const pageResults: string[][] = new Array(pageNums.length);
      let cursor = 0;

      const tocWorker = async () => {
        while (cursor < pageNums.length) {
          const idx = cursor++;
          const pageNum = pageNums[idx];
          const tocUrl = `https://${info.domain}/${normalizedId}/?p=${pageNum}`;
          const tocRes = await fetchViaBrowserBridge(tocUrl, options.signal);
          if (tocRes.ok) {
            const { episodeUrls } = extractNarouTocPage(
              tocRes.html,
              normalizedId,
              info.domain!
            );
            pageResults[idx] = episodeUrls;
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(4, pageNums.length) }, () => tocWorker())
      );

      if (pageResults.every((r) => Array.isArray(r) && r.length > 0)) {
        const merged = [...info.episodeUrls];
        const seen = new Set(merged);
        for (const list of pageResults) {
          for (const u of list) {
            if (!seen.has(u)) {
              seen.add(u);
              merged.push(u);
            }
          }
        }
        info.episodeUrls = merged;
        info.totalEpisodes = merged.length;
      } else {
        info.episodeUrls = undefined;
      }
    }
  }

  return parsed;
}

export async function fetchWithFallback<T>(
  apiEndpoint: string,
  options: FetchRequestOptions,
  fallbackType: "parse-info" | "parse-episode",
  targetUrl: string,
  setStatus: (status: string) => void,
  preferBrowserBridge: boolean = false,
  bridgeAvailable: boolean = false
): Promise<T> {
  // 1. If Browser Helper Bridge is installed and preferred (e.g. Narou/R18 or forced),
  //    fetch directly through user's residential IP + over18=yes cookie!
  if (bridgeAvailable && preferBrowserBridge) {
    return fetchAndParseViaBridge<T>(
      apiEndpoint,
      options,
      fallbackType,
      targetUrl
    );
  }

  // 2. Try server-side fetch (works locally, on Kakuyomu, or with SYOSETU_PROXY_URL)
  const res = await fetch(apiEndpoint, options);
  if (res.ok) {
    return (await res.json()) as T;
  }

  const errorMessage = await readErrorMessage(res);

  // If server got blocked (403 / 5xx) and Browser Helper Bridge is available, switch to it seamlessly!
  if ((res.status === 403 || res.status >= 500) && bridgeAvailable) {
    setStatus("Server blocked by website, switching to Browser Helper...");
    return fetchAndParseViaBridge<T>(
      apiEndpoint,
      options,
      fallbackType,
      targetUrl
    );
  }

  // If server got 403 without Browser Helper, surface a clear actionable CloudBlockError
  if (res.status === 403) {
    throw new CloudBlockError(
      "Syosetu blocked this server's cloud IP (403 Forbidden). Install the 1-click Browser Helper Userscript or use the Bookmarklet below so downloads run from your own browser IP & cookies."
    );
  }

  throw new Error(errorMessage);
}
