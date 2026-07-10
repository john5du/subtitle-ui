"use client";

import { useI18n } from "@/lib/i18n";
import { tvSeriesDisplayTitleParts } from "@/lib/subtitle-manager/media-metadata";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { MediaExternalLinks } from "../shared/media-external-links";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type {
  BatchSubtitleUploadItem,
  BatchSubtitleUploadResult,
  PendingSubtitleAction,
  SubHDSearchPage,
  SubHDSeasonInstallOptions,
  SubHDSeasonPacksResult,
  SubHDSeasonPrepareOptions,
  SubHDSeasonPrepareResult,
  TvSeasonOption,
  TvSeriesSummary,
  Video
} from "@/lib/types";
import type { SubtitleDetailsPanelProps, TvDrawerMode } from "../types";
import { TvSeasonBatchUploadWorkspace } from "./tv-season-batch-upload-dialog";
import { TvSubtitleManagementPanel } from "./tv-subtitle-management-panel";

interface TvSubtitleDrawerProps {
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
  formatTime: SubtitleDetailsPanelProps["formatTime"];
  busy: boolean;
  uploading: boolean;
  uploadingMessage: string;
  episodesPending: boolean;
  subtitleAction: PendingSubtitleAction | null;
  drawerMode: TvDrawerMode;
  onModeChange: (mode: TvDrawerMode) => void;
  onLoadBatchCandidates: () => Promise<Video[]>;
  onUploadBatch: (items: BatchSubtitleUploadItem[]) => Promise<BatchSubtitleUploadResult>;
  onSearchSubHDForBatch?: (video: Video, opts?: { query?: string; page?: number }) => Promise<SubHDSearchPage>;
  onSearchSubHDSeasonPacks?: (video: Video, opts?: { query?: string; season?: number }) => Promise<SubHDSeasonPacksResult>;
  onPrepareSubHDSeason?: (options: SubHDSeasonPrepareOptions) => Promise<SubHDSeasonPrepareResult>;
  onInstallSubHDSeason?: (options: SubHDSeasonInstallOptions) => Promise<BatchSubtitleUploadResult>;
}

export function TvSubtitleDrawer({
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
  formatTime,
  busy,
  uploading,
  uploadingMessage,
  episodesPending,
  subtitleAction,
  drawerMode,
  onModeChange,
  onLoadBatchCandidates,
  onUploadBatch,
  onSearchSubHDForBatch,
  onSearchSubHDSeasonPacks,
  onPrepareSubHDSeason,
  onInstallSubHDSeason
}: TvSubtitleDrawerProps) {
  const { t, locale } = useI18n();
  const selectedSeriesTitle = tvSeriesDisplayTitleParts(selectedSeries, locale);
  const selectedSeriesPrimaryTitle = selectedSeriesTitle.title || selectedSeries?.path || "";
  const selectedSeriesFullTitle = selectedSeriesTitle.fullTitle || selectedSeriesPrimaryTitle;
  const selectedSeriesSubtitledCount = selectedSeries ? Math.max(selectedSeries.videoCount - selectedSeries.noSubtitleCount, 0) : 0;
  const selectedSeriesCoverageLabel = selectedSeries
    ? t("tv.subtitleCoverage", { subtitled: selectedSeriesSubtitledCount, total: selectedSeries.videoCount })
    : "";

  function handleModeChange(value: string) {
    if (value === "manage" || value === "batch") {
      onModeChange(value);
    }
  }

  return (
    <Tabs value={drawerMode} onValueChange={handleModeChange} className="flex h-full min-h-0 w-full flex-col bg-card">
      <div className="shrink-0 space-y-3 border-b border-border px-5 py-4 pr-12 sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {selectedSeriesPrimaryTitle ? (
              <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <h2 className="min-w-0 max-w-full truncate text-lg font-semibold tracking-tight sm:text-xl" title={selectedSeriesFullTitle}>
                  {selectedSeriesPrimaryTitle}
                  {selectedSeriesTitle.secondaryTitle ? (
                    <span className="ml-2 align-baseline text-sm font-medium text-muted-foreground sm:text-base">
                      {selectedSeriesTitle.secondaryTitle}
                    </span>
                  ) : null}
                </h2>
                {selectedSeries ? (
                  <MediaExternalLinks imdbId={selectedSeries.imdbId} tmdbId={selectedSeries.tmdbId} mediaType="tv" />
                ) : null}
              </div>
            ) : null}
          </div>
          {selectedSeries ? (
            <Badge variant="secondary" className="shrink-0 whitespace-nowrap" title={selectedSeriesCoverageLabel}>
              {selectedSeriesCoverageLabel}
            </Badge>
          ) : null}
        </div>
        <TabsList className="h-9 w-full max-w-[420px]">
          <TabsTrigger value="manage" className="h-full flex-1" disabled={uploading && drawerMode !== "manage"}>
            {t("tv.stepSubtitles")}
          </TabsTrigger>
          <TabsTrigger value="batch" className="h-full flex-1" disabled={uploading && drawerMode !== "batch"}>
            {t("tv.seasonBatchUpload")}
          </TabsTrigger>
        </TabsList>
      </div>

      {!selectedSeries ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <div className="surface-panel w-full px-6 py-12 text-center text-sm text-muted-foreground">
            {t("tv.drawerEmptySeries")}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <TabsContent value="manage" className="m-0 flex h-full min-h-0 flex-col data-[state=inactive]:hidden">
            <TvSubtitleManagementPanel
              className="min-h-0 flex-1"
              variant="drawer"
              selectedSeries={selectedSeries}
              selectedSeason={selectedSeason}
              seasonOptions={seasonOptions}
              videos={videos}
              selectedVideo={selectedVideo}
              selectedVideoId={selectedVideoId}
              onSelectVideo={onSelectVideo}
              onSeasonChange={onSeasonChange}
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
              episodesPending={episodesPending}
              subtitleAction={subtitleAction}
            />
          </TabsContent>
          <TabsContent value="batch" className="m-0 flex h-full min-h-0 flex-col data-[state=inactive]:hidden">
            <div className="min-h-0 flex-1 px-5 py-4 sm:px-6">
              <TvSeasonBatchUploadWorkspace
                className={cn("min-h-0 h-full flex-1")}
                busy={busy}
                uploading={uploading}
                uploadingMessage={uploadingMessage}
                onLoadBatchCandidates={onLoadBatchCandidates}
                onUploadBatch={onUploadBatch}
                selectedSeries={selectedSeries}
                selectedSeason={selectedSeason}
                seasonVideos={videos}
                onSearchSubHD={onSearchSubHDForBatch}
                onSearchSubHDSeasonPacks={onSearchSubHDSeasonPacks}
                onPrepareSubHDSeason={onPrepareSubHDSeason}
                onInstallSubHDSeason={onInstallSubHDSeason}
                showSummary={true}
              />
            </div>
          </TabsContent>
        </div>
      )}
    </Tabs>
  );
}
