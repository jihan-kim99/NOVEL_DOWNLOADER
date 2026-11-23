import * as cheerio from "cheerio";
import type {
  BrowseNovelItem,
  BrowseQueryParams,
  BrowseResponse,
  BrowseSiteId,
  BrowseSort,
  BrowseStatusFilter,
} from "../../types";

const PAGE_SIZE = 20;

const NAROU_GENRE_LABELS: Record<number, string> = {
  101: "異世界恋愛",
  102: "現実世界恋愛",
  201: "ハイファンタジー",
  202: "ローファンタジー",
  301: "純文学",
  302: "ヒューマンドラマ",
  303: "歴史",
  304: "推理",
  305: "ホラー",
  306: "アクション",
  307: "コメディー",
  401: "VRゲーム",
  402: "宇宙",
  403: "空想科学",
  404: "パニック",
  9901: "童話",
  9902: "詩",
  9903: "エッセイ",
  9904: "リプレイ",
  9999: "その他",
  9801: "ノンジャンル",
};

const NOC_GENRE_LABELS: Record<number, string> = {
  1: "Nocturne (男性向け)",
  2: "Moonlight (女性向け)",
  3: "Moonlight (BL)",
  4: "Midnight (大人向け)",
};

const KAKUYOMU_GENRE_LABELS: Record<string, string> = {
  FANTASY: "異世界ファンタジー",
  ACTION: "現代ファンタジー",
  SF: "SF",
  LOVE_STORY: "恋愛",
  ROMANCE: "ラブコメ",
  DRAMA: "現代ドラマ",
  HORROR: "ホラー",
  MYSTERY: "ミステリー",
  ESSAY_NONFICTION: "エッセイ・ノンフィクション",
  HISTORY: "歴史・時代・伝奇",
  CRITICISM: "創作論・評論",
  OTHERS: "詩・童話・その他",
};

interface SyosetuApiItem {
  allcount?: number;
  title?: string;
  ncode?: string;
  writer?: string;
  story?: string;
  genre?: number;
  nocgenre?: number;
  keyword?: string;
  novel_type?: number; // 1 = serialized, 2 = short story
  end?: number; // 0 = completed, 1 = ongoing
  general_all_no?: number;
  length?: number;
  global_point?: number;
  daily_point?: number;
  weekly_point?: number;
  monthly_point?: number;
  fav_novel_cnt?: number;
  general_lastup?: string;
  novelupdated_at?: string;
}

function normalizeSort(sort?: BrowseSort): BrowseSort {
  switch (sort) {
    case "daily":
    case "weekly":
    case "monthly":
    case "popular":
    case "updated":
    case "newest":
      return sort;
    default:
      return "daily";
  }
}

function normalizeStatus(status?: BrowseStatusFilter): BrowseStatusFilter {
  switch (status) {
    case "ongoing":
    case "completed":
    case "short":
      return status;
    default:
      return "all";
  }
}

function mapSyosetuOrder(sort: BrowseSort): string {
  switch (sort) {
    case "daily":
      return "dailypoint";
    case "weekly":
      return "weeklypoint";
    case "monthly":
      return "monthlypoint";
    case "popular":
      return "hyoka";
    case "updated":
      return "new";
    case "newest":
      return "ncodedesc";
  }
}

function mapSyosetuType(status: BrowseStatusFilter): string | null {
  switch (status) {
    case "ongoing":
      return "r";
    case "completed":
      return "er";
    case "short":
      return "t";
    default:
      return null;
  }
}

export function buildSyosetuBrowseUrl(params: BrowseQueryParams): string {
  const site = params.site;
  const sort = normalizeSort(params.sort);
  const status = normalizeStatus(params.status);
  const page = Math.max(1, Math.min(100, Math.floor(params.page || 1)));
  const start = (page - 1) * PAGE_SIZE + 1;

  const isR18 = site !== "narou";
  const baseUrl = isR18
    ? "https://api.syosetu.com/novel18api/api/"
    : "https://api.syosetu.com/novelapi/api/";

  const qs = new URLSearchParams();
  qs.set("out", "json");
  qs.set("lim", String(PAGE_SIZE));
  qs.set("st", String(Math.min(start, 2000)));
  qs.set("order", mapSyosetuOrder(sort));

  if (site === "nocturne") {
    qs.set("nocgenre", "1");
  } else if (site === "moonlight") {
    qs.set("nocgenre", "2-3");
  } else if (site === "midnight") {
    qs.set("nocgenre", "4");
  }

  const trimmedQuery = (params.query || "").trim();
  if (trimmedQuery) {
    qs.set("word", trimmedQuery);
  }

  const typeParam = mapSyosetuType(status);
  if (typeParam) {
    qs.set("type", typeParam);
  }

  return `${baseUrl}?${qs.toString()}`;
}

