export type Platform = "narou" | "kakuyomu";

export type NovelSerialStatus = "ongoing" | "completed" | "short" | "unknown";

export interface NovelInfo {
  title: string;
  author?: string;
  firstUrl: string;
  userAgent: string;
  domain?: string;
  totalEpisodes?: number;
  isShortStory?: boolean;
  status?: NovelSerialStatus;
  remoteUpdatedAt?: string;
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

export interface CachedEpisode {
  url: string;
  title: string;
  content: string;
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

export type BrowseSiteId =
  | "narou"
  | "kakuyomu"
  | "nocturne"
  | "moonlight"
  | "midnight";

export type BrowseSort =
  | "daily"
  | "weekly"
  | "monthly"
  | "popular"
  | "updated"
  | "newest";

export type BrowseStatusFilter = "all" | "ongoing" | "completed" | "short";

export interface BrowseNovelItem {
  id: string;
  site: BrowseSiteId;
  platform: Platform;
  title: string;
  author: string;
  synopsis: string;
  url: string;
  episodeCount?: number;
  charCount?: number;
  points?: number;
  bookmarks?: number;
  status: "ongoing" | "completed" | "short";
  tags: string[];
  genreLabel?: string;
  updatedAt?: string;
  isR18?: boolean;
}

export interface BrowseQueryParams {
  site: BrowseSiteId;
  query?: string;
  sort?: BrowseSort;
  status?: BrowseStatusFilter;
  page?: number;
}

export interface BrowseResponse {
  site: BrowseSiteId;
  sort: BrowseSort;
  query: string;
  page: number;
  pageSize: number;
  totalCount: number;
  hasMore: boolean;
  items: BrowseNovelItem[];
}

export interface QueuedNovel {
  id: string;
  url: string;
  title: string;
  author?: string;
  siteLabel?: string;
  addedAt: number;
}

export interface LibraryNativeFile {
  fileName: string;
  documentsPath: string;
  shareUri: string;
}

export interface LibraryNovel {
  /** Canonical ID: `${platform}:${bookId.toLowerCase()}` */
  id: string;
  platform: Platform;
  bookId: string;
  domain: string;
  siteLabel: string;
  url: string;
  title: string;
  author?: string;
  fileName: string;
  fileSize?: number;
  downloadedEpisodes: number;
  latestKnownEpisodes: number;
  hasUpdate: boolean;
  newEpisodeCount: number;
  status: NovelSerialStatus;
  isShortStory?: boolean;
  downloadedAt: number;
  updatedAt: number;
  lastCheckedAt?: number;
  remoteUpdatedAt?: string;
  lastCheckError?: string;
  nativeFile?: LibraryNativeFile;
  hasCachedEpub?: boolean;
  hasCachedChapters?: boolean;
}

export interface NovelUpdateCheckResult {
  title?: string;
  author?: string;
  domain?: string;
  totalEpisodes: number;
  status?: NovelSerialStatus;
  isShortStory?: boolean;
  remoteUpdatedAt?: string;
}


