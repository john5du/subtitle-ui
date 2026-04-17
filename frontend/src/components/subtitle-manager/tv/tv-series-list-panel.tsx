import { memo, useCallback, useDeferredValue, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { Search, X } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import type { Pager, TvSeriesSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import type { LibraryViewMode } from "../types";
import { LibraryViewToggle } from "../shared/library-view-toggle";
import { InlinePending, PanelLoadingOverlay } from "../shared/pending-state";
import { PagerView } from "../shared/pager-view";
import { PosterThumbnail } from "../shared/poster-thumbnail";

interface TvSeriesListPanelProps {
  query: string;
  onQueryChange: (value: string) => void;
  rows: TvSeriesSummary[];
  pager: Pager;
  viewMode: LibraryViewMode;
  yearSortOrder: "asc" | "desc";
  onSetPage: (page: number) => void;
  onToggleYearSort: () => void;
  onViewModeChange: (value: LibraryViewMode) => void;
  onOpenManager: (series: TvSeriesSummary) => void;
  operationLocked: boolean;
  showScanPrompt: boolean;
  onTriggerScan: () => void;
  loading: boolean;
  pending: boolean;
  formatTime: (value: string | undefined | null) => string;
}

const rowFocusClass = "surface-transition cursor-pointer outline-none hover:bg-accent focus-visible:bg-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-input";

const TvSeriesPosterCard = memo(function TvSeriesPosterCard({
  row,
  onOpenManager,
  operationLocked
}: {
  row: TvSeriesSummary;
  onOpenManager: (series: TvSeriesSummary) => void;
  operationLocked: boolean;
}) {
  const { t } = useI18n();

  return (
    <div className="flex w-full min-w-0 self-start flex-col border border-border bg-surface-subtle">
      <button
        type="button"
        className="surface-transition flex w-full min-w-0 flex-col text-left disabled:cursor-not-allowed disabled:opacity-65"
        aria-label={row.title || t("nav.tv")}
        disabled={operationLocked}
        onClick={() => onOpenManager(row)}
      >
        <div className="p-3 pb-0">
          <PosterThumbnail
            src={row.posterUrl}
            className="aspect-[2/3] w-full"
            imageClassName="h-full w-full"
            sizes="(min-width: 1024px) 18vw, (min-width: 640px) 44vw, 92vw"
          />
        </div>
        <div className="flex flex-col gap-0.5 p-3">
          <p className="line-clamp-2 min-w-0 text-base font-semibold leading-6 text-foreground">
            {row.title || "-"}
          </p>
          {row.latestEpisodeYear ? (
            <span className="text-xs font-medium text-muted-foreground">{row.latestEpisodeYear}</span>
          ) : null}
        </div>
      </button>
    </div>
  );
});

TvSeriesPosterCard.displayName = "TvSeriesPosterCard";

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
  onToggleYearSort,
  onViewModeChange,
  onOpenManager,
  operationLocked,
  showScanPrompt,
  onTriggerScan,
  loading,
  pending,
  formatTime
}: TvSeriesListPanelProps) {
  const { t } = useI18n();
  const [draftQuery, setDraftQuery] = useState(query);
  const deferredQuery = useDeferredValue(draftQuery);
  const lastPublishedRef = useRef(query);

  useEffect(() => {
    if (query !== draftQuery) {
      setDraftQuery(query);
      lastPublishedRef.current = query;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    if (deferredQuery !== lastPublishedRef.current) {
      lastPublishedRef.current = deferredQuery;
      onQueryChange(deferredQuery);
    }
  }, [deferredQuery, onQueryChange]);

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

  const emptyState = showScanPrompt ? (
    <div className="flex flex-col items-center gap-3 text-center">
      <p className="max-w-[320px] text-sm text-muted-foreground">{t("tv.scanPrompt")}</p>
      <Button type="button" variant="outline" className="gap-2" onClick={() => void onTriggerScan()} disabled={loading}>
        <Search className="h-4 w-4" />
        {t("tv.scanMediaLibrary")}
      </Button>
    </div>
  ) : (
    <span>{t("tv.empty")}</span>
  );

  return (
    <Card className="animate-fade-in-up flex h-full flex-col border bg-card">
      <CardHeader className="space-y-3 p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg">{t("tv.listTitle")}</CardTitle>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center xl:w-auto xl:justify-end">
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
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-white"
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
                  <span className="text-[10px]" aria-hidden>{yearSortOrder === "desc" ? "↓" : "↑"}</span>
                </Button>
              )}
              <LibraryViewToggle value={viewMode} onChange={onViewModeChange} />
            </div>
          </div>
        </div>
        {pending && hasRows && <InlinePending label={t("tv.updatingResults")} />}
      </CardHeader>

      <CardContent className="relative flex min-h-0 flex-1 flex-col gap-3 p-4 pt-0">
        <ScrollArea className={cn("surface-subtle min-h-0 flex-1", pending && hasRows && "animate-pulse-soft")}>
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
                      <span className="text-[10px]" aria-hidden>{yearSortOrder === "desc" ? "↓" : "↑"}</span>
                    </button>
                  </TableHead>
                  <TableHead className="hidden w-[156px] md:table-cell">{t("movie.updatedTime")}</TableHead>
                  <TableHead className="w-[92px] text-right">{t("tv.videos")}</TableHead>
                  <TableHead className="w-[112px] text-right">{t("tv.noSubtitles")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {showSkeleton && <SkeletonRows />}

                {!showSkeleton && rows.map((row) => (
                  <TableRow
                    key={row.key}
                    role="button"
                    tabIndex={operationLocked ? -1 : 0}
                    aria-label={row.title || t("nav.tv")}
                    className={cn(
                      rowFocusClass,
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
                    <TableCell className="max-w-[260px] truncate font-medium" title={row.title}>
                      {row.title || "-"}
                    </TableCell>
                    <TableCell>{row.latestEpisodeYear || "-"}</TableCell>
                    <TableCell className="hidden truncate md:table-cell" title={formatTime(row.updatedAt)}>{formatTime(row.updatedAt)}</TableCell>
                    <TableCell className="text-right">{row.videoCount}</TableCell>
                    <TableCell className="text-right">{row.noSubtitleCount}</TableCell>
                  </TableRow>
                ))}

                {!showSkeleton && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      {emptyState}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          ) : rows.length === 0 ? (
            <div className="flex min-h-[320px] items-center justify-center p-6 text-center text-sm text-muted-foreground">
              {pending ? t("tv.updatingResults") : emptyState}
            </div>
          ) : (
            <div className="p-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {rows.map((row) => (
                  <TvSeriesPosterCard
                    key={row.key}
                    row={row}
                    onOpenManager={onOpenManager}
                    operationLocked={operationLocked}
                  />
                ))}
              </div>
            </div>
          )}
        </ScrollArea>
        {pending && hasRows && <PanelLoadingOverlay label={t("tv.refreshingSeries")} />}

        <PagerView pager={pager} onSetPage={onSetPage} disabled={pending} />
      </CardContent>
    </Card>
  );
});

TvSeriesListPanel.displayName = "TvSeriesListPanel";
