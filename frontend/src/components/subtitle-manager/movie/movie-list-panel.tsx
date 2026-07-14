import { memo, useCallback, type KeyboardEvent } from "react";

import { useMediaQuery } from "@/hooks/use-media-query";
import { useI18n } from "@/lib/i18n";
import type { Pager, Video } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import type { MovieSortBy } from "@/hooks/use-subtitle-manager/types";
import type { LibraryViewMode } from "../types";
import { CARD_GRID_CLASS, cardGridPageSize } from "../shared/card-grid";
import { EmptyPanel } from "../shared/empty-panel";
import { LibraryListShell } from "../shared/library-list-shell";
import { LibraryPosterCard } from "../shared/library-poster-card";
import { LibrarySortControl, type LibrarySortOption } from "../shared/library-sort-control";
import { LibraryViewToggle } from "../shared/library-view-toggle";
import { PosterThumbnail } from "../shared/poster-thumbnail";
import { useCardGridColumns } from "../shared/use-card-grid-columns";

const MOVIE_SORT_OPTIONS: LibrarySortOption<MovieSortBy>[] = [
  { value: "year", labelKey: "info.year" },
  { value: "title", labelKey: "info.title" },
  { value: "updatedAt", labelKey: "movie.updatedTime" },
  { value: "subtitleCount", labelKey: "movie.subtitles" }
];

interface MovieListPanelProps {
  query: string;
  onQueryChange: (value: string) => void;
  videos: Video[];
  pager: Pager;
  viewMode: LibraryViewMode;
  sortBy: MovieSortBy;
  sortOrder: "asc" | "desc";
  onSortByChange: (value: MovieSortBy) => void;
  onToggleSortOrder: () => void;
  onViewModeChange: (value: LibraryViewMode) => void;
  onSetPage: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onOpenManager: (video: Video) => void;
  operationLocked: boolean;
  onRefresh: () => void | Promise<void>;
  refreshing: boolean;
  refreshDisabled: boolean;
  refreshLabel: string;
  sidebarCollapsed?: boolean;
  sidebarToggleLabel?: string;
  onToggleSidebar?: () => void;
  pending: boolean;
  formatTime: (value: string | undefined | null) => string;
}

