import {
  Capacitor,
  CapacitorCookies,
  CapacitorHttp,
  type HttpResponse,
} from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import type {
  BrowseQueryParams,
  BrowseResponse,
  Episode,
  NovelInfo,
  NovelUpdateCheckResult,
  Platform,
} from "../types";
import {
  buildKakuyomuBrowseUrl,
  buildSyosetuBrowseUrl,
  parseKakuyomuBrowseHtml,
  parseSyosetuBrowseResponse,
} from "./parsers/browse-parse";
import {
  parseKakuyomuEpisode,
  parseKakuyomuInfo,
} from "./parsers/kakuyomu-parse";
import {
  canonicalizeNarouDomain,
  extractNarouTocPage,
  HttpStatusError,
  parseNarouEpisode,
  parseNarouInfo,
  parseSyosetuApiMeta,
} from "./parsers/narou-parse";

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

let syosetuCookiesSeeded = false;

export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function getHeaderCaseInsensitive(
  headers: Record<string, string> | undefined,
  name: string
): string | undefined {
  if (!headers) return undefined;
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target) return v;
  }
  return undefined;
}

async function ensureSyosetuCookies(): Promise<void> {
  if (syosetuCookiesSeeded) return;
  try {
    for (const url of [
      "https://syosetu.com",
      "https://ncode.syosetu.com",
      "https://novel18.syosetu.com",
    ]) {
      await CapacitorCookies.setCookie({
        url,
        key: "over18",
        value: "yes",
      });
    }
    syosetuCookiesSeeded = true;
  } catch {
    // Fallback to explicit Cookie header on each request
  }
}

