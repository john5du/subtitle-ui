import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";

import type { PendingSubtitleAction, TvSeasonOption, TvSeriesSummary, Video } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  onRemove: SubtitleDetailsPanelProps["onRemove"];
  onPreviewSubtitle: SubtitleDetailsPanelProps["onPreviewSubtitle"];
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
  onRemove,
  onPreviewSubtitle,
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
    const series = (selectedSeries?.title || selectedVideo.title || "").trim();
    const episodeCode = parsed ? formatSeasonEpisodeText(parsed.season, parsed.episode) : "";
    return `${series} ${episodeCode}`.trim();
  }, [selectedSeries?.title, selectedVideo]);

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
    <Card className="animate-fade-in-up flex h-full min-h-0 flex-col border bg-card">
      <CardHeader className="space-y-3 p-4">
        <CardTitle className="text-lg">{t("tv.episodesTitle")}</CardTitle>
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("tv.seriesLabel")}</p>
          <p className="truncate text-sm font-semibold">{selectedSeries?.title || "-"}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("tv.seasonLabel")}</p>
          <Select value={selectedSeason} onValueChange={onSeasonChange} disabled={!selectedSeries || busy || episodesPending}>
            <SelectTrigger className="h-9">
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
        </div>
        {episodesPending && <InlinePending label={t("tv.loadingEpisodes")} />}
      </CardHeader>

      <CardContent className="relative min-h-0 flex-1 p-4 pt-0">
        <ScrollArea className={cn("h-full border bg-background", episodesPending && "animate-pulse-soft")}>
          <ul className="space-y-2 p-2">
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
                      "surface-transition w-full border px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-60",
                      active
                        ? "border-[rgba(255,255,255,0.2)] bg-[rgba(255,255,255,0.05)] shadow-[inset_3px_0_0_0_rgba(255,255,255,0.3)]"
                        : "border-[rgba(255,255,255,0.1)] bg-transparent hover:bg-[rgba(255,255,255,0.05)]",
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
              <li className="border-dashed border border-[rgba(255,255,255,0.1)] p-6 text-center text-sm text-muted-foreground">
                {t("tv.noEpisodesInSeason", { season: selectedSeasonLabel })}
              </li>
            )}
          </ul>
        </ScrollArea>
        {episodesPending && <PanelLoadingOverlay label={t("tv.refreshingEpisodes")} />}
      </CardContent>
    </Card>
  );

  const subtitlesPane = (
    <div className="min-h-0 flex-1">
      <SubtitleDetailsPanel
        panelTitle={t("tv.managementTitle")}
        selectedVideo={selectedVideo}
        emptyText={t("tv.selectEpisodeEmpty")}
        showBack={false}
        onBack={() => {}}
        infoRows={[]}
        onUpload={onUpload}
        onReplace={onReplace}
        onRemove={onRemove}
        onPreviewSubtitle={onPreviewSubtitle}
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
        showSubtitleListCaption={false}
      />
    </div>
  );

  if (variant === "drawer") {
    return (
      <div className={cn("flex h-full w-full min-h-0 flex-col", className)}>
        <div className="hidden min-h-0 flex-1 lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-4">
          <div className="min-h-0">{episodesPane}</div>
          <div className="min-h-0">{subtitlesPane}</div>
        </div>

        <div className="min-h-0 flex-1 lg:hidden">
          <Tabs value={activeStep} onValueChange={handleStepChange} className="flex min-h-0 flex-1 flex-col">
            <TabsList className="grid h-9 w-full grid-cols-2">
              <TabsTrigger value="episodes" className="h-full" disabled={activeStep === "episodes"}>
                {t("tv.stepEpisodes")}
              </TabsTrigger>
              <TabsTrigger value="subtitles" className="h-full" disabled={activeStep === "subtitles"}>
                {t("tv.stepSubtitles")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="episodes" className="mt-3 min-h-0 flex-1">
              <div className="min-h-0 h-full">{episodesPane}</div>
            </TabsContent>

            <TabsContent value="subtitles" className="mt-3 min-h-0 flex-1">
              <div className="flex h-full min-h-0 flex-col gap-3">
                <div className="flex justify-end">
                  <Button type="button" variant="outline" className="w-full gap-1 sm:w-auto" onClick={() => setActiveStep("episodes")}>
                    <ArrowLeft className="h-4 w-4" />
                    {t("tv.backToEpisodes")}
                  </Button>
                </div>
                {subtitlesPane}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex h-full w-full min-h-0 flex-col gap-3 p-3 md:p-4", className)}>
      <Tabs value={activeStep} onValueChange={handleStepChange} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="grid h-9 w-full grid-cols-2 sm:max-w-[360px]">
          <TabsTrigger value="episodes" className="h-full" disabled={activeStep === "episodes"}>
            {t("tv.stepEpisodes")}
          </TabsTrigger>
          <TabsTrigger value="subtitles" className="h-full" disabled={activeStep === "subtitles"}>
            {t("tv.stepSubtitles")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="episodes" className="mt-3 min-h-0 flex-1">
          {episodesPane}
        </TabsContent>

        <TabsContent value="subtitles" className="mt-3 min-h-0 flex-1">
          <div className="flex h-full min-h-0 flex-col gap-3">
            <div className="flex justify-end">
              <Button type="button" variant="outline" className="w-full gap-1 sm:w-auto" onClick={() => setActiveStep("episodes")}>
                <ArrowLeft className="h-4 w-4" />
                {t("tv.backToEpisodes")}
              </Button>
            </div>
            {subtitlesPane}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
