export interface NovelInfo {
  title: string;
  firstUrl: string;
  userAgent: string;
}

export interface Episode {
  title: string;
  content: string;
  nextUrl: string | null;
}

export interface DownloadRequest {
  type: "info" | "episode" | "parse-info" | "parse-episode";
  bookId?: string;
  url?: string;
  userAgent?: string;
  platform?: "narou" | "kakuyomu";
  domain?: string;
  html?: string;
}