async function nativeRequestWithRetry(
  url: string,
  headers: Record<string, string>,
  disableRedirects: boolean,
  signal?: AbortSignal,
  maxRetries = 2
): Promise<HttpResponse> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) {
      throw new DOMException("Download cancelled", "AbortError");
    }
    try {
      const res = await CapacitorHttp.request({
        method: "GET",
        url,
        headers,
        disableRedirects,
        responseType: "text",
        connectTimeout: 20000,
        readTimeout: 25000,
      });

      if (!RETRYABLE_STATUSES.has(res.status) || attempt === maxRetries) {
        return res;
      }

      const delay = 800 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetries) break;
      await new Promise((r) => setTimeout(r, 600 * Math.pow(2, attempt)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Native network error");
}

function responseDataToString(data: unknown): string {
  if (typeof data === "string") return data;
  if (data === null || data === undefined) return "";
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

async function nativeFetchNarouPage(
  initialUrl: string,
  signal?: AbortSignal,
  maxRedirects = 5
): Promise<{ status: number; html: string; finalUrl: string }> {
  await ensureSyosetuCookies();
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await nativeRequestWithRetry(
      currentUrl,
      {
        "User-Agent": DESKTOP_UA,
        Cookie: "over18=yes",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
        Referer: "https://syosetu.com/",
      },
      true,
      signal
    );

    if (!REDIRECT_STATUSES.has(res.status)) {
      return {
        status: res.status,
        html: responseDataToString(res.data),
        finalUrl: currentUrl,
      };
    }

    const location = getHeaderCaseInsensitive(res.headers, "location");
    if (!location) {
      return {
        status: res.status,
        html: responseDataToString(res.data),
        finalUrl: currentUrl,
      };
    }

    let nextUrl = new URL(location, currentUrl).toString();
    if (nextUrl.includes("nl.syosetu.com/redirect/ageauth")) {
      const targetParam = new URL(nextUrl).searchParams.get("url");
      if (targetParam && targetParam !== currentUrl) {
        nextUrl = targetParam;
      }
    }

    const nextHost = new URL(nextUrl).hostname.toLowerCase();
    if (nextHost !== "syosetu.com" && !nextHost.endsWith(".syosetu.com")) {
      return {
        status: res.status,
        html: responseDataToString(res.data),
        finalUrl: nextUrl,
      };
    }

    currentUrl = nextUrl;
  }

  throw new HttpStatusError("Too many redirects from Syosetu.", 502);
}

async function nativeFetchNarouApiMeta(
  bookId: string,
  domain: string,
  signal?: AbortSignal
): Promise<NovelUpdateCheckResult | null> {
  const endpoint =
    domain === "novel18.syosetu.com"
      ? `https://api.syosetu.com/novel18api/api/?out=json&ncode=${encodeURIComponent(bookId)}`
      : `https://api.syosetu.com/novelapi/api/?out=json&ncode=${encodeURIComponent(bookId)}`;

  try {
    const res = await nativeRequestWithRetry(
      endpoint,
      { "User-Agent": DESKTOP_UA },
      false,
      signal,
      0
    );
    if (res.status < 200 || res.status >= 300) return null;
    const raw =
      typeof res.data === "string" ? JSON.parse(res.data) : res.data;
    return parseSyosetuApiMeta(raw, domain);
  } catch {
    // Best-effort metadata only
  }
  return null;
}

export async function nativeFetchNarouInfo(
  bookId: string,
  domain: string = "ncode.syosetu.com",
  signal?: AbortSignal
): Promise<NovelInfo> {
  const normalizedId = bookId.toLowerCase();
  const primaryDomain = canonicalizeNarouDomain(domain);
  const domainsToTry = [
    primaryDomain,
    primaryDomain === "ncode.syosetu.com"
      ? "novel18.syosetu.com"
      : "ncode.syosetu.com",
  ];

  let lastStatus = 404;

  for (const currentDomain of domainsToTry) {
    const infoUrl = `https://${currentDomain}/${normalizedId}/`;
    const { status, html, finalUrl } = await nativeFetchNarouPage(
      infoUrl,
      signal
    );

    if (status === 404) {
      lastStatus = 404;
      continue;
    }

    if (status < 200 || status >= 300) {
      throw new HttpStatusError(
        `Failed to fetch Narou info (HTTP ${status})`,
        status
      );
    }

    let resolvedDomain = currentDomain;
    try {
      resolvedDomain = canonicalizeNarouDomain(new URL(finalUrl).hostname);
    } catch {
      // Keep currentDomain
    }

    const parsed = parseNarouInfo(
      html,
      normalizedId,
      resolvedDomain,
      DESKTOP_UA,
      finalUrl
    );

    if (parsed.tocPages && parsed.tocPages > 1 && parsed.episodeUrls) {
      const maxPages = Math.min(parsed.tocPages, 50);
      const pageNums = Array.from({ length: maxPages - 1 }, (_, i) => i + 2);
      const pageResults: string[][] = new Array(pageNums.length);
      let cursor = 0;

      const tocWorker = async () => {
        while (cursor < pageNums.length) {
          const idx = cursor++;
          const pageNum = pageNums[idx];
          try {
            const tocUrl = `https://${resolvedDomain}/${normalizedId}/?p=${pageNum}`;
            const tocRes = await nativeFetchNarouPage(tocUrl, signal);
            if (tocRes.status >= 200 && tocRes.status < 300) {
              const { episodeUrls } = extractNarouTocPage(
                tocRes.html,
                normalizedId,
                resolvedDomain
              );
              pageResults[idx] = episodeUrls;
            }
          } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") {
              throw err;
            }
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(4, pageNums.length) }, () => tocWorker())
      );

      if (pageResults.every((r) => Array.isArray(r) && r.length > 0)) {
        const merged = [...parsed.episodeUrls];
        const seen = new Set(merged);
        for (const list of pageResults) {
          for (const u of list) {
            if (!seen.has(u)) {
              seen.add(u);
              merged.push(u);
            }
          }
        }
        parsed.episodeUrls = merged;
        parsed.totalEpisodes = merged.length;
      } else {
        parsed.episodeUrls = undefined;
      }
    }

    if (
      !parsed.totalEpisodes ||
      !parsed.author ||
      !parsed.status ||
      !parsed.remoteUpdatedAt
    ) {
      const meta = await nativeFetchNarouApiMeta(
        normalizedId,
        resolvedDomain,
        signal
      );
      if (meta) {
        if (!parsed.totalEpisodes && meta.totalEpisodes) {
          parsed.totalEpisodes = meta.totalEpisodes;
        }
        if (!parsed.author && meta.author) {
          parsed.author = meta.author;
        }
        if (!parsed.status && meta.status) {
          parsed.status = meta.status;
        }
        if (!parsed.remoteUpdatedAt && meta.remoteUpdatedAt) {
          parsed.remoteUpdatedAt = meta.remoteUpdatedAt;
        }
      }
    }

    return parsed;
  }

  throw new HttpStatusError(
    `Novel "${normalizedId}" was not found on Syosetu (ncode / novel18).`,
    lastStatus
  );
}

export async function nativeFetchNarouEpisode(
  url: string,
  signal?: AbortSignal
): Promise<Episode> {
  const { status, html, finalUrl } = await nativeFetchNarouPage(url, signal);
  if (status < 200 || status >= 300) {
    throw new HttpStatusError(
      `Failed to fetch Narou episode (HTTP ${status})`,
      status
    );
  }
  return parseNarouEpisode(html, finalUrl, finalUrl);
}

