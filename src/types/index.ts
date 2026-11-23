export type Platform = "narou" | "kakuyomu";

export interface NovelInfo {
  title: string;
  author?: string;
  firstUrl: string;
  userAgent: string;
  domain?: string;
  totalEpisodes?: number;
  isShortStory?: boolean;
  /** Complete ordered list of episode URLs when extracted from TOC */
  episodeUrls?: string[];
  /** Number of Narou TOC pages when paginated (>1) */
  tocPages?: number;
}

export interface Episode {
  title: string;
  content: string;
  nextUrl: string | null;
}

export interface DownloadRequest {
  type: "info" | "episode" | "parse-info" | "parse-episode" | "fetch";
  bookId?: string;
  url?: string;
  userAgent?: string;
  platform?: Platform;
  domain?: string;
  explicitDomain?: boolean;
  html?: string;
  novel18Cookie?: string;
}
