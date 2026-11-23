export type Platform = "narou" | "kakuyomu";

export interface NovelInfo {
  title: string;
  author?: string;
  firstUrl: string;
  userAgent: string;
  domain?: string;
  totalEpisodes?: number;
  isShortStory?: boolean;
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