export function parseSyosetuBrowseResponse(
  raw: unknown,
  params: BrowseQueryParams
): BrowseResponse {
  const site = params.site;
  const sort = normalizeSort(params.sort);
  const page = Math.max(1, Math.floor(params.page || 1));
  const query = (params.query || "").trim();
  const isR18 = site !== "narou";
  const host = isR18 ? "novel18.syosetu.com" : "ncode.syosetu.com";

  if (!Array.isArray(raw) || raw.length === 0) {
    return {
      site,
      sort,
      query,
      page,
      pageSize: PAGE_SIZE,
      totalCount: 0,
      hasMore: false,
      items: [],
    };
  }

  const header = raw[0] as SyosetuApiItem | undefined;
  const totalCount =
    typeof header?.allcount === "number" ? header.allcount : 0;

  const items: BrowseNovelItem[] = [];
  for (let i = 1; i < raw.length; i++) {
    const entry = raw[i] as SyosetuApiItem | undefined;
    if (!entry || !entry.ncode || !entry.title) continue;

    const ncode = String(entry.ncode).toLowerCase();
    const isShort = entry.novel_type === 2;
    const novelStatus: BrowseNovelItem["status"] = isShort
      ? "short"
      : entry.end === 0
      ? "completed"
      : "ongoing";

    const tags =
      typeof entry.keyword === "string"
        ? entry.keyword
            .split(/\s+/)
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 8)
        : [];

    const genreLabel = isR18
      ? entry.nocgenre
        ? NOC_GENRE_LABELS[entry.nocgenre]
        : undefined
      : entry.genre
      ? NAROU_GENRE_LABELS[entry.genre]
      : undefined;

    const points =
      sort === "daily"
        ? entry.daily_point ?? entry.global_point
        : sort === "weekly"
        ? entry.weekly_point ?? entry.global_point
        : sort === "monthly"
        ? entry.monthly_point ?? entry.global_point
        : entry.global_point;

    items.push({
      id: ncode,
      site,
      platform: "narou",
      title: String(entry.title).trim(),
      author: String(entry.writer || "Unknown Author").trim(),
      synopsis: String(entry.story || "").trim(),
      url: `https://${host}/${ncode}/`,
      episodeCount:
        typeof entry.general_all_no === "number"
          ? entry.general_all_no
          : undefined,
      charCount: typeof entry.length === "number" ? entry.length : undefined,
      points: typeof points === "number" ? points : undefined,
      bookmarks:
        typeof entry.fav_novel_cnt === "number"
          ? entry.fav_novel_cnt
          : undefined,
      status: novelStatus,
      tags,
      genreLabel,
      updatedAt: entry.general_lastup || entry.novelupdated_at,
      isR18,
    });
  }

  const maxReachable = Math.min(totalCount, 2000);
  const hasMore = page * PAGE_SIZE < maxReachable && items.length > 0;

  return {
    site,
    sort,
    query,
    page,
    pageSize: PAGE_SIZE,
    totalCount,
    hasMore,
    items,
  };
}

export function isKakuyomuRankingMode(params: BrowseQueryParams): boolean {
  const query = (params.query || "").trim();
  const sort = normalizeSort(params.sort);
  const status = normalizeStatus(params.status);
  return (
    query.length === 0 &&
    status === "all" &&
    (sort === "daily" || sort === "monthly")
  );
}

export function buildKakuyomuBrowseUrl(params: BrowseQueryParams): string {
  const query = (params.query || "").trim();
  const sort = normalizeSort(params.sort);
  const status = normalizeStatus(params.status);
  const page = Math.max(1, Math.min(50, Math.floor(params.page || 1)));

  if (isKakuyomuRankingMode(params)) {
    const period = sort === "monthly" ? "monthly" : "daily";
    return `https://kakuyomu.jp/rankings/all/${period}`;
  }

  const qs = new URLSearchParams();
  qs.set("q", query);

  const orderMap: Record<BrowseSort, string> = {
    daily: "weekly_ranking",
    weekly: "weekly_ranking",
    monthly: "popular",
    popular: "popular",
    updated: "last_episode_published_at",
    newest: "published_at",
  };
  qs.set("order", orderMap[sort]);
  qs.set("page", String(page));

  if (status === "completed") {
    qs.set("work_status", "completed");
  } else if (status === "ongoing") {
    qs.set("work_status", "running");
  } else if (status === "short") {
    qs.set("work_variation", "short");
  }

  return `https://kakuyomu.jp/search?${qs.toString()}`;
}

interface ApolloRef {
  __ref?: string;
}

interface KakuyomuApolloWork {
  id?: string;
  title?: string;
  catchphrase?: string;
  introduction?: string;
  genre?: string;
  serialStatus?: string;
  publicEpisodeCount?: number;
  totalCharacterCount?: number;
  totalReviewPoint?: number;
  lastEpisodePublishedAt?: string;
  publishedAt?: string;
  tagLabels?: string[];
  author?: ApolloRef;
  alternateAuthorName?: string;
}

interface KakuyomuApolloUser {
  activityName?: string;
  name?: string;
}

