import { useI18n } from "@/lib/i18n";
import type { Pager, Video } from "@/lib/types";
import { buildSubtitleSearchLinks } from "@/lib/subtitle-search";
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

interface MovieListPanelProps {
  query: string;
  onQueryChange: (value: string) => void;
  videos: Video[];
  pager: Pager;
  viewMode: LibraryViewMode;
  yearSortOrder: "asc" | "desc";
  onToggleYearSort: () => void;
  onViewModeChange: (value: LibraryViewMode) => void;
  onSelectVideo: (video: Video) => void;
  onSetPage: (page: number) => void;
  onOpenUploadPicker: (video: Video) => void;
  onOpenManager: (video: Video) => void;
  operationLocked: boolean;
  pending: boolean;
  formatTime: (value: string | undefined | null) => string;
}

function MoviePosterCard({
  video,
  onSelectVideo,
  onOpenUploadPicker,
  onOpenManager,
  operationLocked
}: {
  video: Video;
  onSelectVideo: (video: Video) => void;
  onOpenUploadPicker: (video: Video) => void;
  onOpenManager: (video: Video) => void;
  operationLocked: boolean;
}) {
  const { t } = useI18n();
  const links = buildSubtitleSearchLinks(video);

  return (
    <div className="relative flex w-full self-start flex-col rounded-[1.35rem] border border-border/70 bg-card shadow-sm">
      <div className="absolute right-3 top-3 z-10">
        <RowActionsMenu
          label={t("movie.actionsFor", { name: video.title || video.fileName || t("info.movie") })}
          triggerClassName="h-8 w-8 rounded-lg border-border bg-popover text-popover-foreground shadow-md hover:bg-popover hover:text-popover-foreground"
          items={[
            {
              label: t("movie.uploadSubtitleArchive"),
              onSelect: () => onOpenUploadPicker(video),
              disabled: operationLocked
            },
            {
              label: t("movie.openSubtitleManager"),
              onSelect: () => onOpenManager(video),
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
        aria-label={video.title || video.fileName || t("info.movie")}
        onClick={() => onSelectVideo(video)}
      >
        <div className="p-3 pb-0">
          <PosterThumbnail
            src={video.posterUrl}
            className="aspect-[2/3] w-full rounded-[1.1rem]"
            imageClassName="h-full w-full"
            sizes="(min-width: 1024px) 18vw, (min-width: 640px) 44vw, 92vw"
          />
        </div>
        <div className="flex items-start gap-3 p-3">
          <p className="line-clamp-2 min-w-0 flex-1 text-base font-semibold leading-6 text-foreground">
            {video.title || video.fileName || "-"}
          </p>
          <span className="shrink-0 pt-0.5 text-xs font-medium text-muted-foreground">{video.year || "-"}</span>
        </div>
      </button>
    </div>
  );
}

export function MovieListPanel({
  query,
  onQueryChange,
  videos,
  pager,
  viewMode,
  yearSortOrder,
  onToggleYearSort,
  onViewModeChange,
  onSelectVideo,
  onSetPage,
  onOpenUploadPicker,
  onOpenManager,
  operationLocked,
  pending,
  formatTime
}: MovieListPanelProps) {
  const { t } = useI18n();
  return (
    <Card className="animate-fade-in-up flex h-full flex-col border bg-card">
      <CardHeader className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-lg">{t("movie.listTitle")}</CardTitle>
          <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap">
            <Input
              className="h-9 w-full min-w-0 sm:w-[240px]"
              value={query}
              aria-label={t("movie.filterAria")}
              placeholder={t("movie.filterPlaceholder")}
              onChange={(event) => onQueryChange(event.target.value)}
            />
            {viewMode === "card" && (
              <Button type="button" variant="outline" size="sm" className="h-9 gap-2 px-3" onClick={onToggleYearSort}>
                {t("info.year")}
                <span className="text-[10px]">{yearSortOrder === "desc" ? "↓" : "↑"}</span>
              </Button>
            )}
            <LibraryViewToggle value={viewMode} onChange={onViewModeChange} />
          </div>
        </div>
        {pending && <InlinePending label={t("movie.updatingResults")} />}
      </CardHeader>

      <CardContent className="relative flex min-h-0 flex-1 flex-col gap-3 p-4 pt-0">
        <ScrollArea className={cn("min-h-0 flex-1 rounded-md border bg-background", pending && "animate-pulse-soft")}>
          {viewMode === "list" ? (
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[76px]">{t("info.poster")}</TableHead>
                  <TableHead>{t("info.title")}</TableHead>
                  <TableHead className="w-[90px]">
                    <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={onToggleYearSort}>
                      {t("info.year")}
                      <span className="text-[10px]">{yearSortOrder === "desc" ? "↓" : "↑"}</span>
                    </button>
                  </TableHead>
                  <TableHead className="w-[170px]">{t("movie.updatedTime")}</TableHead>
                  <TableHead className="w-[100px] text-right">{t("movie.subtitles")}</TableHead>
                  <TableHead className="w-[360px]">{t("movie.fileName")}</TableHead>
                  <TableHead className="w-[120px] text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {videos.map((video) => {
                  const links = buildSubtitleSearchLinks(video);
                  return (
                    <TableRow
                      key={video.id}
                      className="surface-transition cursor-pointer hover:bg-accent"
                      onClick={() => onSelectVideo(video)}
                    >
                      <TableCell className="w-[76px] py-2">
                        <PosterThumbnail src={video.posterUrl} />
                      </TableCell>
                      <TableCell className="max-w-[240px] truncate font-medium" title={video.title}>
                        {video.title || "-"}
                      </TableCell>
                      <TableCell>{video.year || "-"}</TableCell>
                      <TableCell>{formatTime(video.updatedAt)}</TableCell>
                      <TableCell className="text-right">{video.subtitles.length}</TableCell>
                      <TableCell className="max-w-[360px] truncate" title={video.fileName}>
                        {video.fileName || "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <RowActionsMenu
                          label={t("movie.actionsFor", { name: video.title || video.fileName || t("info.movie") })}
                          items={[
                            {
                              label: t("movie.uploadSubtitleArchive"),
                              onSelect: () => onOpenUploadPicker(video),
                              disabled: operationLocked
                            },
                            {
                              label: t("movie.openSubtitleManager"),
                              onSelect: () => onOpenManager(video),
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

                {videos.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      {t("movie.empty")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          ) : videos.length === 0 ? (
            <div className="flex min-h-[320px] items-center justify-center p-6 text-center text-sm text-muted-foreground">
              {t("movie.empty")}
            </div>
          ) : (
            <div className="p-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                {videos.map((video) => (
                  <MoviePosterCard
                    key={video.id}
                    video={video}
                    onSelectVideo={onSelectVideo}
                    onOpenUploadPicker={onOpenUploadPicker}
                    onOpenManager={onOpenManager}
                    operationLocked={operationLocked}
                  />
                ))}
              </div>
            </div>
          )}
        </ScrollArea>
        {pending && <PanelLoadingOverlay label={t("movie.updatingResults")} />}

        <PagerView pager={pager} onSetPage={onSetPage} disabled={pending} />
      </CardContent>
    </Card>
  );
}
