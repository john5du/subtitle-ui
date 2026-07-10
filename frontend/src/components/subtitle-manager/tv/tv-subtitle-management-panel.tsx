import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Search, Trash2 } from "lucide-react";

import type { PendingSubtitleAction, TvSeasonOption, TvSeriesSummary, Video } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { tvSeriesSearchTitle } from "@/lib/subtitle-manager/media-metadata";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { SubtitleDetailsPanelProps } from "../types";
import { InlinePending, PanelLoadingOverlay } from "../shared/pending-state";
import { SubtitleDetailsPanel } from "../subtitle/subtitle-details-panel";
import { formatSeasonEpisodeText, parseVideoSeasonEpisode } from "./batch-utils";

interface TvSubtitleManagementPanelProps {
  selectedSeries: TvSeriesSummary | null;
  selectedSeason: string;
  seasonOptions: TvSeasonOption[];
  videos: Video[];
  selectedVideo: Video | null;
  selectedVideoId: string;
  onSelectVideo: (video: Video) => void;
  onSeasonChange: (value: string) => void;
  onUpload: SubtitleDetailsPanelProps["onUpload"];
  onReplace: SubtitleDetailsPanelProps["onReplace"];
  onConvertSubtitle: SubtitleDetailsPanelProps["onConvertSubtitle"];
  onOffsetSubtitle: SubtitleDetailsPanelProps["onOffsetSubtitle"];
  onRemove: SubtitleDetailsPanelProps["onRemove"];
  onPreviewSubtitle: SubtitleDetailsPanelProps["onPreviewSubtitle"];
  onSearchSubHD?: SubtitleDetailsPanelProps["onSearchSubHD"];
  onDownloadSubHD?: SubtitleDetailsPanelProps["onDownloadSubHD"];
  onOpenSeasonBatch?: () => void;
  onOpenBatchDelete?: () => void;
  formatTime: SubtitleDetailsPanelProps["formatTime"];
  busy: boolean;
  uploading: boolean;
  uploadingMessage: string;
  episodesPending: boolean;
  subtitleAction: PendingSubtitleAction | null;
  variant?: "dialog" | "drawer";
  className?: string;
}