export function parseKakuyomuBrowseHtml(
  html: string,
  params: BrowseQueryParams
): BrowseResponse {
  const site: BrowseSiteId = "kakuyomu";
  const sort = normalizeSort(params.sort);
  const page = Math.max(1, Math.floor(params.page || 1));
  const query = (params.query || "").trim();
  const rankingMode = isKakuyomuRankingMode(params);

  const $ = cheerio.load(html);
  const nextDataRaw = $("#__NEXT_DATA__").html();

  if (!nextDataRaw) {
    return {
      site,
      sort,
      query,
      page,
      pageSize: PAGE_SIZE,
      totalCount: 0,
      hasMore: false,
      items: [],
    };
  }

  try {
    const nextData = JSON.parse(nextDataRaw);
    const apollo = nextData?.props?.pageProps?.__APOLLO_STATE__ as
      | Record<string, unknown>
      | undefined;

    if (!apollo || typeof apollo !== "object") {
      return {
        site,
        sort,
        query,
        page,
        pageSize: PAGE_SIZE,
        totalCount: 0,
        hasMore: false,
        items: [],
      };
    }

    const rootQuery = apollo.ROOT_QUERY as Record<string, unknown> | undefined;
    let workRefs: ApolloRef[] = [];
    let totalCount = 0;

    if (rootQuery) {
      const targetPrefix = rankingMode ? "rankedWorks" : "searchWorks";
      const queryKey = Object.keys(rootQuery).find((k) =>
        k.startsWith(targetPrefix)
      );
      if (queryKey) {
        const connection = rootQuery[queryKey] as
          | { nodes?: ApolloRef[]; totalCount?: number }
          | undefined;
        if (Array.isArray(connection?.nodes)) {
          workRefs = connection.nodes;
        }
        if (typeof connection?.totalCount === "number") {
          totalCount = connection.totalCount;
        }
      }
    }

    // Fallback: collect Work:* entries if ROOT_QUERY key format changed
    if (workRefs.length === 0) {
      workRefs = Object.keys(apollo)
        .filter((k) => k.startsWith("Work:"))
        .map((__ref) => ({ __ref }));
    }

    const mappedAll: BrowseNovelItem[] = [];
    const seen = new Set<string>();

    for (const ref of workRefs) {
      if (!ref?.__ref || seen.has(ref.__ref)) continue;
      seen.add(ref.__ref);

      const work = apollo[ref.__ref] as KakuyomuApolloWork | undefined;
      if (!work || !work.id || !work.title) continue;

      let authorName = work.alternateAuthorName?.trim() || "";
      if (!authorName && work.author?.__ref && apollo[work.author.__ref]) {
        const user = apollo[work.author.__ref] as KakuyomuApolloUser;
        authorName = (user.activityName || user.name || "").trim();
      }

      const synopsisParts = [
        work.catchphrase?.trim(),
        work.introduction?.trim(),
      ].filter(Boolean);
      const synopsis = synopsisParts.join("\n");

      const novelStatus: BrowseNovelItem["status"] =
        work.serialStatus === "COMPLETED"
          ? work.publicEpisodeCount === 1
            ? "short"
            : "completed"
          : "ongoing";

      mappedAll.push({
        id: String(work.id),
        site,
        platform: "kakuyomu",
        title: work.title.trim(),
        author: authorName || "Unknown Author",
        synopsis,
        url: `https://kakuyomu.jp/works/${work.id}`,
        episodeCount:
          typeof work.publicEpisodeCount === "number"
            ? work.publicEpisodeCount
            : undefined,
        charCount:
          typeof work.totalCharacterCount === "number"
            ? work.totalCharacterCount
            : undefined,
        points:
          typeof work.totalReviewPoint === "number"
            ? work.totalReviewPoint
            : undefined,
        status: novelStatus,
        tags: Array.isArray(work.tagLabels) ? work.tagLabels.slice(0, 8) : [],
        genreLabel: work.genre
          ? KAKUYOMU_GENRE_LABELS[work.genre] || work.genre
          : undefined,
        updatedAt: work.lastEpisodePublishedAt || work.publishedAt,
        isR18: false,
      });
    }

    if (rankingMode) {
      const start = (page - 1) * PAGE_SIZE;
      const sliced = mappedAll.slice(start, start + PAGE_SIZE);
      return {
        site,
        sort,
        query,
        page,
        pageSize: PAGE_SIZE,
        totalCount: mappedAll.length,
        hasMore: start + PAGE_SIZE < mappedAll.length,
        items: sliced,
      };
    }

    const effectiveTotal = totalCount || mappedAll.length;
    return {
      site,
      sort,
      query,
      page,
      pageSize: PAGE_SIZE,
      totalCount: effectiveTotal,
      hasMore: page * PAGE_SIZE < effectiveTotal && mappedAll.length > 0,
      items: mappedAll,
    };
  } catch (err) {
    console.warn("[WARN] Failed to parse Kakuyomu browse HTML:", err);
    return {
      site,
      sort,
      query,
      page,
      pageSize: PAGE_SIZE,
      totalCount: 0,
      hasMore: false,
      items: [],
    };
  }
}
