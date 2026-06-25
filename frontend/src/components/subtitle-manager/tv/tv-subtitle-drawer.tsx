"use client";

import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { BatchSubtitleUploadItem, BatchSubtitleUploadResult, PendingSubtitleAction, TvSeasonOption, TvSeriesSummary, Video } from "@/lib/types";
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
  onRemove: SubtitleDetailsPanelProps["onRemove"];
  onPreviewSubtitle: SubtitleDetailsPanelProps["onPreviewSubtitle"];
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
  onRemove,
  onPreviewSubtitle,
  formatTime,
  busy,
  uploading,
  uploadingMessage,
  episodesPending,
  subtitleAction,
  drawerMode,
  onModeChange,
  onLoadBatchCandidates,
  onUploadBatch
}: TvSubtitleDrawerProps) {
  const { t } = useI18n();
  const selectedSeriesTitle = selectedSeries?.title || selectedSeries?.path || "";
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
      <div className="border-b border-border/70 bg-card/96 px-5 pb-4 pt-5 sm:px-6">
        <div className="flex flex-wrap items-start gap-3 pr-10">
          <div className="min-w-0 flex-1">
            {selectedSeriesTitle ? (
              <h2 className="truncate text-2xl font-semibold tracking-tight sm:text-[2rem]">{selectedSeriesTitle}</h2>
            ) : null}
            <TabsList className={cn("h-9 w-full max-w-[420px]", selectedSeriesTitle && "mt-3")}>
              <TabsTrigger value="manage" className="h-full flex-1" disabled={uploading && drawerMode !== "manage"}>
                {t("tv.stepSubtitles")}
              </TabsTrigger>
              <TabsTrigger value="batch" className="h-full flex-1" disabled={uploading && drawerMode !== "batch"}>
                {t("tv.seasonBatchUpload")}
              </TabsTrigger>
            </TabsList>
          </div>
          {selectedSeries ? (
            <Badge
              variant="outline"
              className="whitespace-nowrap border-input bg-transparent px-3 py-1 text-xs font-medium text-foreground"
              title={selectedSeriesCoverageLabel}
            >
              {selectedSeriesCoverageLabel}
            </Badge>
          ) : null}
        </div>
      </div>

      {!selectedSeries ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-8">
          <div className="w-full bg-surface-subtle px-6 py-12 text-center text-sm text-muted-foreground">
            {t("tv.drawerEmptySeries")}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 px-5 py-5 sm:px-6">
          <div className="flex h-full min-h-0 flex-col">
            <TabsContent value="manage" className="m-0 mt-0 flex min-h-0 flex-1 flex-col">
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
                onRemove={onRemove}
                onPreviewSubtitle={onPreviewSubtitle}
                formatTime={formatTime}
                busy={busy}
                uploading={uploading}
                uploadingMessage={uploadingMessage}
                episodesPending={episodesPending}
                subtitleAction={subtitleAction}
              />
            </TabsContent>
            <TabsContent value="batch" className="m-0 mt-0 flex min-h-0 flex-1 flex-col">
              <TvSeasonBatchUploadWorkspace
                className={cn("min-h-0 flex-1")}
                busy={busy}
                uploading={uploading}
                uploadingMessage={uploadingMessage}
                onLoadBatchCandidates={onLoadBatchCandidates}
                onUploadBatch={onUploadBatch}
                showSummary={true}
              />
            </TabsContent>
          </div>
        </div>
      )}
    </Tabs>
  );
}
