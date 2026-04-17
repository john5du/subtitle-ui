"use client";

import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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
  const selectedSeriesTitle = selectedSeries?.title || t("tv.managementTitle");

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-card">
      <div className="border-b border-border/70 bg-card/96 px-5 pb-4 pt-5 sm:px-6">
        <p className="text-display text-[11px] font-semibold uppercase tracking-[0.26em] text-[rgba(255,255,255,0.5)]">
          {t("tv.drawerEyebrow")}
        </p>
        <div className="mt-3 flex flex-wrap items-start gap-3 pr-10">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-2xl font-semibold tracking-tight sm:text-[2rem]">{selectedSeriesTitle}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={drawerMode === "manage" ? "default" : "outline"}
                disabled={uploading || drawerMode === "manage"}
                onClick={() => onModeChange("manage")}
              >
                {t("tv.stepSubtitles")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={drawerMode === "batch" ? "default" : "outline"}
                disabled={uploading || drawerMode === "batch"}
                onClick={() => onModeChange("batch")}
              >
                {t("tv.seasonBatchUpload")}
              </Button>
            </div>
          </div>
          {selectedSeries ? (
            <Badge variant="outline" className="border-[rgba(255,255,255,0.2)] bg-transparent px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-white">
              {selectedSeries.videoCount} {t("tv.videos")}
            </Badge>
          ) : null}
        </div>
      </div>

      {!selectedSeries ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-8">
          <div className="w-full border border-dashed border-border bg-[rgba(255,255,255,0.03)] px-6 py-12 text-center text-sm text-muted-foreground">
            {t("tv.drawerEmptySeries")}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 px-5 py-5 sm:px-6">
          <div className="flex h-full min-h-0 flex-col">
            {drawerMode === "manage" ? (
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
                onRemove={onRemove}
                onPreviewSubtitle={onPreviewSubtitle}
                formatTime={formatTime}
                busy={busy}
                uploading={uploading}
                uploadingMessage={uploadingMessage}
                episodesPending={episodesPending}
                subtitleAction={subtitleAction}
              />
            ) : (
              <TvSeasonBatchUploadWorkspace
                className={cn("min-h-0 flex-1")}
                busy={busy}
                uploading={uploading}
                uploadingMessage={uploadingMessage}
                onLoadBatchCandidates={onLoadBatchCandidates}
                onUploadBatch={onUploadBatch}
                showSummary={true}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