export async function nativeFetchKakuyomuInfo(
  bookId: string,
  signal?: AbortSignal
): Promise<NovelInfo> {
  const res = await nativeRequestWithRetry(
    `https://kakuyomu.jp/works/${bookId}`,
    {
      "User-Agent": DESKTOP_UA,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
      Referer: "https://kakuyomu.jp/",
    },
    false,
    signal
  );

  if (res.status === 404) {
    throw new HttpStatusError(`Kakuyomu work "${bookId}" not found (404).`, 404);
  }
  if (res.status < 200 || res.status >= 300) {
    throw new HttpStatusError(
      `Failed to fetch Kakuyomu work (HTTP ${res.status})`,
      res.status
    );
  }

  return parseKakuyomuInfo(responseDataToString(res.data), bookId, DESKTOP_UA);
}

export async function nativeFetchKakuyomuEpisode(
  url: string,
  signal?: AbortSignal
): Promise<Episode> {
  const res = await nativeRequestWithRetry(
    url,
    {
      "User-Agent": DESKTOP_UA,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
      Referer: "https://kakuyomu.jp/",
    },
    false,
    signal
  );

  if (res.status < 200 || res.status >= 300) {
    throw new HttpStatusError(
      `Failed to fetch Kakuyomu episode (HTTP ${res.status})`,
      res.status
    );
  }

  return parseKakuyomuEpisode(responseDataToString(res.data), url);
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export interface NativeSavedFile {
  fileName: string;
  documentsPath: string;
  shareUri: string;
}

/**
 * Saves the generated EPUB natively on Android to Documents/NovelDownloader/
 * and prepares a shareable Cache URI for opening in Kindle / Moon+ Reader / ReadEra.
 */
export async function nativeSaveEpub(
  blob: Blob,
  fileName: string
): Promise<NativeSavedFile> {
  const base64 = await blobToBase64(blob);
  const docsRelativePath = `NovelDownloader/${fileName}`;

  let documentsPath = `Documents/${docsRelativePath}`;
  try {
    const docResult = await Filesystem.writeFile({
      path: docsRelativePath,
      data: base64,
      directory: Directory.Documents,
      recursive: true,
    });
    if (docResult.uri) {
      documentsPath = `Documents/${docsRelativePath}`;
    }
  } catch (err) {
    console.warn("Could not write to Documents, falling back to Cache:", err);
  }

  const cacheResult = await Filesystem.writeFile({
    path: fileName,
    data: base64,
    directory: Directory.Cache,
    recursive: true,
  });

  return {
    fileName,
    documentsPath,
    shareUri: cacheResult.uri,
  };
}

export async function nativeShareEpub(file: NativeSavedFile): Promise<void> {
  await Share.share({
    title: file.fileName,
    text: file.fileName,
    url: file.shareUri,
    dialogTitle: "Open or Share EPUB",
  });
}

/**
 * Opens or shares a previously downloaded library EPUB on Android.
 * Re-hydrates the Cache URI from Documents/NovelDownloader/ or an IndexedDB fallback blob
 * if Android OS has evicted the temporary Cache copy.
 */
export async function nativeShareLibraryEpub(
  fileName: string,
  existingShareUri?: string,
  fallbackBlob?: Blob
): Promise<NativeSavedFile> {
  const docsRelativePath = `NovelDownloader/${fileName}`;
  const documentsPath = `Documents/${docsRelativePath}`;

  // 1. Check whether the Cache copy still exists
  try {
    await Filesystem.stat({
      path: fileName,
      directory: Directory.Cache,
    });
    const uriRes = await Filesystem.getUri({
      path: fileName,
      directory: Directory.Cache,
    });
    const file: NativeSavedFile = {
      fileName,
      documentsPath,
      shareUri: uriRes.uri || existingShareUri || "",
    };
    if (file.shareUri) {
      await nativeShareEpub(file);
      return file;
    }
  } catch {
    // Cache file evicted; try restoring from Documents or fallback blob
  }

  // 2. Restore Cache file from Documents/NovelDownloader/<fileName>
  try {
    const readRes = await Filesystem.readFile({
      path: docsRelativePath,
      directory: Directory.Documents,
    });
    if (typeof readRes.data === "string" && readRes.data.length > 0) {
      const cacheRes = await Filesystem.writeFile({
        path: fileName,
        data: readRes.data,
        directory: Directory.Cache,
        recursive: true,
      });
      const file: NativeSavedFile = {
        fileName,
        documentsPath,
        shareUri: cacheRes.uri,
      };
      await nativeShareEpub(file);
      return file;
    }
  } catch {
    // Fall through to IndexedDB fallback blob
  }

  // 3. Restore from IndexedDB Blob if available
  if (fallbackBlob) {
    const saved = await nativeSaveEpub(fallbackBlob, fileName);
    await nativeShareEpub(saved);
    return saved;
  }

  // 4. Last resort: try existingShareUri directly if present
  if (existingShareUri) {
    const file: NativeSavedFile = {
      fileName,
      documentsPath,
      shareUri: existingShareUri,
    };
    await nativeShareEpub(file);
    return file;
  }

  throw new Error(
    "Saved EPUB file was not found on device. Tap Re-download to regenerate it."
  );
}

/**
 * Best-effort cleanup of the temporary Cache copy when removing a novel from Library.
 */
export async function nativeDeleteCachedEpub(fileName: string): Promise<void> {
  try {
    await Filesystem.deleteFile({
      path: fileName,
      directory: Directory.Cache,
    });
  } catch {
    // Ignore if already absent
  }
}

/**
 * Fast on-device update check for a downloaded novel in the Library.
 */
export async function nativeCheckNovelUpdate(
  platform: Platform,
  bookId: string,
  domain?: string,
  signal?: AbortSignal
): Promise<NovelUpdateCheckResult> {
  if (platform === "kakuyomu") {
    const info = await nativeFetchKakuyomuInfo(bookId, signal);
    const totalEpisodes = info.totalEpisodes || info.episodeUrls?.length || 0;
    return {
      title: info.title,
      author: info.author,
      domain: "kakuyomu.jp",
      totalEpisodes,
      status: info.status || "unknown",
      remoteUpdatedAt: info.remoteUpdatedAt,
    };
  }

  const normalizedId = bookId.toLowerCase();
  const primaryDomain = canonicalizeNarouDomain(domain);
  const domainsToTry = [
    primaryDomain,
    primaryDomain === "ncode.syosetu.com"
      ? "novel18.syosetu.com"
      : "ncode.syosetu.com",
  ];

  for (const currentDomain of domainsToTry) {
    const meta = await nativeFetchNarouApiMeta(
      normalizedId,
      currentDomain,
      signal
    );
    if (meta && meta.totalEpisodes > 0) {
      return meta;
    }
  }

  const info = await nativeFetchNarouInfo(normalizedId, primaryDomain, signal);
  const totalEpisodes =
    info.totalEpisodes || info.episodeUrls?.length || (info.isShortStory ? 1 : 0);

  return {
    title: info.title,
    author: info.author,
    domain: info.domain || primaryDomain,
    totalEpisodes,
    status: info.status || (info.isShortStory ? "short" : "unknown"),
    isShortStory: info.isShortStory,
    remoteUpdatedAt: info.remoteUpdatedAt,
  };
}

/**
 * Fetches rankings or search results directly on-device via CapacitorHttp
 * across Narou, Narou R18 (Nocturne/Moonlight/Midnight), and Kakuyomu.
 */
export async function nativeBrowseCatalog(
  params: BrowseQueryParams,
  signal?: AbortSignal
): Promise<BrowseResponse> {
  if (params.site === "kakuyomu") {
    const url = buildKakuyomuBrowseUrl(params);
    const res = await nativeRequestWithRetry(
      url,
      {
        "User-Agent": DESKTOP_UA,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
        Referer: "https://kakuyomu.jp/",
      },
      false,
      signal
    );

    if (res.status < 200 || res.status >= 300) {
      throw new HttpStatusError(
        `Failed to fetch Kakuyomu catalog (HTTP ${res.status})`,
        res.status
      );
    }

    return parseKakuyomuBrowseHtml(responseDataToString(res.data), params);
  }

  const url = buildSyosetuBrowseUrl(params);
  const res = await nativeRequestWithRetry(
    url,
    {
      "User-Agent": DESKTOP_UA,
      Accept: "application/json,text/plain,*/*",
      "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
    },
    false,
    signal
  );

  if (res.status < 200 || res.status >= 300) {
    throw new HttpStatusError(
      `Failed to fetch Syosetu catalog (HTTP ${res.status})`,
      res.status
    );
  }

  const raw =
    typeof res.data === "string" ? JSON.parse(res.data) : res.data;
  return parseSyosetuBrowseResponse(raw, params);
}

