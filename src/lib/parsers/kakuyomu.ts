import type { Episode, NovelInfo } from "../../types";
import { buildKakuyomuHeaders, fetchWithRetry } from "../http";
import { parseKakuyomuEpisode, parseKakuyomuInfo } from "./kakuyomu-parse";
import { HttpStatusError } from "./narou-parse";

export { parseKakuyomuEpisode, parseKakuyomuInfo };

export async function handleKakuyomuInfo(
  bookId: string,
  userAgent: string
): Promise<NovelInfo> {
  const baseUrl = `https://kakuyomu.jp/works/${bookId}`;
  console.log(`[INFO] Fetching Kakuyomu info from: ${baseUrl}`);

  const response = await fetchWithRetry(baseUrl, {
    headers: buildKakuyomuHeaders(userAgent),
  });

  if (response.status === 404) {
    throw new HttpStatusError(
      `Kakuyomu work "${bookId}" was not found (404).`,
      404
    );
  }
  if (response.status === 403) {
    throw new HttpStatusError("Access Forbidden (403) from Kakuyomu.", 403);
  }
  if (!response.ok) {
    throw new HttpStatusError(
      `Failed to fetch Kakuyomu novel page (${response.status})`,
      response.status
    );
  }

  const html = await response.text();
  return parseKakuyomuInfo(html, bookId, userAgent);
}

export async function handleKakuyomuEpisode(
  url: string,
  userAgent: string
): Promise<Episode> {
  console.log(`[INFO] Fetching Kakuyomu episode: ${url}`);

  const response = await fetchWithRetry(url, {
    headers: buildKakuyomuHeaders(userAgent),
  });

  if (response.status === 403) {
    throw new HttpStatusError("Access Forbidden (403) from Kakuyomu.", 403);
  }
  if (!response.ok) {
    throw new HttpStatusError(
      `Failed to fetch Kakuyomu episode (${response.status})`,
      response.status
    );
  }

  const html = await response.text();
  return parseKakuyomuEpisode(html, url);
}