export function TvSubtitleManagementPanel({
  selectedSeries,
  selectedSeason,
  seasonOptions,
  videos,
  selectedVideo,
  selectedVideoId,
  onSelectVideo,
  onSeasonChange,
  onUpload,
  onReplace,
  onConvertSubtitle,
  onOffsetSubtitle,
  onRemove,
  onPreviewSubtitle,
  onSearchSubHD,
  onDownloadSubHD,
  onOpenSeasonBatch,
  onOpenBatchDelete,
  formatTime,
  busy,
  uploading,
  uploadingMessage,
  episodesPending,
  subtitleAction,
  variant = "dialog",
  className
}: TvSubtitleManagementPanelProps) {
  const { t } = useI18n();
  const [activeStep, setActiveStep] = useState<"episodes" | "subtitles">("episodes");
  const selectedSeasonLabel = seasonOptions.find((option) => option.value === selectedSeason)?.label || t("tv.selectSeason");
  const searchKeyword = useMemo(() => {
    if (!selectedVideo) {
      return "";
    }
    const parsed = parseVideoSeasonEpisode(selectedVideo);
    const series = (tvSeriesSearchTitle(selectedSeries) || selectedVideo.seriesOriginalTitle || selectedVideo.seriesTitle || selectedVideo.title || "").trim();
    const episodeCode = parsed ? formatSeasonEpisodeText(parsed.season, parsed.episode) : "";
    return `${series} ${episodeCode}`.trim();
  }, [selectedSeries, selectedVideo]);

  useEffect(() => {
    setActiveStep("episodes");
  }, [selectedSeries?.path]);

  function handleStepChange(value: string) {
    setActiveStep(value === "subtitles" ? "subtitles" : "episodes");
  }

  function handleEpisodeSelect(video: Video) {
    onSelectVideo(video);
    setActiveStep("subtitles");
  }

  const episodesPane = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-border px-3 py-3">
        <p className="text-xs font-semibold uppercase tracking-section text-foreground-muted">{t("tv.seasonLabel")}</p>
        <Select value={selectedSeason} onValueChange={onSeasonChange} disabled={!selectedSeries || busy || episodesPending}>
          <SelectTrigger className="h-9 w-full min-w-0">
            <SelectValue placeholder={t("tv.selectSeason")} />
          </SelectTrigger>
          <SelectContent>
            {seasonOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {onOpenBatchDelete || onOpenSeasonBatch ? (
          <div className="flex items-center gap-2">
            {onOpenBatchDelete ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 min-w-0 flex-1 gap-1.5 px-2.5"
                disabled={!selectedSeries || busy || episodesPending || uploading}
                onClick={onOpenBatchDelete}
                title={t("tv.batchDeleteAction")}
              >
                <Trash2 className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{t("tv.batchDeleteAction")}</span>
              </Button>
            ) : null}
            {onOpenSeasonBatch ? (
              <Button
                type="button"
                size="sm"
                className="h-9 min-w-0 flex-1 gap-1.5 px-2.5"
                disabled={!selectedSeries || busy || episodesPending || uploading}
                onClick={onOpenSeasonBatch}
                title={t("tv.seasonBatchAction")}
              >
                <Search className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{t("tv.seasonBatchAction")}</span>
              </Button>
            ) : null}
          </div>
        ) : null}
        {episodesPending && <InlinePending label={t("tv.loadingEpisodes")} />}
      </div>

      <div className="relative min-h-0 flex-1">
        <ScrollArea className={cn("h-full", episodesPending && "animate-pulse-soft")}>
          <ul className="space-y-0.5 p-2">
            {videos.map((video) => {
              const active = selectedVideoId === video.id;
              const itemBusy = subtitleAction?.videoId === video.id;
              const parsed = parseVideoSeasonEpisode(video);
              const episodeCode = parsed ? formatSeasonEpisodeText(parsed.season, parsed.episode) : "-";
              return (
                <li key={video.id}>
                  <button
                    type="button"
                    onClick={() => handleEpisodeSelect(video)}
                    disabled={busy || episodesPending}
                    className={cn(
                      "surface-transition w-full rounded-[var(--radius)] px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-60",
                      active
                        ? "bg-surface-strong shadow-[inset_3px_0_0_0_var(--input)]"
                        : "bg-transparent hover:bg-surface-subtle",
                      itemBusy && "animate-pulse-soft"
                    )}
                    aria-pressed={active}
                  >
                    <div className="text-xs font-semibold text-muted-foreground">{episodeCode}</div>
                    <div className="truncate text-sm font-semibold">{video.title || "-"}</div>
                    <div className="text-xs text-muted-foreground">{t("tv.subtitleCount", { count: video.subtitles.length })}</div>
                  </button>
                </li>
              );
            })}

            {videos.length === 0 && (
              <li className="surface-panel m-1 p-6 text-center text-sm text-muted-foreground">
                {t("tv.noEpisodesInSeason", { season: selectedSeasonLabel })}
              </li>
            )}
          </ul>
        </ScrollArea>
        {episodesPending && <PanelLoadingOverlay label={t("tv.refreshingEpisodes")} />}
      </div>
    </div>
  );

  const subtitlesPane = (
    <div className="min-h-0 flex-1">
      <SubtitleDetailsPanel
        selectedVideo={selectedVideo}
        emptyText={t("tv.selectEpisodeEmpty")}
        showBack={false}
        onBack={() => {}}
        infoRows={[]}
        onUpload={onUpload}
        onReplace={onReplace}
        onConvertSubtitle={onConvertSubtitle}
        onOffsetSubtitle={onOffsetSubtitle}
        onRemove={onRemove}
        onPreviewSubtitle={onPreviewSubtitle}
        onSearchSubHD={onSearchSubHD}
        onDownloadSubHD={onDownloadSubHD}
        formatTime={formatTime}
        busy={busy}
        uploading={uploading}
        uploadingMessage={uploadingMessage}
        subtitleAction={subtitleAction}
        showSearchLinks={true}
        searchKeyword={searchKeyword}
        showMediaType={false}
        showMetadata={false}
        showMetaSection={false}
        showPanelTitle={false}
        showSubtitleListCaption={false}
        embedded
      />
    </div>
  );

  if (variant === "drawer") {
    return (
      <div className={cn("flex h-full w-full min-h-0 flex-col", className)}>
        <div className="hidden min-h-0 flex-1 lg:flex">
          <div className="min-h-0 w-[280px] shrink-0 border-r border-border xl:w-[300px]">{episodesPane}</div>
          <div className="min-h-0 min-w-0 flex-1">{subtitlesPane}</div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col lg:hidden">
          <Tabs value={activeStep} onValueChange={handleStepChange} className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 border-b border-border px-4 py-2">
              <TabsList className="h-9 w-full">
                <TabsTrigger value="episodes" className="h-full flex-1">
                  {t("tv.stepEpisodes")}
                </TabsTrigger>
                <TabsTrigger value="subtitles" className="h-full flex-1">
                  {t("tv.stepSubtitles")}
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="episodes" className="m-0 min-h-0 flex-1 data-[state=inactive]:hidden">
              {episodesPane}
            </TabsContent>

            <TabsContent value="subtitles" className="m-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
              <div className="shrink-0 border-b border-border px-3 py-2">
                <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2" onClick={() => setActiveStep("episodes")}>
                  <ArrowLeft className="h-4 w-4" />
                  {t("tv.backToEpisodes")}
                </Button>
              </div>
              {subtitlesPane}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex h-full w-full min-h-0 flex-col", className)}>
      <Tabs value={activeStep} onValueChange={handleStepChange} className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border px-4 py-3">
          <TabsList className="h-9 w-full sm:max-w-[360px]">
            <TabsTrigger value="episodes" className="h-full flex-1">
              {t("tv.stepEpisodes")}
            </TabsTrigger>
            <TabsTrigger value="subtitles" className="h-full flex-1">
              {t("tv.stepSubtitles")}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="episodes" className="m-0 min-h-0 flex-1 data-[state=inactive]:hidden">
          {episodesPane}
        </TabsContent>

        <TabsContent value="subtitles" className="m-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          <div className="shrink-0 border-b border-border px-3 py-2">
            <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2" onClick={() => setActiveStep("episodes")}>
              <ArrowLeft className="h-4 w-4" />
              {t("tv.backToEpisodes")}
            </Button>
          </div>
          {subtitlesPane}
        </TabsContent>
      </Tabs>
    </div>
  );
}
