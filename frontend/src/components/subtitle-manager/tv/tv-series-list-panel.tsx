import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { RefreshCw, Search, X } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { tvSeriesDisplayTitle } from "@/lib/subtitle-manager/media-metadata";
import type { Pager, TvSeriesSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import type { LibraryViewMode } from "../types";
import { CARD_GRID_CLASS, cardGridPageSize } from "../shared/card-grid";
import { LibraryPosterCard } from "../shared/library-poster-card";
import { LibraryViewToggle } from "../shared/library-view-toggle";
import { InlinePending, PanelLoadingOverlay, SpinnerIcon } from "../shared/pending-state";
import { PagerView } from "../shared/pager-view";
import { PosterThumbnail } from "../shared/poster-thumbnail";
import { useCardGridColumns } from "../shared/use-card-grid-columns";

interface TvSeriesListPanelProps {
  query: string;
  onQueryChange: (value: string) => void;
  rows: TvSeriesSummary[];
  pager: Pager;
  viewMode: LibraryViewMode;
  yearSortOrder: "asc" | "desc";
  onSetPage: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onToggleYearSort: () => void;
  onViewModeChange: (value: LibraryViewMode) => void;
  onOpenManager: (series: TvSeriesSummary) => void;
  operationLocked: boolean;
  onRefresh: () => void | Promise<void>;
  refreshing: boolean;
  refreshDisabled: boolean;
  refreshLabel: string;
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
          <TableCell className="py-3"><div className="h-14 w-10 animate-pulse-soft bg-surface-hover" /></TableCell>
          <TableCell><div className="h-4 w-40 animate-pulse-soft bg-surface-hover" /></TableCell>
          <TableCell><div className="h-4 w-12 animate-pulse-soft bg-surface-hover" /></TableCell>
          <TableCell className="hidden md:table-cell"><div className="h-4 w-24 animate-pulse-soft bg-surface-hover" /></TableCell>
          <TableCell className="text-right"><div className="ml-auto h-4 w-6 animate-pulse-soft bg-surface-hover" /></TableCell>
          <TableCell className="text-right"><div className="ml-auto h-4 w-6 animate-pulse-soft bg-surface-hover" /></TableCell>
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
  yearSortOrder,
  onSetPage,
  onPageSizeChange,
  onToggleYearSort,
  onViewModeChange,
  onOpenManager,
  operationLocked,
  onRefresh,
  refreshing,
  refreshDisabled,
  refreshLabel,
  showScanPrompt,
  onTriggerScan,
  loading,
  pending,
  formatTime
}: TvSeriesListPanelProps) {
  const { t, locale } = useI18n();
  const [draftQuery, setDraftQuery] = useState(query);
  const lastPublishedRef = useRef(query);
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const onPageSizeChangeRef = useRef(onPageSizeChange);
  onPageSizeChangeRef.current = onPageSizeChange;

  const handleCardColumnsChange = useCallback((columns: number) => {
    onPageSizeChangeRef.current(cardGridPageSize(columns));
  }, []);

  const { measureRef } = useCardGridColumns(viewMode === "card", handleCardColumnsChange);

  useEffect(() => {
    if (query !== draftQuery) {
      setDraftQuery(query);
      lastPublishedRef.current = query;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    if (draftQuery === lastPublishedRef.current) {
      return;
    }
    const timer = window.setTimeout(() => {
      lastPublishedRef.current = draftQuery;
      onQueryChange(draftQuery);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [draftQuery, onQueryChange]);

  useEffect(() => {
    scrollViewportRef.current?.scrollTo({ top: 0, left: 0 });
  }, [pager.page]);

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

  const ariaSort = yearSortOrder === "desc" ? "descending" : "ascending";
  const sortAriaLabel = yearSortOrder === "desc" ? t("common.sortDescending") : t("common.sortAscending");
  const showToolbarSortButton = viewMode !== "list";
  const hasRows = rows.length > 0;
  const showSkeleton = !hasRows && pending;
  const showPager = Math.max(1, pager.totalPages) > 1 || pager.total > 0;

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
    <Card className="surface-panel animate-fade-in-up flex h-full flex-col">
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => void onRefresh()}
            disabled={refreshDisabled}
            aria-label={refreshLabel}
            title={refreshLabel}
          >
            {refreshing ? <SpinnerIcon className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          <div className="flex w-full flex-col gap-2 sm:min-w-0 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end xl:w-auto">
            <div className="relative w-full min-w-0 sm:flex-1 xl:w-[260px] xl:flex-none">
              <Input
                className="h-9 w-full pr-8"
                value={draftQuery}
                aria-label={t("tv.filterAria")}
                placeholder={t("tv.filterPlaceholder")}
                onChange={(event) => setDraftQuery(event.target.value)}
              />
              {draftQuery && (
                <button
                  type="button"
                  aria-label={t("common.clear")}
                  title={t("common.clear")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                  onClick={() => setDraftQuery("")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 sm:ml-auto xl:ml-0">
              {showToolbarSortButton && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 min-w-[108px] gap-2 px-3"
                  aria-label={`${t("tv.latestYear")} · ${sortAriaLabel}`}
                  onClick={onToggleYearSort}
                >
                  {t("tv.latestYear")}
                  <span className="text-micro" aria-hidden>{yearSortOrder === "desc" ? "↓" : "↑"}</span>
                </Button>
              )}
              <LibraryViewToggle value={viewMode} onChange={onViewModeChange} />
            </div>
          </div>
        </div>
        {pending && hasRows && <InlinePending label={t("tv.updatingResults")} />}
      </CardHeader>

      <CardContent className="relative flex min-h-0 flex-1 flex-col p-0">
        <ScrollArea viewportRef={scrollViewportRef} className={cn("min-h-0 flex-1", viewMode === "list" && "surface-subtle", pending && hasRows && "animate-pulse-soft")}>
          <div className={cn(showPager && "pb-20")}>
            {viewMode === "list" ? (
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[76px]">{t("info.poster")}</TableHead>
                    <TableHead>{t("info.title")}</TableHead>
                    <TableHead className="w-[116px]" aria-sort={ariaSort}>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        aria-label={`${t("tv.latestYear")} · ${sortAriaLabel}`}
                        onClick={onToggleYearSort}
                      >
                        {t("tv.latestYear")}
                        <span className="text-micro" aria-hidden>{yearSortOrder === "desc" ? "↓" : "↑"}</span>
                      </button>
                    </TableHead>
                    <TableHead className="hidden w-[156px] md:table-cell">{t("movie.updatedTime")}</TableHead>
                    <TableHead className="w-[92px] text-right">{t("tv.videos")}</TableHead>
                    <TableHead className="w-[112px] text-right">{t("tv.noSubtitles")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {showSkeleton && <SkeletonRows />}

                  {!showSkeleton && rows.map((row) => {
                    const displayTitle = tvSeriesDisplayTitle(row, locale) || t("nav.tv");
                    return (
                      <TableRow
                        key={row.key}
                        role="button"
                        tabIndex={operationLocked ? -1 : 0}
                        aria-label={displayTitle}
                      className={cn(
                        "row-focus",
                        operationLocked && "cursor-not-allowed opacity-65 hover:bg-transparent"
                      )}
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
                        <TableCell className="hidden truncate md:table-cell" title={formatTime(row.updatedAt)}>{formatTime(row.updatedAt)}</TableCell>
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
                  <div className="flex min-h-[var(--panel-min-h)] items-center justify-center p-6 text-center text-sm text-muted-foreground">
                    {pending ? t("tv.updatingResults") : emptyState}
                  </div>
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
          </div>
        </ScrollArea>
        {pending && hasRows && <PanelLoadingOverlay label={t("tv.refreshingSeries")} />}

        <PagerView pager={pager} onSetPage={onSetPage} disabled={pending} />
      </CardContent>
    </Card>
  );
});

TvSeriesListPanel.displayName = "TvSeriesListPanel";
