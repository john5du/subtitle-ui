import { Search } from "lucide-react";

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

function TvSeriesPosterCard({
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
    <div className="flex w-full self-start flex-col rounded-[1.35rem] border border-border/70 bg-card shadow-sm">
      <button
        type="button"
        className="surface-transition flex flex-col text-left disabled:cursor-not-allowed disabled:opacity-65"
        aria-label={row.title || t("nav.tv")}
        disabled={operationLocked}
        onClick={() => onOpenManager(row)}
      >
        <div className="p-3 pb-0">
          <PosterThumbnail
            src={row.posterUrl}
            className="aspect-[2/3] w-full rounded-[1.1rem]"
            imageClassName="h-full w-full"
            sizes="(min-width: 1024px) 18vw, (min-width: 640px) 44vw, 92vw"
          />
        </div>
        <div className="flex items-start gap-3 p-3">
          <p className="line-clamp-2 min-w-0 flex-1 text-base font-semibold leading-6 text-foreground">
            {row.title || "-"}
          </p>
          <span className="shrink-0 pt-0.5 text-xs font-medium text-muted-foreground">{row.latestEpisodeYear || "-"}</span>
        </div>
      </button>
    </div>
  );
}

export function TvSeriesListPanel({
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
  return (
    <Card className="animate-fade-in-up flex h-full flex-col border bg-card">
      <CardHeader className="space-y-3 p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg">{t("tv.listTitle")}</CardTitle>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center xl:w-auto xl:justify-end">
            <Input
              className="h-9 w-full min-w-0 sm:flex-1 xl:w-[260px] xl:flex-none"
              value={query}
              aria-label={t("tv.filterAria")}
              placeholder={t("tv.filterPlaceholder")}
              onChange={(event) => onQueryChange(event.target.value)}
            />
            <div className="flex items-center gap-2 sm:ml-auto xl:ml-0">
              <Button type="button" variant="outline" size="sm" className="h-9 min-w-[108px] gap-2 px-3" onClick={onToggleYearSort}>
                {t("tv.latestYear")}
                <span className="text-[10px]">{yearSortOrder === "desc" ? "↓" : "↑"}</span>
              </Button>
              <LibraryViewToggle value={viewMode} onChange={onViewModeChange} />
            </div>
          </div>
        </div>
        {pending && <InlinePending label={t("tv.updatingResults")} />}
      </CardHeader>

      <CardContent className="relative flex min-h-0 flex-1 flex-col gap-3 p-4 pt-0">
        <ScrollArea className={cn("surface-subtle min-h-0 flex-1 rounded-xl", pending && "animate-pulse-soft")}>
          {viewMode === "list" ? (
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[76px]">{t("info.poster")}</TableHead>
                  <TableHead>{t("info.title")}</TableHead>
                  <TableHead className="w-[116px]">
                    <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={onToggleYearSort}>
                      {t("tv.latestYear")}
                      <span className="text-[10px]">{yearSortOrder === "desc" ? "↓" : "↑"}</span>
                    </button>
                  </TableHead>
                  <TableHead className="w-[156px]">{t("movie.updatedTime")}</TableHead>
                  <TableHead className="w-[92px] text-right">{t("tv.videos")}</TableHead>
                  <TableHead className="w-[112px] text-right">{t("tv.noSubtitles")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.key}
                    className={cn(
                      "surface-transition cursor-pointer hover:bg-accent",
                      operationLocked && "cursor-not-allowed opacity-65 hover:bg-transparent"
                    )}
                    onClick={() => {
                      if (!operationLocked) {
                        onOpenManager(row);
                      }
                    }}
                  >
                    <TableCell className="w-[76px] py-2">
                      <PosterThumbnail src={row.posterUrl} />
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate font-medium" title={row.title}>
                      {row.title || "-"}
                    </TableCell>
                    <TableCell>{row.latestEpisodeYear || "-"}</TableCell>
                    <TableCell className="truncate" title={formatTime(row.updatedAt)}>{formatTime(row.updatedAt)}</TableCell>
                    <TableCell className="text-right">{row.videoCount}</TableCell>
                    <TableCell className="text-right">{row.noSubtitleCount}</TableCell>
                  </TableRow>
                ))}

                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      {showScanPrompt ? (
                        <div className="flex flex-col items-center gap-3 text-center">
                          <p className="max-w-[320px] text-sm text-muted-foreground">
                            {t("tv.scanPrompt")}
                          </p>
                          <Button type="button" variant="outline" className="gap-2" onClick={() => void onTriggerScan()} disabled={loading}>
                            <Search className="h-4 w-4" />
                            {t("tv.scanMediaLibrary")}
                          </Button>
                        </div>
                      ) : (
                        t("tv.empty")
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          ) : rows.length === 0 ? (
            <div className="flex min-h-[320px] items-center justify-center p-6 text-center text-sm text-muted-foreground">
              {showScanPrompt ? (
                <div className="flex flex-col items-center gap-3 text-center">
                  <p className="max-w-[320px] text-sm text-muted-foreground">
                    {t("tv.scanPrompt")}
                  </p>
                  <Button type="button" variant="outline" className="gap-2" onClick={() => void onTriggerScan()} disabled={loading}>
                    <Search className="h-4 w-4" />
                    {t("tv.scanMediaLibrary")}
                  </Button>
                </div>
              ) : (
                t("tv.empty")
              )}
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
        {pending && <PanelLoadingOverlay label={t("tv.refreshingSeries")} />}

        <PagerView pager={pager} onSetPage={onSetPage} disabled={pending} />
      </CardContent>
    </Card>
  );
}
