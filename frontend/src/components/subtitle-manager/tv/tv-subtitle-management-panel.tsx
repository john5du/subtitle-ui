import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, Download, ListX, PackageSearch } from "lucide-react";

import type { PendingSubtitleAction, SeasonCompleteness, TvSeasonOption, TvSeriesSummary, Video } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { requestPayload } from "@/lib/subtitle-manager/api-client";
import { tvSeriesSearchTitle } from "@/lib/subtitle-manager/media-metadata";
import { emitToast } from "@/lib/toast";
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
  const [completeness, setCompleteness] = useState<SeasonCompleteness | null>(null);
  const [completenessLoading, setCompletenessLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [missingExpanded, setMissingExpanded] = useState(false);
  useEffect(() => {
    setMissingExpanded(false);
  }, [selectedSeason, selectedSeries?.key, selectedSeries?.path]);
  const selectedSeasonLabel = seasonOptions.find((option) => option.value === selectedSeason)?.label || t("tv.selectSeason");
  const seasonNumber = useMemo(() => {
    const option = seasonOptions.find((item) => item.value === selectedSeason);
    if (typeof option?.season === "number" && Number.isFinite(option.season)) {
      return option.season;
    }
    const match = String(selectedSeason || "").match(/(\d{1,2})/);
    if (!match) {
      return null;
    }
    const n = Number.parseInt(match[1], 10);
    return Number.isFinite(n) ? n : null;
  }, [seasonOptions, selectedSeason]);
  const searchKeyword = useMemo(() => {
    if (!selectedVideo) {
      return "";
    }
    const parsed = parseVideoSeasonEpisode(selectedVideo);
    const series = (tvSeriesSearchTitle(selectedSeries) || selectedVideo.seriesOriginalTitle || selectedVideo.seriesTitle || selectedVideo.title || "").trim();
    const episodeCode = parsed ? formatSeasonEpisodeText(parsed.season, parsed.episode) : "";
    return `${series} ${episodeCode}`.trim();
  }, [selectedSeries, selectedVideo]);

  const refreshCompleteness = useCallback(async (signal?: AbortSignal) => {
    if (!selectedSeries || seasonNumber === null) {
      setCompleteness(null);
      return;
    }
    setCompletenessLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedSeries.key) {
        params.set("key", selectedSeries.key);
      }
      if (selectedSeries.path) {
        params.set("path", selectedSeries.path);
      }
      params.set("season", String(seasonNumber));
      const payload = await requestPayload<SeasonCompleteness>(`/api/tv/series/completeness?${params.toString()}`, { signal });
      if (signal?.aborted) {
        return;
      }
      setCompleteness(payload);
    } catch {
      if (signal?.aborted) {
        return;
      }
      setCompleteness(null);
    } finally {
      if (!signal?.aborted) {
        setCompletenessLoading(false);
      }
    }
  }, [selectedSeries, seasonNumber]);

  useEffect(() => {
    setActiveStep("episodes");
  }, [selectedSeries?.path]);

  useEffect(() => {
    const controller = new AbortController();
    void refreshCompleteness(controller.signal);
    return () => controller.abort();
  }, [refreshCompleteness]);

  function handleStepChange(value: string) {
    setActiveStep(value === "subtitles" ? "subtitles" : "episodes");
  }

  function handleEpisodeSelect(video: Video) {
    onSelectVideo(video);
    setActiveStep("subtitles");
  }

  async function handleSonarrSearch(options: { allMissing?: boolean; episodes?: number[] }) {
    if (!selectedSeries || seasonNumber === null || searching) {
      return;
    }
    setSearching(true);
    try {
      await requestPayload("/api/tv/series/sonarr/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: selectedSeries.key,
          path: selectedSeries.path,
          season: seasonNumber,
          allMissing: Boolean(options.allMissing),
          episodes: options.episodes ?? []
        })
      });
      emitToast({
        level: "success",
        message: t("tv.completeness.searchQueued"),
        detail: t("tv.completeness.rescanHint")
      });
      await refreshCompleteness();
    } catch (error) {
      emitToast({
        level: "error",
        message: t("tv.completeness.searchFailed"),
        detail: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setSearching(false);
    }
  }

  const showCompleteness = Boolean(completeness?.enabled);
  const missing = completeness?.missing ?? [];
  const canDownloadMissing = showCompleteness && completeness?.matched && missing.length > 0;

  const episodesPane = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex h-8 items-center gap-2">
          <Select value={selectedSeason} onValueChange={onSeasonChange} disabled={!selectedSeries || busy || episodesPending}>
            <SelectTrigger className="h-8 min-w-0 flex-1">
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
          {onOpenBatchDelete ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-10 w-10 shrink-0 touch-target sm:h-8 sm:w-8"
              disabled={!selectedSeries || busy || episodesPending || uploading}
              onClick={onOpenBatchDelete}
              title={t("tv.batchDeleteAction")}
              aria-label={t("tv.batchDeleteAction")}
            >
              <ListX className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          {onOpenSeasonBatch ? (
            <Button
              type="button"
              size="icon"
              className="h-10 w-10 shrink-0 touch-target sm:h-8 sm:w-8"
              disabled={!selectedSeries || busy || episodesPending || uploading}
              onClick={onOpenSeasonBatch}
              title={t("tv.seasonBatchAction")}
              aria-label={t("tv.seasonBatchAction")}
            >
              <PackageSearch className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
        {episodesPending && <InlinePending label={t("tv.loadingEpisodes")} />}
        {showCompleteness ? (
          <div className="mt-2 space-y-1.5">
            {completenessLoading ? (
              <div className="text-xs text-muted-foreground">{t("tv.completeness.loading")}</div>
            ) : !completeness?.matched ? (
              <div className="text-xs text-muted-foreground">{t("tv.completeness.unmatched")}</div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="tabular-nums text-muted-foreground">
                    {t("tv.completeness.summary", {
                      local: String(completeness.localCount),
                      expected: String(completeness.expectedCount)
                    })}
                  </span>
                  {completeness.complete ? (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-300">
                      {t("tv.completeness.complete")}
                    </span>
                  ) : missing.length > 0 ? (
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-800 dark:text-amber-200">
                      {t("tv.completeness.missing", { count: String(missing.length) })}
                    </span>
                  ) : null}
                  {canDownloadMissing ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 px-2 text-xs"
                      disabled={busy || searching || episodesPending}
                      onClick={() => void handleSonarrSearch({ allMissing: true })}
                    >
                      <Download className="h-3 w-3" />
                      {t("tv.completeness.downloadMissing")}
                    </Button>
                  ) : null}
                </div>
                {missing.length > 0 ? (
                  <div className="space-y-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 gap-1 px-2 text-xs text-muted-foreground"
                      onClick={() => setMissingExpanded((prev) => !prev)}
                    >
                      {missingExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      {missingExpanded
                        ? t("tv.completeness.hideMissing")
                        : t("tv.completeness.showMissing", { count: String(missing.length) })}
                    </Button>
                    {missingExpanded ? (
                      <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto overscroll-contain">
                        {missing.map((item) => (
                          <Button
                            key={item.sonarrEpisodeId || item.episode}
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 min-w-[2.75rem] gap-1 px-2 text-xs text-muted-foreground"
                            disabled={busy || searching || episodesPending}
                            title={item.title || t("tv.completeness.downloadEpisode", { episode: String(item.episode).padStart(2, "0") })}
                            onClick={() => void handleSonarrSearch({ episodes: [item.episode] })}
                          >
                            <Download className="h-3 w-3" />
                            E{String(item.episode).padStart(2, "0")}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
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
                      "surface-transition w-full rounded-[var(--radius)] px-3 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-60",
                      active
                        ? "bg-surface-strong"
                        : "bg-transparent hover:bg-surface-subtle",
                      itemBusy && "animate-pulse-soft"
                    )}
                    aria-pressed={active}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="text-xs font-semibold tabular-nums text-muted-foreground">{episodeCode}</div>
                        <div className="truncate text-sm font-semibold leading-snug">{video.title || "-"}</div>
                      </div>
                      <div className="shrink-0 pt-0.5 text-right text-xs tabular-nums text-muted-foreground">
                        {t("tv.subtitleCount", { count: video.subtitles.length })}
                      </div>
                    </div>
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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
      <div className={cn("flex h-full w-full min-h-0 flex-col overflow-hidden", className)}>
        <div className="hidden min-h-0 flex-1 overflow-hidden lg:flex">
          <div className="min-h-0 w-[280px] shrink-0 overflow-hidden border-r border-border xl:w-[300px]">{episodesPane}</div>
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{subtitlesPane}</div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:hidden">
          <Tabs value={activeStep} onValueChange={handleStepChange} className="flex min-h-0 flex-1 flex-col overflow-hidden">
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

            <TabsContent value="episodes" className="m-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden">
              {episodesPane}
            </TabsContent>

            <TabsContent value="subtitles" className="m-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden">
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
    <div className={cn("flex h-full w-full min-h-0 flex-col overflow-hidden", className)}>
      <Tabs value={activeStep} onValueChange={handleStepChange} className="flex min-h-0 flex-1 flex-col overflow-hidden">
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

        <TabsContent value="episodes" className="m-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden">
          {episodesPane}
        </TabsContent>

        <TabsContent value="subtitles" className="m-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden">
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
