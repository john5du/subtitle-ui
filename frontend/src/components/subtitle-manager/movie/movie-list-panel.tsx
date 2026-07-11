import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { PanelLeftClose, PanelLeftOpen, RefreshCw, X } from "lucide-react";

import { useMediaQuery } from "@/hooks/use-media-query";
import { useI18n } from "@/lib/i18n";
import type { Pager, Video } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import type { MovieSortBy } from "@/hooks/use-subtitle-manager/types";
import type { LibraryViewMode } from "../types";
import { CARD_GRID_CLASS, cardGridPageSize } from "../shared/card-grid";
import { LibraryPosterCard } from "../shared/library-poster-card";
import { LibrarySortControl, type LibrarySortOption } from "../shared/library-sort-control";
import { LibraryViewToggle } from "../shared/library-view-toggle";
import { InlinePending, PanelLoadingOverlay, SpinnerIcon } from "../shared/pending-state";
import { PagerView } from "../shared/pager-view";
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
          <TableCell><div className="h-4 w-10 animate-pulse-soft bg-surface-hover" /></TableCell>
          <TableCell className="hidden md:table-cell"><div className="h-4 w-24 animate-pulse-soft bg-surface-hover" /></TableCell>
          <TableCell className="text-right"><div className="ml-auto h-4 w-6 animate-pulse-soft bg-surface-hover" /></TableCell>
          <TableCell className="hidden lg:table-cell"><div className="h-4 w-48 animate-pulse-soft bg-surface-hover" /></TableCell>
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
  const [draftQuery, setDraftQuery] = useState(query);
  const lastPublishedRef = useRef(query);
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const onPageSizeChangeRef = useRef(onPageSizeChange);
  onPageSizeChangeRef.current = onPageSizeChange;

  const handleCardColumnsChange = useCallback((columns: number) => {
    onPageSizeChangeRef.current(cardGridPageSize(columns));
  }, []);

  const { measureRef } = useCardGridColumns(effectiveViewMode === "card", handleCardColumnsChange);

  useEffect(() => {
    if (query !== draftQuery) {
      setDraftQuery(query);
      lastPublishedRef.current = query;
    }
    // only sync from parent-controlled query
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
  const showPager = Math.max(1, pager.totalPages) > 1 || pager.total > 0;

  return (
    <Card className="surface-panel animate-fade-in-up flex h-full flex-col">
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="hidden items-center gap-2 lg:flex">
            {onToggleSidebar && sidebarToggleLabel ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={onToggleSidebar}
                aria-label={sidebarToggleLabel}
                title={sidebarToggleLabel}
              >
                {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              </Button>
            ) : null}
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
          </div>
          <div className="flex w-full min-w-0 items-center gap-2 sm:justify-end xl:w-auto">
            <div className="relative min-w-0 flex-1 xl:w-[260px] xl:flex-none">
              <Input
                className="h-9 w-full pr-8"
                value={draftQuery}
                aria-label={t("movie.filterAria")}
                placeholder={t("movie.filterPlaceholder")}
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
            <div className="flex shrink-0 items-center gap-2">
              <LibrarySortControl
                value={sortBy}
                order={sortOrder}
                options={MOVIE_SORT_OPTIONS}
                onValueChange={onSortByChange}
                onToggleOrder={onToggleSortOrder}
              />
              <LibraryViewToggle value={viewMode} onChange={onViewModeChange} />
            </div>
          </div>
        </div>
        {pending && hasVideos && <InlinePending label={t("movie.updatingResults")} />}
      </CardHeader>

      <CardContent className="relative flex min-h-0 flex-1 flex-col p-0">
        <ScrollArea viewportRef={scrollViewportRef} className={cn("min-h-0 flex-1", effectiveViewMode === "list" && "surface-subtle", pending && hasVideos && "animate-pulse-soft")}>
          <div className={cn(showPager && "pb-20")}>
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

                  {!showSkeleton && videos.map((video) => (
                    <TableRow
                      key={video.id}
                      role="button"
                      tabIndex={operationLocked ? -1 : 0}
                      aria-label={video.title || video.fileName || t("info.movie")}
                      className={cn(
                        "row-focus",
                        operationLocked && "cursor-not-allowed opacity-65 hover:bg-transparent"
                      )}
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
                  <div className="flex min-h-[var(--panel-min-h)] items-center justify-center p-6 text-center text-sm text-muted-foreground">
                    {pending ? t("movie.updatingResults") : t("movie.empty")}
                  </div>
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
          </div>
        </ScrollArea>
        {pending && hasVideos && <PanelLoadingOverlay label={t("movie.updatingResults")} />}

        <PagerView pager={pager} onSetPage={onSetPage} disabled={pending} />
      </CardContent>
    </Card>
  );
});

MovieListPanel.displayName = "MovieListPanel";
