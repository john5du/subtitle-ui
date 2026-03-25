import { Search } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import type { Pager, TvSeriesSummary } from "@/lib/types";
import { buildSubtitleSearchLinksByKeyword } from "@/lib/subtitle-search";
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
import { RowActionsMenu } from "../shared/row-actions-menu";

interface TvSeriesListPanelProps {
  query: string;
  onQueryChange: (value: string) => void;
  rows: TvSeriesSummary[];
  pager: Pager;
  viewMode: LibraryViewMode;
  yearSortOrder: "asc" | "desc";
  onSelectSeries: (path: string) => void;
  onSetPage: (page: number) => void;
  onToggleYearSort: () => void;
  onViewModeChange: (value: LibraryViewMode) => void;
  onOpenManager: (series: TvSeriesSummary) => void;
  onOpenBatch: (series: TvSeriesSummary) => void;
  operationLocked: boolean;
  showScanPrompt: boolean;
  onTriggerScan: () => void;
  loading: boolean;
  pending: boolean;
  formatTime: (value: string | undefined | null) => string;
}

function TvSeriesPosterCard({
  row,
  onSelectSeries,
  onOpenManager,
  onOpenBatch,
  operationLocked
}: {
  row: TvSeriesSummary;
  onSelectSeries: (path: string) => void;
  onOpenManager: (series: TvSeriesSummary) => void;
  onOpenBatch: (series: TvSeriesSummary) => void;
  operationLocked: boolean;
}) {
  const { t } = useI18n();
  const links = buildSubtitleSearchLinksByKeyword(row.title);

  return (
    <div className="relative flex w-full self-start flex-col rounded-[1.35rem] border border-border/70 bg-card shadow-sm">
      <div className="absolute right-3 top-3 z-10">
        <RowActionsMenu
          label={t("tv.actionsFor", { name: row.title || t("nav.tv") })}
          triggerClassName="h-8 w-8 rounded-lg border-border bg-popover text-popover-foreground shadow-md hover:bg-popover hover:text-popover-foreground"
          items={[
            {
              label: t("tv.seasonBatchUpload"),
              onSelect: () => onOpenBatch(row),
              disabled: operationLocked
            },
            {
              label: t("tv.openSubtitleManager"),
              onSelect: () => onOpenManager(row),
              disabled: operationLocked
            },
            { label: "Zimuku", href: links.zimuku, external: true },
            { label: "SubHD", href: links.subhd, external: true }
          ]}
        />
      </div>

      <button
        type="button"
        className="flex flex-col text-left"
        aria-label={row.title || t("nav.tv")}
        onClick={() => onSelectSeries(row.path)}
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
  onSelectSeries,
  onSetPage,
  onToggleYearSort,
  onViewModeChange,
  onOpenManager,
  onOpenBatch,
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-lg">{t("tv.listTitle")}</CardTitle>
          <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap">
            <Input
              className="h-9 w-full min-w-0 sm:w-[240px]"
              value={query}
              aria-label={t("tv.filterAria")}
              placeholder={t("tv.filterPlaceholder")}
              onChange={(event) => onQueryChange(event.target.value)}
            />
            {viewMode === "card" && (
              <Button type="button" variant="outline" size="sm" className="h-9 gap-2 px-3" onClick={onToggleYearSort}>
                {t("tv.latestYear")}
                <span className="text-[10px]">{yearSortOrder === "desc" ? "↓" : "↑"}</span>
              </Button>
            )}
            <LibraryViewToggle value={viewMode} onChange={onViewModeChange} />
          </div>
        </div>
        {pending && <InlinePending label={t("tv.updatingResults")} />}
      </CardHeader>

      <CardContent className="relative flex min-h-0 flex-1 flex-col gap-3 p-4 pt-0">
        <ScrollArea className={cn("min-h-0 flex-1 rounded-md border bg-background", pending && "animate-pulse-soft")}>
          {viewMode === "list" ? (
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[76px]">{t("info.poster")}</TableHead>
                  <TableHead>{t("info.title")}</TableHead>
                  <TableHead className="w-[110px]">
                    <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={onToggleYearSort}>
                      {t("tv.latestYear")}
                      <span className="text-[10px]">{yearSortOrder === "desc" ? "↓" : "↑"}</span>
                    </button>
                  </TableHead>
                  <TableHead className="w-[170px]">{t("movie.updatedTime")}</TableHead>
                  <TableHead className="w-[100px] text-right">{t("tv.videos")}</TableHead>
                  <TableHead className="w-[120px] text-right">{t("tv.noSubtitles")}</TableHead>
                  <TableHead className="w-[120px] text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const links = buildSubtitleSearchLinksByKeyword(row.title);
                  return (
                    <TableRow
                      key={row.key}
                      className="surface-transition cursor-pointer hover:bg-accent"
                      onClick={() => onSelectSeries(row.path)}
                    >
                      <TableCell className="w-[76px] py-2">
                        <PosterThumbnail src={row.posterUrl} />
                      </TableCell>
                      <TableCell className="max-w-[240px] truncate font-medium" title={row.title}>
                        {row.title || "-"}
                      </TableCell>
                      <TableCell>{row.latestEpisodeYear || "-"}</TableCell>
                      <TableCell className="truncate" title={formatTime(row.updatedAt)}>{formatTime(row.updatedAt)}</TableCell>
                      <TableCell className="text-right">{row.videoCount}</TableCell>
                      <TableCell className="text-right">{row.noSubtitleCount}</TableCell>
                      <TableCell className="text-right">
                        <RowActionsMenu
                          label={t("tv.actionsFor", { name: row.title || t("nav.tv") })}
                          items={[
                            {
                              label: t("tv.seasonBatchUpload"),
                              onSelect: () => onOpenBatch(row),
                              disabled: operationLocked
                            },
                            {
                              label: t("tv.openSubtitleManager"),
                              onSelect: () => onOpenManager(row),
                              disabled: operationLocked
                            },
                            { label: "Zimuku", href: links.zimuku, external: true },
                            { label: "SubHD", href: links.subhd, external: true }
                          ]}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}

                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
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
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                {rows.map((row) => (
                  <TvSeriesPosterCard
                    key={row.key}
                    row={row}
                    onSelectSeries={onSelectSeries}
                    onOpenManager={onOpenManager}
                    onOpenBatch={onOpenBatch}
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
