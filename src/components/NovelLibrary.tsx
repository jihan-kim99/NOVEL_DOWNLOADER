"use client";

import { useMemo, useState } from "react";
import type { LibraryNovel } from "../types";

type LibraryFilter = "all" | "updates" | "ongoing" | "finished";
type LibrarySort = "updates" | "updated" | "added" | "title" | "episodes";

interface NovelLibraryProps {
  novels: LibraryNovel[];
  nativeMode: boolean;
  isDownloading: boolean;
  activeDownloadNovelId: string | null;
  checkingIds: Set<string>;
  checkingAllProgress: { current: number; total: number } | null;
  onCheckUpdate: (novel: LibraryNovel) => void;
  onCheckAllUpdates: () => void;
  onCancelCheckAll: () => void;
  onUpdateNovel: (novel: LibraryNovel, forceFull?: boolean) => void;
  onUpdateAllOutdated: () => void;
  onOpenOrSaveEpub: (novel: LibraryNovel) => void;
  onShareWebEpub?: (novel: LibraryNovel) => void;
  onRemoveNovel: (novel: LibraryNovel) => void;
  onOpenInBrowser: (url: string, title?: string) => void;
  onGoToCatalog: () => void;
  onGoToDownloader: () => void;
}

function formatFileSize(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatRelativeTime(timestamp?: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 45) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function formatRemoteDate(raw?: string): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  // Handles ISO strings ("2026-11-20T10:00:00Z") and Syosetu strings ("2026-11-20 10:00:00")
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : trimmed;
}

function getSiteBadgeClass(novel: LibraryNovel): string {
  if (novel.platform === "kakuyomu") {
    return "bg-blue-50 text-blue-700 border-blue-200";
  }
  if (novel.domain === "novel18.syosetu.com") {
    return "bg-rose-50 text-rose-700 border-rose-200";
  }
  return "bg-sky-50 text-sky-700 border-sky-200";
}

function getSiteShortLabel(novel: LibraryNovel): string {
  if (novel.platform === "kakuyomu") return "Kakuyomu";
  if (novel.domain === "novel18.syosetu.com") return "Syosetu R18";
  return "Narou";
}

