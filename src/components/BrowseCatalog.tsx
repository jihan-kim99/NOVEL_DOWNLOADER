"use client";

import { useEffect, useRef, useState } from "react";
import { nativeBrowseCatalog } from "../lib/capacitor-native";
import {
  BROWSE_SORT_OPTIONS,
  BROWSE_STATUS_OPTIONS,
  SITE_META_MAP,
  SUPPORTED_SITES,
} from "../lib/sites";
import type {
  BrowseNovelItem,
  BrowseResponse,
  BrowseSiteId,
  BrowseSort,
  BrowseStatusFilter,
} from "../types";

interface BrowseCatalogProps {
  nativeMode: boolean;
  isDownloading: boolean;
  queuedUrls: Set<string>;
  onDownloadNovel: (url: string, title?: string) => void;
  onQueueNovel: (novel: {
    url: string;
    title: string;
    author?: string;
    siteLabel?: string;
  }) => void;
  onOpenInBrowser: (url: string, title?: string) => void;
}

function formatCompactNumber(num?: number): string {
  if (typeof num !== "number" || !Number.isFinite(num)) return "";
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
  return String(num);
}

export default function BrowseCatalog({
  nativeMode,
  isDownloading,
  queuedUrls,
  onDownloadNovel,
  onQueueNovel,
  onOpenInBrowser,
}: BrowseCatalogProps) {
  const [site, setSite] = useState<BrowseSiteId>("narou");
  const [sort, setSort] = useState<BrowseSort>("daily");
  const [status, setStatus] = useState<BrowseStatusFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [page, setPage] = useState(1);

  const [data, setData] = useState<BrowseResponse | null>(null);
  const [loadedKey, setLoadedKey] = useState<string>("");
  const [errorState, setErrorState] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const topRef = useRef<HTMLDivElement | null>(null);

  const requestKey = `${nativeMode ? "native" : "web"}|${site}|${activeQuery}|${sort}|${status}|${page}|${retryNonce}`;
  const error = errorState?.key === requestKey ? errorState.message : null;
  const loading = loadedKey !== requestKey && !error;

  useEffect(() => {
    const controller = new AbortController();

    const run = async () => {
      try {
        let result: BrowseResponse;
        if (nativeMode) {
          result = await nativeBrowseCatalog(
            {
              site,
              query: activeQuery,
              sort,
              status,
              page,
            },
            controller.signal
          );
        } else {
          const qs = new URLSearchParams({
            site,
            sort,
            status,
            page: String(page),
          });
          if (activeQuery) {
            qs.set("query", activeQuery);
          }
          const res = await fetch(`/api/browse?${qs.toString()}`, {
            signal: controller.signal,
          });
          if (!res.ok) {
            const errJson = await res.json().catch(() => null);
            throw new Error(
              errJson?.error || `Catalog request failed (HTTP ${res.status})`
            );
          }
          result = (await res.json()) as BrowseResponse;
        }

        if (!controller.signal.aborted) {
          setData(result);
          setErrorState(null);
          setLoadedKey(requestKey);
        }
      } catch (err: unknown) {
        if (
          (err instanceof DOMException || err instanceof Error) &&
          err.name === "AbortError"
        ) {
          return;
        }
        const msg =
          err instanceof Error ? err.message : "Failed to load novel catalog.";
        if (!controller.signal.aborted) {
          setErrorState({ key: requestKey, message: msg });
        }
      }
    };

    void run();
    return () => {
      controller.abort();
    };
  }, [nativeMode, site, activeQuery, sort, status, page, requestKey]);

  const handleSiteChange = (nextSite: BrowseSiteId) => {
    if (nextSite === site) return;
    setSite(nextSite);
    setPage(1);
    setExpandedIds(new Set());
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setActiveQuery(searchInput.trim());
  };

  const handleClearSearch = () => {
    setSearchInput("");
    setActiveQuery("");
    setPage(1);
  };

  const handlePageChange = (nextPage: number) => {
    setPage(nextPage);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const toggleExpand = (key: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const currentSiteMeta = SITE_META_MAP[site];

  return (
    <div ref={topRef} className="space-y-4">
      {/* Site Switcher Pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        {SUPPORTED_SITES.map((s) => {
          const isActive = s.id === site;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => handleSiteChange(s.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                isActive
                  ? s.activeTabClass
                  : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
              }`}
            >
              {s.shortName}
              {s.isR18 && (
                <span
                  className={`ml-1 text-[10px] px-1 py-0.2 rounded ${
                    isActive
                      ? "bg-white/25 text-white"
                      : "bg-rose-100 text-rose-700"
                  }`}
                >
                  R18
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Site Header + Launch Internal Browser */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200">
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <span>{currentSiteMeta.name}</span>
            {currentSiteMeta.isR18 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200">
                18+
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 truncate">
            {currentSiteMeta.subtitle}
          </div>
        </div>
        <button
          type="button"
          onClick={() =>
            onOpenInBrowser(currentSiteMeta.homeUrl, currentSiteMeta.name)
          }
          className="shrink-0 px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-semibold hover:bg-slate-900 transition-colors cursor-pointer"
        >
          {nativeMode ? "Open Site in Browser" : "Open Site ↗"}
        </button>
      </div>

      {/* Search & Filter Controls */}
      <form onSubmit={handleSearchSubmit} className="space-y-2.5">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={`Search ${currentSiteMeta.shortName} (Japanese or keywords)...`}
              className="w-full px-3.5 py-2.5 pr-8 text-sm border border-gray-300 rounded-xl bg-white text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
            {searchInput && (
              <button
                type="button"
                onClick={handleClearSearch}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm font-bold px-1"
              >
                ✕
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50 cursor-pointer shrink-0"
          >
            Search
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Sort order"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as BrowseSort);
              setPage(1);
            }}
            className="flex-1 min-w-[140px] px-3 py-2 text-xs font-medium border border-gray-300 rounded-lg bg-white text-gray-800 focus:ring-2 focus:ring-indigo-500 outline-none"
          >
            {BROWSE_SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                Sort: {opt.label}
              </option>
            ))}
          </select>

          <select
            aria-label="Novel type filter"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as BrowseStatusFilter);
              setPage(1);
            }}
            className="flex-1 min-w-[120px] px-3 py-2 text-xs font-medium border border-gray-300 rounded-lg bg-white text-gray-800 focus:ring-2 focus:ring-indigo-500 outline-none"
          >
            {BROWSE_STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </form>

      {/* Results Header */}
      {data && !loading && !error && (
        <div className="flex items-center justify-between text-xs text-gray-500 px-0.5">
          <span>
            {activeQuery ? (
              <>
                Results for{" "}
                <strong className="text-gray-800">&ldquo;{activeQuery}&rdquo;</strong>
              </>
            ) : (
              <span>Showing top works</span>
            )}{" "}
            ({data.totalCount.toLocaleString()} total)
          </span>
          <span>Page {data.page}</span>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs space-y-2">
          <div className="font-bold">Could not load catalog</div>
          <div>{error}</div>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="px-3 py-1.5 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading Skeletons */}
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div
              key={idx}
              className="p-4 rounded-xl border border-gray-200 bg-gray-50 animate-pulse space-y-2.5"
            >
              <div className="h-4 bg-gray-200 rounded w-3/4" />
              <div className="h-3 bg-gray-200 rounded w-1/3" />
              <div className="h-3 bg-gray-200 rounded w-full" />
              <div className="h-3 bg-gray-200 rounded w-5/6" />
              <div className="flex gap-2 pt-1">
                <div className="h-8 bg-gray-200 rounded-lg w-28" />
                <div className="h-8 bg-gray-200 rounded-lg w-20" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Novel Cards List */}
      {!loading && !error && data && data.items.length === 0 && (
        <div className="p-8 text-center rounded-xl border border-dashed border-gray-300 text-gray-500 text-sm">
          No novels matched your search or filters.
        </div>
      )}

      {!loading && !error && data && data.items.length > 0 && (
        <div className="space-y-3">
          {data.items.map((item: BrowseNovelItem, idx: number) => {
            const rankNum = (data.page - 1) * data.pageSize + idx + 1;
            const key = `${item.site}-${item.id}`;
            const isExpanded = expandedIds.has(key);
            const isQueued = queuedUrls.has(item.url);
            const isLongSynopsis = item.synopsis.length > 160;
            const displayedSynopsis =
              isExpanded || !isLongSynopsis
                ? item.synopsis
                : `${item.synopsis.slice(0, 160)}…`;

            return (
              <article
                key={key}
                className="p-4 rounded-xl border border-gray-200 bg-white hover:border-indigo-300 transition-colors shadow-xs space-y-2.5"
              >
                {/* Title & Badges */}
                <div className="flex items-start gap-2.5">
                  {!activeQuery && (
                    <span
                      className={`shrink-0 w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center mt-0.5 ${
                        rankNum <= 3
                          ? "bg-amber-100 text-amber-800 border border-amber-300"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {rankNum}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-bold text-gray-900 leading-snug break-words">
                      {item.title}
                    </h3>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
                      <span className="font-medium text-gray-700">
                        {item.author}
                      </span>
                      <span>•</span>
                      <span
                        className={`px-1.5 py-0.5 rounded font-semibold ${
                          item.status === "completed"
                            ? "bg-emerald-50 text-emerald-700"
                            : item.status === "short"
                            ? "bg-purple-50 text-purple-700"
                            : "bg-blue-50 text-blue-700"
                        }`}
                      >
                        {item.status === "completed"
                          ? "Completed"
                          : item.status === "short"
                          ? "Short"
                          : "Ongoing"}
                      </span>
                      {item.genreLabel && (
                        <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                          {item.genreLabel}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Synopsis */}
                {item.synopsis && (
                  <div className="text-xs text-gray-600 leading-relaxed whitespace-pre-line break-words">
                    {displayedSynopsis}
                    {isLongSynopsis && (
                      <button
                        type="button"
                        onClick={() => toggleExpand(key)}
                        className="ml-1.5 text-indigo-600 font-semibold hover:underline cursor-pointer"
                      >
                        {isExpanded ? "Show less" : "Read more"}
                      </button>
                    )}
                  </div>
                )}

                {/* Stats & Tags */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                  {typeof item.episodeCount === "number" && (
                    <span>
                      <strong className="text-gray-700">
                        {item.episodeCount.toLocaleString()}
                      </strong>{" "}
                      ep{item.episodeCount === 1 ? "" : "s"}
                    </span>
                  )}
                  {typeof item.charCount === "number" && item.charCount > 0 && (
                    <span>
                      <strong className="text-gray-700">
                        {formatCompactNumber(item.charCount)}
                      </strong>{" "}
                      chars
                    </span>
                  )}
                  {typeof item.points === "number" && item.points > 0 && (
                    <span>
                      <strong className="text-amber-700">
                        {formatCompactNumber(item.points)}
                      </strong>{" "}
                      pts
                    </span>
                  )}
                  {typeof item.bookmarks === "number" && item.bookmarks > 0 && (
                    <span>
                      <strong className="text-gray-700">
                        {formatCompactNumber(item.bookmarks)}
                      </strong>{" "}
                      bookmarks
                    </span>
                  )}
                </div>

                {item.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {item.tags.slice(0, 6).map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => {
                          setSearchInput(tag);
                          setActiveQuery(tag);
                          setPage(1);
                        }}
                        className="px-2 py-0.5 rounded-md bg-slate-100 hover:bg-indigo-100 text-slate-600 hover:text-indigo-700 text-[10px] transition-colors cursor-pointer"
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
                )}

                {/* Actions */}
                <div className="pt-1 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={isDownloading}
                    onClick={() => onDownloadNovel(item.url, item.title)}
                    className="flex-1 min-w-[120px] px-3 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 text-white text-xs font-bold hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer shadow-xs"
                  >
                    ⬇ Download EPUB
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onQueueNovel({
                        url: item.url,
                        title: item.title,
                        author: item.author,
                        siteLabel: currentSiteMeta.shortName,
                      })
                    }
                    className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                      isQueued
                        ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                        : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {isQueued ? "✓ Queued" : "+ Queue"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenInBrowser(item.url, item.title)}
                    className="px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
                  >
                    {nativeMode ? "Browse" : "View ↗"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {!loading && data && (data.page > 1 || data.hasMore) && (
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => handlePageChange(page - 1)}
            className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 cursor-pointer"
          >
            ← Previous
          </button>
          <span className="text-xs font-medium text-gray-500">
            Page {data.page}
          </span>
          <button
            type="button"
            disabled={!data.hasMore}
            onClick={() => handlePageChange(page + 1)}
            className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 cursor-pointer"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