function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, index) => (
        <TableRow key={`skeleton-${index}`} aria-hidden>
          <TableCell className="py-3">
            <div className="h-14 w-10 animate-pulse-soft bg-surface-hover" />
          </TableCell>
          <TableCell>
            <div className="h-4 w-40 animate-pulse-soft bg-surface-hover" />
          </TableCell>
          <TableCell>
            <div className="h-4 w-10 animate-pulse-soft bg-surface-hover" />
          </TableCell>
          <TableCell className="hidden md:table-cell">
            <div className="h-4 w-24 animate-pulse-soft bg-surface-hover" />
          </TableCell>
          <TableCell className="text-right">
            <div className="ml-auto h-4 w-6 animate-pulse-soft bg-surface-hover" />
          </TableCell>
          <TableCell className="hidden lg:table-cell">
            <div className="h-4 w-48 animate-pulse-soft bg-surface-hover" />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

export const MovieListPanel = memo(function MovieListPanel({
  query,
  onQueryChange,
  videos,
  pager,
  viewMode,
  sortBy,
  sortOrder,
  onSortByChange,
  onToggleSortOrder,
  onViewModeChange,
  onSetPage,
  onPageSizeChange,
  onOpenManager,
  operationLocked,
  onRefresh,
  refreshing,
  refreshDisabled,
  refreshLabel,
  sidebarCollapsed = false,
  sidebarToggleLabel,
  onToggleSidebar,
  pending,
  formatTime
}: MovieListPanelProps) {
  const { t } = useI18n();
  const isMdUp = useMediaQuery("(min-width: 768px)", true);
  const effectiveViewMode: LibraryViewMode = isMdUp ? viewMode : "card";

  const handleCardColumnsChange = useCallback(
    (columns: number) => {
      onPageSizeChange(cardGridPageSize(columns));
    },
    [onPageSizeChange]
  );

  const { measureRef } = useCardGridColumns(effectiveViewMode === "card", handleCardColumnsChange);

  const handleRowKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTableRowElement>, video: Video) => {
      if (operationLocked) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onOpenManager(video);
      }
    },
    [operationLocked, onOpenManager]
  );

  const hasVideos = videos.length > 0;
  const showSkeleton = !hasVideos && pending;
  const updatingLabel = t("movie.updatingResults");

  return (
    <LibraryListShell
      query={query}
      onQueryChange={onQueryChange}
      searchAriaLabel={t("movie.filterAria")}
      searchPlaceholder={t("movie.filterPlaceholder")}
      sortControl={
        <LibrarySortControl
          value={sortBy}
          order={sortOrder}
          options={MOVIE_SORT_OPTIONS}
          onValueChange={onSortByChange}
          onToggleOrder={onToggleSortOrder}
        />
      }
      viewToggle={<LibraryViewToggle value={viewMode} onChange={onViewModeChange} />}
      onRefresh={onRefresh}
      refreshing={refreshing}
      refreshDisabled={refreshDisabled}
      refreshLabel={refreshLabel}
      sidebarCollapsed={sidebarCollapsed}
      sidebarToggleLabel={sidebarToggleLabel}
      onToggleSidebar={onToggleSidebar}
      pending={pending}
      hasItems={hasVideos}
      updatingLabel={updatingLabel}
      pager={pager}
      onSetPage={onSetPage}
      scrollSoft={effectiveViewMode === "list"}
    >
      {effectiveViewMode === "list" ? (
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[76px]">{t("info.poster")}</TableHead>
              <TableHead>{t("info.title")}</TableHead>
              <TableHead className="w-[96px]">{t("info.year")}</TableHead>
              <TableHead className="hidden w-[156px] md:table-cell">{t("movie.updatedTime")}</TableHead>
              <TableHead className="w-[92px] text-right">{t("movie.subtitles")}</TableHead>
              <TableHead className="hidden lg:table-cell lg:w-[320px]">{t("movie.fileName")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {showSkeleton && <SkeletonRows />}

            {!showSkeleton &&
              videos.map((video) => (
                <TableRow
                  key={video.id}
                  role="button"
                  tabIndex={operationLocked ? -1 : 0}
                  aria-label={video.title || video.fileName || t("info.movie")}
                  className={cn("row-focus", operationLocked && "cursor-not-allowed opacity-65 hover:bg-transparent")}
                  onClick={() => {
                    if (!operationLocked) {
                      onOpenManager(video);
                    }
                  }}
                  onKeyDown={(event) => handleRowKeyDown(event, video)}
                >
                  <TableCell className="w-[76px] py-2">
                    <PosterThumbnail src={video.posterUrl} />
                  </TableCell>
                  <TableCell className="max-w-[260px] truncate font-medium" title={video.title}>
                    {video.title || "-"}
                  </TableCell>
                  <TableCell>{video.year || "-"}</TableCell>
                  <TableCell className="hidden md:table-cell">{formatTime(video.updatedAt)}</TableCell>
                  <TableCell className="text-right">{video.subtitles.length}</TableCell>
                  <TableCell className="hidden max-w-[320px] truncate lg:table-cell" title={video.fileName}>
                    {video.fileName || "-"}
                  </TableCell>
                </TableRow>
              ))}

            {!showSkeleton && videos.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  {t("movie.empty")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      ) : (
        <div ref={measureRef} className="px-2 pb-2 pt-1 sm:px-3">
          {videos.length === 0 ? (
            <EmptyPanel>{pending ? updatingLabel : t("movie.empty")}</EmptyPanel>
          ) : (
            <div className={CARD_GRID_CLASS}>
              {videos.map((video) => {
                const title = video.title || video.fileName || "-";
                return (
                  <LibraryPosterCard
                    key={video.id}
                    title={title}
                    subtitle={video.year}
                    posterUrl={video.posterUrl}
                    badge={video.subtitles.length}
                    ariaLabel={title || t("info.movie")}
                    operationLocked={operationLocked}
                    onOpen={() => onOpenManager(video)}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </LibraryListShell>
  );
});

MovieListPanel.displayName = "MovieListPanel";
