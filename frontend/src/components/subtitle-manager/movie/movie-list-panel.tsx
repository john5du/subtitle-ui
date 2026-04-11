import { useI18n } from "@/lib/i18n";
import type { Pager, Video } from "@/lib/types";
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

interface MovieListPanelProps {
  query: string;
  onQueryChange: (value: string) => void;
  videos: Video[];
  pager: Pager;
  viewMode: LibraryViewMode;
  yearSortOrder: "asc" | "desc";
  onToggleYearSort: () => void;
  onViewModeChange: (value: LibraryViewMode) => void;
  onSetPage: (page: number) => void;
  onOpenManager: (video: Video) => void;
  operationLocked: boolean;
  pending: boolean;
  formatTime: (value: string | undefined | null) => string;
}

function MoviePosterCard({
  video,
  onOpenManager,
  operationLocked
}: {
  video: Video;
  onOpenManager: (video: Video) => void;
  operationLocked: boolean;
}) {
  const { t } = useI18n();

  return (
    <div className="flex w-full min-w-0 self-start flex-col border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)]">
      <button
        type="button"
        className="surface-transition flex w-full min-w-0 flex-col text-left disabled:cursor-not-allowed disabled:opacity-65"
        aria-label={video.title || video.fileName || t("info.movie")}
        disabled={operationLocked}
        onClick={() => onOpenManager(video)}
      >
        <div className="p-3 pb-0">
          <PosterThumbnail
            src={video.posterUrl}
            className="aspect-[2/3] w-full"
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
  onSetPage,
  onOpenManager,
  operationLocked,
  pending,
  formatTime
}: MovieListPanelProps) {
  const { t } = useI18n();
  return (
    <Card className="animate-fade-in-up flex h-full flex-col border bg-card">
      <CardHeader className="space-y-3 p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg">{t("movie.listTitle")}</CardTitle>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center xl:w-auto xl:justify-end">
            <Input
              className="h-9 w-full min-w-0 sm:flex-1 xl:w-[260px] xl:flex-none"
              value={query}
              aria-label={t("movie.filterAria")}
              placeholder={t("movie.filterPlaceholder")}
              onChange={(event) => onQueryChange(event.target.value)}
            />
            <div className="flex items-center gap-2 sm:ml-auto xl:ml-0">
              <Button type="button" variant="outline" size="sm" className="h-9 min-w-[88px] gap-2 px-3" onClick={onToggleYearSort}>
                {t("info.year")}
                <span className="text-[10px]">{yearSortOrder === "desc" ? "↓" : "↑"}</span>
              </Button>
              <LibraryViewToggle value={viewMode} onChange={onViewModeChange} />
            </div>
          </div>
        </div>
        {pending && <InlinePending label={t("movie.updatingResults")} />}
      </CardHeader>

      <CardContent className="relative flex min-h-0 flex-1 flex-col gap-3 p-4 pt-0">
        <ScrollArea className={cn("surface-subtle min-h-0 flex-1", pending && "animate-pulse-soft")}>
          {viewMode === "list" ? (
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[76px]">{t("info.poster")}</TableHead>
                  <TableHead>{t("info.title")}</TableHead>
                  <TableHead className="w-[96px]">
                    <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={onToggleYearSort}>
                      {t("info.year")}
                      <span className="text-[10px]">{yearSortOrder === "desc" ? "↓" : "↑"}</span>
                    </button>
                  </TableHead>
                  <TableHead className="w-[156px]">{t("movie.updatedTime")}</TableHead>
                  <TableHead className="w-[92px] text-right">{t("movie.subtitles")}</TableHead>
                  <TableHead className="w-[320px]">{t("movie.fileName")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {videos.map((video) => (
                  <TableRow
                    key={video.id}
                    className={cn(
                      "surface-transition cursor-pointer hover:bg-accent",
                      operationLocked && "cursor-not-allowed opacity-65 hover:bg-transparent"
                    )}
                    onClick={() => {
                      if (!operationLocked) {
                        onOpenManager(video);
                      }
                    }}
                  >
                    <TableCell className="w-[76px] py-2">
                      <PosterThumbnail src={video.posterUrl} />
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate font-medium" title={video.title}>
                      {video.title || "-"}
                    </TableCell>
                    <TableCell>{video.year || "-"}</TableCell>
                    <TableCell>{formatTime(video.updatedAt)}</TableCell>
                    <TableCell className="text-right">{video.subtitles.length}</TableCell>
                    <TableCell className="max-w-[320px] truncate" title={video.fileName}>
                      {video.fileName || "-"}
                    </TableCell>
                  </TableRow>
                ))}

                {videos.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
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
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {videos.map((video) => (
                  <MoviePosterCard
                    key={video.id}
                    video={video}
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
