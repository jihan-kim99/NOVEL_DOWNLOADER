import type { CachedEpisode, LibraryNovel, Platform } from "../types";
import { parseNovelInput } from "./url-parser";

export const LIBRARY_STORAGE_KEY = "novel_downloader_library_v1";

const IDB_NAME = "novel_downloader_library_db";
const IDB_VERSION = 1;
const STORE_EPUBS = "epubs";
const STORE_CHAPTERS = "chapters";

interface StoredEpubRecord {
  id: string;
  blob: Blob;
  fileName: string;
  updatedAt: number;
}

interface StoredChaptersRecord {
  id: string;
  episodes: CachedEpisode[];
  updatedAt: number;
}

export function buildLibraryNovelId(platform: Platform, bookId: string): string {
  return `${platform}:${bookId.trim().toLowerCase()}`;
}

export function buildCanonicalNovelUrl(
  platform: Platform,
  domain: string,
  bookId: string
): string {
  const normalizedId = bookId.trim().toLowerCase();
  if (platform === "kakuyomu") {
    return `https://kakuyomu.jp/works/${bookId.trim()}`;
  }
  const cleanDomain =
    domain === "novel18.syosetu.com"
      ? "novel18.syosetu.com"
      : "ncode.syosetu.com";
  return `https://${cleanDomain}/${normalizedId}/`;
}

export function formatSiteLabelFromDomain(
  platform: Platform,
  domain?: string
): string {
  if (platform === "kakuyomu") return "Kakuyomu";
  if (domain === "novel18.syosetu.com") return "Syosetu R18";
  return "Shosetsuka ni Narou";
}

export function getLibraryIdFromUrl(rawUrl: string): string | null {
  try {
    const parsed = parseNovelInput(rawUrl);
    return buildLibraryNovelId(parsed.platform, parsed.bookId);
  } catch {
    return null;
  }
}

export function loadLibraryNovels(): LibraryNovel[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LIBRARY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is LibraryNovel =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        typeof item.bookId === "string" &&
        typeof item.url === "string"
    );
  } catch {
    return [];
  }
}

export function saveLibraryNovels(novels: LibraryNovel[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(novels));
  } catch {
    // Ignore localStorage quota errors
  }
}

export function upsertLibraryNovel(
  novels: LibraryNovel[],
  entry: LibraryNovel
): LibraryNovel[] {
  const idx = novels.findIndex((n) => n.id === entry.id);
  if (idx === -1) {
    return [entry, ...novels];
  }
  const updated = [...novels];
  updated[idx] = entry;
  return updated;
}

function openLibraryDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(IDB_NAME, IDB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_EPUBS)) {
          db.createObjectStore(STORE_EPUBS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_CHAPTERS)) {
          db.createObjectStore(STORE_CHAPTERS, { keyPath: "id" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveLibraryAssets(
  id: string,
  epub: { blob: Blob; fileName: string },
  episodes?: CachedEpisode[]
): Promise<{ savedEpub: boolean; savedChapters: boolean }> {
  const db = await openLibraryDb();
  if (!db) {
    return { savedEpub: false, savedChapters: false };
  }

  let savedEpub = false;
  let savedChapters = false;
  const now = Date.now();

  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_EPUBS], "readwrite");
      const record: StoredEpubRecord = {
        id,
        blob: epub.blob,
        fileName: epub.fileName,
        updatedAt: now,
      };
      tx.objectStore(STORE_EPUBS).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    savedEpub = true;
  } catch {
    // Best-effort storage
  }

  if (episodes && episodes.length > 0) {
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE_CHAPTERS], "readwrite");
        const record: StoredChaptersRecord = {
          id,
          episodes,
          updatedAt: now,
        };
        tx.objectStore(STORE_CHAPTERS).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      savedChapters = true;
    } catch {
      // Best-effort storage
    }
  }

  db.close();
  return { savedEpub, savedChapters };
}

export async function getLibraryEpub(
  id: string
): Promise<{ blob: Blob; fileName: string } | null> {
  const db = await openLibraryDb();
  if (!db) return null;

  try {
    const result = await new Promise<StoredEpubRecord | undefined>(
      (resolve, reject) => {
        const tx = db.transaction([STORE_EPUBS], "readonly");
        const req = tx.objectStore(STORE_EPUBS).get(id);
        req.onsuccess = () => resolve(req.result as StoredEpubRecord | undefined);
        req.onerror = () => reject(req.error);
      }
    );
    db.close();
    if (result && result.blob instanceof Blob) {
      return { blob: result.blob, fileName: result.fileName };
    }
    return null;
  } catch {
    db.close();
    return null;
  }
}

export async function getLibraryChapters(
  id: string
): Promise<CachedEpisode[] | null> {
  const db = await openLibraryDb();
  if (!db) return null;

  try {
    const result = await new Promise<StoredChaptersRecord | undefined>(
      (resolve, reject) => {
        const tx = db.transaction([STORE_CHAPTERS], "readonly");
        const req = tx.objectStore(STORE_CHAPTERS).get(id);
        req.onsuccess = () =>
          resolve(req.result as StoredChaptersRecord | undefined);
        req.onerror = () => reject(req.error);
      }
    );
    db.close();
    if (result && Array.isArray(result.episodes) && result.episodes.length > 0) {
      return result.episodes;
    }
    return null;
  } catch {
    db.close();
    return null;
  }
}

export async function deleteLibraryAssets(id: string): Promise<void> {
  const db = await openLibraryDb();
  if (!db) return;

  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction([STORE_EPUBS, STORE_CHAPTERS], "readwrite");
      tx.objectStore(STORE_EPUBS).delete(id);
      tx.objectStore(STORE_CHAPTERS).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // Ignore deletion errors
  } finally {
    db.close();
  }
}
