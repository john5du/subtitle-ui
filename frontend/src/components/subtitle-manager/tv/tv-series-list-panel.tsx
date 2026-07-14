import { memo, useCallback, type KeyboardEvent } from "react";

import { Search } from "lucide-react";

import { useMediaQuery } from "@/hooks/use-media-query";
import { useI18n } from "@/lib/i18n";
import { tvSeriesDisplayTitle } from "@/lib/subtitle-manager/media-metadata";
import type { Pager, TvSeriesSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import type { TvSeriesSortBy } from "@/hooks/use-subtitle-manager/types";
import type { LibraryViewMode } from "../types";
import { CARD_GRID_CLASS, cardGridPageSize } from "../shared/card-grid";
import { EmptyPanel } from "../shared/empty-panel";
import { LibraryListShell } from "../shared/library-list-shell";
import { LibraryPosterCard } from "../shared/library-poster-card";
import { LibrarySortControl, type LibrarySortOption } from "../shared/library-sort-control";
import { LibraryViewToggle } from "../shared/library-view-toggle";
import { PosterThumbnail } from "../shared/poster-thumbnail";
import { useCardGridColumns } from "../shared/use-card-grid-columns";

const TV_SERIES_SORT_OPTIONS: LibrarySortOption<TvSeriesSortBy>[] = [
  { value: "year", labelKey: "tv.latestYear" },
  { value: "title", labelKey: "info.title" },
  { value: "updatedAt", labelKey: "movie.updatedTime" },
  { value: "videoCount", labelKey: "tv.videos" },
  { value: "noSubtitleCount", labelKey: "tv.noSubtitles" }
];

interface TvSeriesListPanelProps {
  query: string;
  onQueryChange: (value: string) => void;
  rows: TvSeriesSummary[];
  pager: Pager;
  viewMode: LibraryViewMode;
  sortBy: TvSeriesSortBy;
  sortOrder: "asc" | "desc";
  onSortByChange: (value: TvSeriesSortBy) => void;
  onToggleSortOrder: () => void;
  onSetPage: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onViewModeChange: (value: LibraryViewMode) => void;
  onOpenManager: (series: TvSeriesSummary) => void;
  operationLocked: boolean;
  onRefresh: () => void | Promise<void>;
  refreshing: boolean;
  refreshDisabled: boolean;
  refreshLabel: string;
  sidebarCollapsed?: boolean;
  sidebarToggleLabel?: string;
  onToggleSidebar?: () => void;
  showScanPrompt: boolean;
  onTriggerScan: () => void;
  loading: boolean;
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
            <div className="h-4 w-12 animate-pulse-soft bg-surface-hover" />
          </TableCell>
          <TableCell className="hidden md:table-cell">
            <div className="h-4 w-24 animate-pulse-soft bg-surface-hover" />
          </TableCell>
          <TableCell className="text-right">
            <div className="ml-auto h-4 w-6 animate-pulse-soft bg-surface-hover" />
          </TableCell>
          <TableCell className="text-right">
            <div className="ml-auto h-4 w-6 animate-pulse-soft bg-surface-hover" />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

export const TvSeriesListPanel = memo(function TvSeriesListPanel({
  query,
  onQueryChange,
  rows,
  pager,
  viewMode,
  sortBy,
  sortOrder,
  onSortByChange,
  onToggleSortOrder,
  onSetPage,
  onPageSizeChange,
  onViewModeChange,
  onOpenManager,
  operationLocked,
  onRefresh,
  refreshing,
  refreshDisabled,
  refreshLabel,
  sidebarCollapsed = false,
  sidebarToggleLabel,
  onToggleSidebar,
  showScanPrompt,
  onTriggerScan,
  loading,
  pending,
  formatTime
}: TvSeriesListPanelProps) {
  const { t, locale } = useI18n();
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
    (event: KeyboardEvent<HTMLTableRowElement>, row: TvSeriesSummary) => {
      if (operationLocked) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onOpenManager(row);
      }
    },
    [operationLocked, onOpenManager]
  );

  const hasRows = rows.length > 0;
  const showSkeleton = !hasRows && pending;
  const updatingLabel = t("tv.updatingResults");

  const emptyState = showScanPrompt ? (
    <div className="flex flex-col items-center gap-3 text-center">
      <p className="max-w-[320px] text-sm text-muted-foreground">{t("tv.scanPrompt")}</p>
      <Button type="button" variant="outline" className="gap-2" onClick={() => void onTriggerScan()} disabled={loading}>
        <Search className="h-4 w-4" />
        {t("sidebar.scanMediaLibrary")}
      </Button>
    </div>
  ) : (
    <span>{t("tv.empty")}</span>
  );

  return (
    <LibraryListShell
      query={query}
      onQueryChange={onQueryChange}
      searchAriaLabel={t("tv.filterAria")}
      searchPlaceholder={t("tv.filterPlaceholder")}
      sortControl={
        <LibrarySortControl
          value={sortBy}
          order={sortOrder}
          options={TV_SERIES_SORT_OPTIONS}
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
      hasItems={hasRows}
      updatingLabel={updatingLabel}
      overlayLabel={t("tv.refreshingSeries")}
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
              <TableHead className="w-[116px]">{t("tv.latestYear")}</TableHead>
              <TableHead className="hidden w-[156px] md:table-cell">{t("movie.updatedTime")}</TableHead>
              <TableHead className="w-[92px] text-right">{t("tv.videos")}</TableHead>
              <TableHead className="w-[112px] text-right">{t("tv.noSubtitles")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {showSkeleton && <SkeletonRows />}

            {!showSkeleton &&
              rows.map((row) => {
                const displayTitle = tvSeriesDisplayTitle(row, locale) || t("nav.tv");
                return (
                  <TableRow
                    key={row.key}
                    role="button"
                    tabIndex={operationLocked ? -1 : 0}
                    aria-label={displayTitle}
                    className={cn("row-focus", operationLocked && "cursor-not-allowed opacity-65 hover:bg-transparent")}
                    onClick={() => {
                      if (!operationLocked) {
                        onOpenManager(row);
                      }
                    }}
                    onKeyDown={(event) => handleRowKeyDown(event, row)}
                  >
                    <TableCell className="w-[76px] py-2">
                      <PosterThumbnail src={row.posterUrl} />
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate font-medium" title={displayTitle}>
                      {displayTitle || "-"}
                    </TableCell>
                    <TableCell>{row.latestEpisodeYear || "-"}</TableCell>
                    <TableCell className="hidden truncate md:table-cell" title={formatTime(row.updatedAt)}>
                      {formatTime(row.updatedAt)}
                    </TableCell>
                    <TableCell className="text-right">{row.videoCount}</TableCell>
                    <TableCell className="text-right">{row.noSubtitleCount}</TableCell>
                  </TableRow>
                );
              })}

            {!showSkeleton && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  {emptyState}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      ) : (
        <div ref={measureRef} className="px-2 pb-2 pt-1 sm:px-3">
          {rows.length === 0 ? (
            <EmptyPanel>{pending ? updatingLabel : emptyState}</EmptyPanel>
          ) : (
            <div className={CARD_GRID_CLASS}>
              {rows.map((row) => {
                const displayTitle = tvSeriesDisplayTitle(row, locale) || t("nav.tv");
                const subtitledVideoCount = Math.max(row.videoCount - row.noSubtitleCount, 0);
                return (
                  <LibraryPosterCard
                    key={row.key}
                    title={displayTitle}
                    subtitle={row.latestEpisodeYear}
                    posterUrl={row.posterUrl}
                    badge={`${subtitledVideoCount}/${row.videoCount}`}
                    ariaLabel={displayTitle}
                    operationLocked={operationLocked}
                    onOpen={() => onOpenManager(row)}
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

TvSeriesListPanel.displayName = "TvSeriesListPanel";
