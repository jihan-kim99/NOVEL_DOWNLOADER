import type { BrowseSiteId, BrowseSort, BrowseStatusFilter } from "../types";

export interface SiteMeta {
  id: BrowseSiteId;
  shortName: string;
  name: string;
  subtitle: string;
  homeUrl: string;
  searchPageUrl: string;
  isR18: boolean;
  badgeClass: string;
  activeTabClass: string;
}

export const SUPPORTED_SITES: SiteMeta[] = [
  {
    id: "narou",
    shortName: "Narou",
    name: "Shosetsuka ni Narou",
    subtitle: "小説家になろう — ncode.syosetu.com",
    homeUrl: "https://yomou.syosetu.com/rank/top/",
    searchPageUrl: "https://yomou.syosetu.com/search.php",
    isR18: false,
    badgeClass: "bg-sky-100 text-sky-800 border-sky-200",
    activeTabClass: "bg-sky-600 text-white border-sky-600 shadow-sm",
  },
  {
    id: "kakuyomu",
    shortName: "Kakuyomu",
    name: "Kakuyomu",
    subtitle: "カクヨム — kakuyomu.jp",
    homeUrl: "https://kakuyomu.jp/rankings/all/daily",
    searchPageUrl: "https://kakuyomu.jp/search",
    isR18: false,
    badgeClass: "bg-blue-100 text-blue-800 border-blue-200",
    activeTabClass: "bg-blue-600 text-white border-blue-600 shadow-sm",
  },
  {
    id: "nocturne",
    shortName: "Nocturne",
    name: "Nocturne Novels",
    subtitle: "ノクターンノベルズ (R18) — noc.syosetu.com",
    homeUrl: "https://noc.syosetu.com/rank/top/",
    searchPageUrl: "https://noc.syosetu.com/search/search/search.php",
    isR18: true,
    badgeClass: "bg-rose-100 text-rose-800 border-rose-200",
    activeTabClass: "bg-rose-600 text-white border-rose-600 shadow-sm",
  },
  {
    id: "moonlight",
    shortName: "Moonlight",
    name: "Moonlight Novels",
    subtitle: "ムーンライトノベルズ (R18) — mnlt.syosetu.com",
    homeUrl: "https://mnlt.syosetu.com/rank/top/",
    searchPageUrl: "https://mnlt.syosetu.com/search/search/search.php",
    isR18: true,
    badgeClass: "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200",
    activeTabClass: "bg-fuchsia-600 text-white border-fuchsia-600 shadow-sm",
  },
  {
    id: "midnight",
    shortName: "Midnight",
    name: "Midnight Novels",
    subtitle: "ミッドナイトノベルズ (R18) — mid.syosetu.com",
    homeUrl: "https://mid.syosetu.com/rank/top/",
    searchPageUrl: "https://mid.syosetu.com/search/search/search.php",
    isR18: true,
    badgeClass: "bg-violet-100 text-violet-800 border-violet-200",
    activeTabClass: "bg-violet-600 text-white border-violet-600 shadow-sm",
  },
];

export const SITE_META_MAP: Record<BrowseSiteId, SiteMeta> =
  SUPPORTED_SITES.reduce(
    (acc, item) => {
      acc[item.id] = item;
      return acc;
    },
    {} as Record<BrowseSiteId, SiteMeta>
  );

export const BROWSE_SORT_OPTIONS: Array<{ value: BrowseSort; label: string }> =
  [
    { value: "daily", label: "Daily Ranking" },
    { value: "weekly", label: "Weekly Popular" },
    { value: "monthly", label: "Monthly Ranking" },
    { value: "popular", label: "All-Time Top" },
    { value: "updated", label: "Recently Updated" },
    { value: "newest", label: "Newest" },
  ];

export const BROWSE_STATUS_OPTIONS: Array<{
  value: BrowseStatusFilter;
  label: string;
}> = [
  { value: "all", label: "All Types" },
  { value: "ongoing", label: "Ongoing" },
  { value: "completed", label: "Completed" },
  { value: "short", label: "Short Story" },
];

export function isValidBrowseSite(value: string): value is BrowseSiteId {
  return value in SITE_META_MAP;
}