export default function NovelLibrary({
  novels,
  nativeMode,
  isDownloading,
  activeDownloadNovelId,
  checkingIds,
  checkingAllProgress,
  onCheckUpdate,
  onCheckAllUpdates,
  onCancelCheckAll,
  onUpdateNovel,
  onUpdateAllOutdated,
  onOpenOrSaveEpub,
  onShareWebEpub,
  onRemoveNovel,
  onOpenInBrowser,
  onGoToCatalog,
  onGoToDownloader,
}: NovelLibraryProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [sortBy, setSortBy] = useState<LibrarySort>("updates");
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  const canWebShare =
    !nativeMode &&
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    Boolean(onShareWebEpub);

  const updatesCount = useMemo(
    () => novels.filter((n) => n.hasUpdate).length,
    [novels]
  );

  const totalEpisodes = useMemo(
    () => novels.reduce((sum, n) => sum + (n.downloadedEpisodes || 0), 0),
    [novels]
  );

  const filteredNovels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = novels.filter((novel) => {
      if (filter === "updates" && !novel.hasUpdate) return false;
      if (filter === "ongoing" && novel.status !== "ongoing") return false;
      if (
        filter === "finished" &&
        novel.status !== "completed" &&
        novel.status !== "short"
      ) {
        return false;
      }

      if (!q) return true;
      return (
        novel.title.toLowerCase().includes(q) ||
        (novel.author || "").toLowerCase().includes(q) ||
        novel.bookId.toLowerCase().includes(q) ||
        novel.siteLabel.toLowerCase().includes(q)
      );
    });

    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sortBy) {
        case "updates": {
          if (a.hasUpdate !== b.hasUpdate) return a.hasUpdate ? -1 : 1;
          if (a.newEpisodeCount !== b.newEpisodeCount) {
            return b.newEpisodeCount - a.newEpisodeCount;
          }
          return b.updatedAt - a.updatedAt;
        }
        case "updated":
          return b.updatedAt - a.updatedAt;
        case "added":
          return b.downloadedAt - a.downloadedAt;
        case "title":
          return a.title.localeCompare(b.title);
        case "episodes":
          return b.downloadedEpisodes - a.downloadedEpisodes;
      }
    });
    return sorted;
  }, [novels, searchQuery, filter, sortBy]);

  const isCheckingAny = checkingIds.size > 0 || Boolean(checkingAllProgress);

  if (novels.length === 0) {
    return (
      <div className="p-8 text-center rounded-2xl border border-dashed border-gray-300 bg-gray-50/70 space-y-4">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-indigo-100 text-indigo-600 flex items-center justify-center text-2xl">
          📚
        </div>
        <div className="space-y-1.5 max-w-sm mx-auto">
          <h2 className="text-base font-bold text-gray-900">
            Your Novel Library is Empty
          </h2>
          <p className="text-xs text-gray-600 leading-relaxed">
            Every novel you download automatically goes into your Library so you
            can re-open the EPUB anytime and check for new chapters with one
            tap.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2 pt-1">
          <button
            type="button"
            onClick={onGoToCatalog}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 text-white text-xs font-bold hover:opacity-90 transition-opacity cursor-pointer shadow-xs"
          >
            Browse Catalog
          </button>
          <button
            type="button"
            onClick={onGoToDownloader}
            className="px-4 py-2 rounded-xl border border-gray-300 bg-white text-gray-700 text-xs font-semibold hover:bg-gray-50 transition-colors cursor-pointer"
          >
            Direct Downloader
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Library Header & Bulk Update Controls */}
      <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <span>Downloaded Library</span>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-100 text-indigo-700">
                {novels.length} {novels.length === 1 ? "novel" : "novels"}
              </span>
              {updatesCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                  {updatesCount} {updatesCount === 1 ? "update" : "updates"}
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {totalEpisodes.toLocaleString()} episodes stored • Check for new
              chapters anytime
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {checkingAllProgress ? (
              <button
                type="button"
                onClick={onCancelCheckAll}
                className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                Stop ({checkingAllProgress.current}/{checkingAllProgress.total})
              </button>
            ) : (
              <button
                type="button"
                disabled={isCheckingAny}
                onClick={onCheckAllUpdates}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50 cursor-pointer"
              >
                ↻ Check All Updates
              </button>
            )}

            {updatesCount > 0 && (
              <button
                type="button"
                disabled={isDownloading}
                onClick={onUpdateAllOutdated}
                className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-xs font-bold hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer shadow-xs"
              >
                ⬇ Update All ({updatesCount})
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Search, Filter Pills & Sort */}
      <div className="space-y-2.5">
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search library by title, author, or ID..."
              className="w-full px-3.5 py-2 pr-8 text-xs sm:text-sm border border-gray-300 rounded-xl bg-white text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear library search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs font-bold px-1 cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          <select
            aria-label="Sort library"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as LibrarySort)}
            className="px-3 py-2 text-xs font-medium border border-gray-300 rounded-xl bg-white text-gray-800 focus:ring-2 focus:ring-indigo-500 outline-none"
          >
            <option value="updates">Sort: Updates First</option>
            <option value="updated">Sort: Recently Updated</option>
            <option value="added">Sort: Recently Added</option>
            <option value="title">Sort: Title (A–Z)</option>
            <option value="episodes">Sort: Most Episodes</option>
          </select>
        </div>

        {/* Filter Chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: "all", label: `All (${novels.length})` },
              { id: "updates", label: `Updates (${updatesCount})` },
              {
                id: "ongoing",
                label: `Ongoing (${
                  novels.filter((n) => n.status === "ongoing").length
                })`,
              },
              {
                id: "finished",
                label: `Completed / Short (${
                  novels.filter(
                    (n) => n.status === "completed" || n.status === "short"
                  ).length
                })`,
              },
            ] as Array<{ id: LibraryFilter; label: string }>
          ).map((chip) => {
            const active = filter === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => setFilter(chip.id)}
                className={`px-3 py-1 rounded-full text-[11px] font-semibold border transition-colors cursor-pointer ${
                  active
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                }`}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Empty Filter Match */}
      {filteredNovels.length === 0 && (
        <div className="p-6 text-center rounded-xl border border-dashed border-gray-300 text-xs text-gray-500 space-y-2">
          <div>No novels in your library match the current search or filter.</div>
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setFilter("all");
            }}
            className="text-indigo-600 font-semibold hover:underline cursor-pointer"
          >
            Reset filters
          </button>
        </div>
      )}

      {/* Library Cards */}
      <div className="space-y-3">
        {filteredNovels.map((novel) => {
          const isChecking = checkingIds.has(novel.id);
          const isThisDownloading =
            isDownloading && activeDownloadNovelId === novel.id;
          const isConfirmingRemove = confirmRemoveId === novel.id;
          const sizeLabel = formatFileSize(novel.fileSize);
          const remoteDate = formatRemoteDate(novel.remoteUpdatedAt);

          return (
            <article
              key={novel.id}
              className={`p-4 rounded-xl border bg-white transition-colors shadow-xs space-y-3 ${
                novel.hasUpdate
                  ? "border-amber-300 ring-1 ring-amber-200/80"
                  : "border-gray-200 hover:border-indigo-300"
              }`}
            >
              {/* Header: Title, Author & Badges */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold text-gray-900 leading-snug break-words">
                    {novel.title}
                  </h3>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
                    {novel.author && (
                      <>
                        <span className="font-medium text-gray-700">
                          {novel.author}
                        </span>
                        <span>•</span>
                      </>
                    )}
                    <span
                      className={`px-1.5 py-0.5 rounded font-semibold border ${getSiteBadgeClass(
                        novel
                      )}`}
                    >
                      {getSiteShortLabel(novel)}
                    </span>
                    {novel.status !== "unknown" && (
                      <span
                        className={`px-1.5 py-0.5 rounded font-semibold ${
                          novel.status === "completed"
                            ? "bg-emerald-50 text-emerald-700"
                            : novel.status === "short"
                            ? "bg-purple-50 text-purple-700"
                            : "bg-blue-50 text-blue-700"
                        }`}
                      >
                        {novel.status === "completed"
                          ? "Completed"
                          : novel.status === "short"
                          ? "Short"
                          : "Ongoing"}
                      </span>
                    )}
                    <span className="text-[10px] text-gray-400 font-mono">
                      {novel.bookId}
                    </span>
                  </div>
                </div>
              </div>

              {/* Update Available Highlight Banner */}
              {novel.hasUpdate && (
                <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-bold text-amber-900">
                    ✨ +{novel.newEpisodeCount} new{" "}
                    {novel.newEpisodeCount === 1 ? "episode" : "episodes"}{" "}
                    available{" "}
                    <span className="font-medium text-amber-800">
                      ({novel.downloadedEpisodes} → {novel.latestKnownEpisodes}{" "}
                      eps)
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={isDownloading}
                    onClick={() => onUpdateNovel(novel, false)}
                    className="px-3 py-1 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-xs font-bold hover:opacity-90 disabled:opacity-50 cursor-pointer shadow-xs"
                  >
                    {isThisDownloading
                      ? "Updating..."
                      : novel.hasCachedChapters
                      ? `⬇ Fast Update (+${novel.newEpisodeCount})`
                      : `⬇ Update (+${novel.newEpisodeCount})`}
                  </button>
                </div>
              )}

              {/* Metadata Row */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                <span>
                  <strong className="text-gray-800">
                    {novel.downloadedEpisodes.toLocaleString()}
                  </strong>{" "}
                  ep{novel.downloadedEpisodes === 1 ? "" : "s"} saved
                </span>
                {sizeLabel && <span>{sizeLabel}</span>}
                <span>Saved {formatRelativeTime(novel.updatedAt)}</span>
                {novel.lastCheckedAt ? (
                  <span
                    className={
                      novel.hasUpdate
                        ? "text-amber-700 font-semibold"
                        : "text-emerald-700"
                    }
                  >
                    {novel.hasUpdate
                      ? `Checked ${formatRelativeTime(novel.lastCheckedAt)}`
                      : `✓ Up to date (${formatRelativeTime(
                          novel.lastCheckedAt
                        )})`}
                  </span>
                ) : (
                  <span>Not checked yet</span>
                )}
                {remoteDate && <span>Site updated: {remoteDate}</span>}
              </div>

              {nativeMode && novel.nativeFile?.documentsPath && (
                <div className="text-[11px] text-gray-400 truncate">
                  📁 {novel.nativeFile.documentsPath}
                </div>
              )}

              {/* Check Error Notice */}
              {novel.lastCheckError && (
                <div className="px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 text-[11px] text-red-700">
                  Update check failed: {novel.lastCheckError}
                </div>
              )}

              {/* Actions Row */}
              <div className="pt-0.5 flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onOpenOrSaveEpub(novel)}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-colors cursor-pointer"
                >
                  {nativeMode ? "Open / Share EPUB" : "⬇ Save EPUB"}
                </button>

                {canWebShare && (
                  <button
                    type="button"
                    onClick={() => onShareWebEpub?.(novel)}
                    className="px-2.5 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs font-semibold hover:bg-indigo-100 transition-colors cursor-pointer"
                  >
                    Share
                  </button>
                )}

                <button
                  type="button"
                  disabled={isChecking}
                  onClick={() => onCheckUpdate(novel)}
                  className="px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50/70 text-indigo-700 text-xs font-semibold hover:bg-indigo-100 disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {isChecking ? "Checking..." : "↻ Check Update"}
                </button>

                <button
                  type="button"
                  disabled={isDownloading}
                  onClick={() => onUpdateNovel(novel, true)}
                  className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50 transition-colors cursor-pointer"
                  title="Download all episodes fresh and regenerate EPUB"
                >
                  {isThisDownloading ? "Downloading..." : "Re-download"}
                </button>

                <button
                  type="button"
                  onClick={() => onOpenInBrowser(novel.url, novel.title)}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200 transition-colors cursor-pointer"
                >
                  {nativeMode ? "Site" : "Site ↗"}
                </button>

                {isConfirmingRemove ? (
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmRemoveId(null);
                        onRemoveNovel(novel);
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 cursor-pointer"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRemoveId(null)}
                      className="px-2 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-xs font-semibold hover:bg-gray-200 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={isThisDownloading}
                    onClick={() => setConfirmRemoveId(novel.id)}
                    aria-label={`Remove ${novel.title} from library`}
                    className="ml-auto px-2.5 py-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 text-xs font-semibold transition-colors disabled:opacity-40 cursor-pointer"
                  >
                    Remove
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
