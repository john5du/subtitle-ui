"use client";

import { useEffect, useState } from "react";

import { useI18n } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { MediaExternalLinks } from "../shared/media-external-links";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { DialogHelpTip } from "@/components/ui/dialog-help-tip";

import type {
  BatchSubtitleDeleteItem,
  BatchSubtitleUploadItem,
  BatchSubtitleUploadResult,
  PendingSubtitleAction,
  SubHDSeasonInstallOptions,
  SubHDSeasonPacksResult,
  SubHDSeasonPrepareOptions,
  SubHDSeasonPrepareResult,
  TvSeasonOption,
  TvSeriesSummary,
  Video
} from "@/lib/types";
import type { SubtitleDetailsPanelProps, TvDrawerMode } from "../types";
import { tvSeriesDisplayTitleParts } from "@/lib/subtitle-manager/media-metadata";
import { TvBatchDeleteDialog } from "./tv-batch-delete-dialog";
import { TvSeasonBatchUploadWorkspace } from "./tv-season-batch-upload-dialog";
import { TvSubtitleManagementPanel } from "./tv-subtitle-management-panel";

interface TvSubtitleDrawerProps {
  selectedSeries: TvSeriesSummary | null;
  selectedSeason: string;
  seasonOptions: TvSeasonOption[];
  videos: Video[];
  seriesVideos: Video[];
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
  onDeleteBatch: (items: BatchSubtitleDeleteItem[]) => Promise<BatchSubtitleUploadResult>;
  onSearchSubHDSeasonPacks?: (video: Video, opts?: { query?: string; season?: number }) => Promise<SubHDSeasonPacksResult>;
  onPrepareSubHDSeason?: (options: SubHDSeasonPrepareOptions) => Promise<SubHDSeasonPrepareResult>;
  onInstallSubHDSeason?: (options: SubHDSeasonInstallOptions) => Promise<BatchSubtitleUploadResult>;
  onRefreshVideo?: (video: Video) => Promise<void>;
  onRefreshSeriesVideos?: (seriesPath: string) => Promise<void>;
}

export function TvSubtitleDrawer({
  selectedSeries,
  selectedSeason,
  seasonOptions,
  videos,
  seriesVideos,
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
  onDeleteBatch,
  onSearchSubHDSeasonPacks,
  onPrepareSubHDSeason,
  onInstallSubHDSeason,
  onRefreshVideo,
  onRefreshSeriesVideos
}: TvSubtitleDrawerProps) {
  const { t, locale } = useI18n();
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const selectedSeriesTitle = tvSeriesDisplayTitleParts(selectedSeries, locale);
  const selectedSeriesPrimaryTitle = selectedSeriesTitle.title || selectedSeries?.path || "";
  const selectedSeriesFullTitle = selectedSeriesTitle.fullTitle || selectedSeriesPrimaryTitle;
  const selectedSeriesSubtitledCount = selectedSeries ? Math.max(selectedSeries.videoCount - selectedSeries.noSubtitleCount, 0) : 0;
  const selectedSeriesCoverageLabel = selectedSeries
    ? t("tv.subtitleCoverage", { subtitled: selectedSeriesSubtitledCount, total: selectedSeries.videoCount })
    : "";
  const seasonLabel = seasonOptions.find((option) => option.value === selectedSeason)?.label || selectedSeason;

  useEffect(() => {
    if (drawerMode === "batch" && selectedSeries) {
      setBatchDialogOpen(true);
    }
  }, [drawerMode, selectedSeries]);

  function openSeasonBatch() {
    setBatchDialogOpen(true);
    onModeChange("batch");
  }

  function openBatchDelete() {
    setBatchDeleteOpen(true);
  }

  function handleBatchDialogOpenChange(open: boolean) {
    setBatchDialogOpen(open);
    if (!open) {
      onModeChange("manage");
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-card">
      <div className="shrink-0 space-y-2 border-b border-border px-5 py-4 pr-14 sm:px-6 sm:pr-16">
        <div className="min-w-0 space-y-2">
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
                <Badge variant="secondary" className="shrink-0 whitespace-nowrap px-1.5 py-0 text-[10px] normal-case tracking-normal" title={selectedSeriesCoverageLabel}>
                  {selectedSeriesCoverageLabel}
                </Badge>
              ) : null}
            </div>
          ) : null}
          {selectedSeries ? (
            <MediaExternalLinks imdbId={selectedSeries.imdbId} tmdbId={selectedSeries.tmdbId} mediaType="tv" />
          ) : null}
        </div>
      </div>

      {!selectedSeries ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <div className="surface-panel w-full px-6 py-12 text-center text-sm text-muted-foreground">
            {t("tv.drawerEmptySeries")}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          <TvSubtitleManagementPanel
            className="min-h-0 h-full flex-1 overflow-hidden"
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
            onOpenSeasonBatch={openSeasonBatch}
            onOpenBatchDelete={openBatchDelete}
            onRefreshVideo={onRefreshVideo}
            onRefreshSeriesVideos={onRefreshSeriesVideos}
            formatTime={formatTime}
            busy={busy}
            uploading={uploading}
            uploadingMessage={uploadingMessage}
            episodesPending={episodesPending}
            subtitleAction={subtitleAction}
          />
        </div>
      )}

      <Dialog open={batchDialogOpen} onOpenChange={handleBatchDialogOpenChange}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              <span>{t("tv.seasonBatchAction")}</span>
              <DialogHelpTip
                text={t("batch.dialogDescriptionShort", {
                  series: selectedSeriesPrimaryTitle || "-",
                  season: seasonLabel || "-"
                })}
              />
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t("batch.dialogDescriptionShort", {
                series: selectedSeriesPrimaryTitle || "-",
                season: seasonLabel || "-"
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {batchDialogOpen ? (
              <TvSeasonBatchUploadWorkspace
                className="min-h-0 flex-1"
                busy={busy}
                uploading={uploading}
                uploadingMessage={uploadingMessage}
                onLoadBatchCandidates={onLoadBatchCandidates}
                onUploadBatch={onUploadBatch}
                selectedSeries={selectedSeries}
                selectedSeason={selectedSeason}
                seasonVideos={videos}
                onSearchSubHDSeasonPacks={onSearchSubHDSeasonPacks}
                onPrepareSubHDSeason={onPrepareSubHDSeason}
                onInstallSubHDSeason={onInstallSubHDSeason}
                onComplete={() => handleBatchDialogOpenChange(false)}
                autoSearchOnMount
              />
            ) : null}
          </DialogBody>
        </DialogContent>
      </Dialog>

      <TvBatchDeleteDialog
        open={batchDeleteOpen}
        onOpenChange={setBatchDeleteOpen}
        seriesTitle={selectedSeriesPrimaryTitle}
        seriesVideos={seriesVideos}
        seasonOptions={seasonOptions}
        initialSeason={selectedSeason}
        busy={busy}
        uploading={uploading}
        uploadingMessage={uploadingMessage}
        onDeleteBatch={onDeleteBatch}
      />
    </div>
  );
}
