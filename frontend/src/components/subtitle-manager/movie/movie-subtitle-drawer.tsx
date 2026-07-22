"use client";

import { forwardRef, useState } from "react";
import { CaseSensitive, Play, Search, UploadCloud } from "lucide-react";

import { useJellyfinEnabled } from "@/hooks/use-jellyfin-enabled";
import { useI18n } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

import type { SubtitleDetailsPanelHandle, SubtitleDetailsPanelProps } from "../types";
import { EmptyPanel } from "../shared/empty-panel";
import { MediaExternalLinks } from "../shared/media-external-links";
import { InlinePending, SpinnerIcon } from "../shared/pending-state";
import { PosterThumbnail } from "../shared/poster-thumbnail";
import { ArchiveEntryPickerDialog } from "../subtitle/dialogs/archive-entry-picker-dialog";
import { ConvertSubtitleDialog } from "../subtitle/dialogs/convert-subtitle-dialog";
import { DeleteSubtitleDialog } from "../subtitle/dialogs/delete-subtitle-dialog";
import { SubHDDownloadDialog } from "../subtitle/dialogs/subhd-download-dialog";
import { SubtitlePreviewDialog } from "../subtitle/dialogs/subtitle-preview-dialog";
import { TimingOffsetDialog } from "../subtitle/dialogs/timing-offset-dialog";
import { NormalizeSubtitlesDialog, type NormalizeDialogScope } from "../subtitle/dialogs/normalize-subtitles-dialog";
import { UploadSubtitleDialog } from "../subtitle/dialogs/upload-subtitle-dialog";
import { VideoSubtitlePreviewDialog } from "../subtitle/dialogs/video-subtitle-preview-dialog";
import { SubtitleTrackCard, subtitleRowActionIconClassName } from "../subtitle/subtitle-track-card";
import {
  ACCEPTED_SUBTITLE_UPLOAD_TYPES,
  isSRTFileName,
  useSubtitleFileWorkflow
} from "../subtitle/use-subtitle-file-workflow";

type MovieSubtitleDrawerProps = Pick<
  SubtitleDetailsPanelProps,
  | "selectedVideo"
  | "emptyText"
  | "onUpload"
  | "onReplace"
  | "onConvertSubtitle"
  | "onOffsetSubtitle"
  | "onRemove"
  | "onPreviewSubtitle"
  | "onSearchSubHD"
  | "onDownloadSubHD"
  | "formatTime"
  | "busy"
  | "uploading"
  | "uploadingMessage"
  | "subtitleAction"
> & {
  onRefreshVideo?: (video: NonNullable<SubtitleDetailsPanelProps["selectedVideo"]>) => Promise<void>;
};

export const MovieSubtitleDrawer = forwardRef<SubtitleDetailsPanelHandle, MovieSubtitleDrawerProps>(function MovieSubtitleDrawer(
  {
    selectedVideo,
    emptyText,
    onUpload,
    onReplace,
    onConvertSubtitle,
    onOffsetSubtitle,
    onRemove,
    onPreviewSubtitle,
    onSearchSubHD,
    onDownloadSubHD,
    onRefreshVideo,
    formatTime,
    busy,
    uploading,
    uploadingMessage,
    subtitleAction
  },
  ref
) {
  const { t } = useI18n();
  const { enabled: jellyfinEnabled } = useJellyfinEnabled();
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [normalizeOpen, setNormalizeOpen] = useState(false);
  const [normalizeScope, setNormalizeScope] = useState<NormalizeDialogScope | null>(null);
  const [playPreviewOpen, setPlayPreviewOpen] = useState(false);
  const canAutoDownload = Boolean(onSearchSubHD && onDownloadSubHD);
  const canPlayPreview = jellyfinEnabled && Boolean(selectedVideo);

  const workflow = useSubtitleFileWorkflow({
    selectedVideo,
    busy,
    onUpload,
    onReplace,
    onConvertSubtitle,
    onOffsetSubtitle,
    onRemove,
    onPreviewSubtitle,
    handleRef: ref,
    confirmReplace: false
  });

  const uploadPending = subtitleAction?.kind === "upload" && subtitleAction.videoId === selectedVideo?.id;
  const downloadPending = subtitleAction?.kind === "download" && subtitleAction.videoId === selectedVideo?.id;
  const selectedMovieTitle = selectedVideo?.title || selectedVideo?.fileName || t("details.movieManagementTitle");
  const uploadDisabled = busy || workflow.zipLoading || !selectedVideo;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-card">
      <div className="shrink-0 border-b border-border px-5 py-4 pr-14 sm:px-6 sm:pr-16">
        {selectedVideo ? (
          <div className="flex min-w-0 gap-3 sm:gap-4">
            <PosterThumbnail
              src={selectedVideo.posterUrl}
              className="h-[96px] w-[64px] shrink-0 rounded-[var(--radius)] sm:h-[108px] sm:w-[72px]"
              imageClassName="h-full w-full"
              sizes="72px"
            />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <h2 className="min-w-0 max-w-full truncate text-lg font-semibold tracking-tight sm:text-xl">{selectedMovieTitle}</h2>
                {selectedVideo.year ? (
                  <span className="shrink-0 text-sm text-muted-foreground">{selectedVideo.year}</span>
                ) : null}
                <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px] normal-case tracking-normal">
                  {t("tv.subtitleCount", { count: selectedVideo.subtitles.length })}
                </Badge>
              </div>
              {selectedVideo.path ? (
                <p className="truncate text-xs text-muted-foreground" title={selectedVideo.path}>
                  {selectedVideo.path}
                </p>
              ) : null}
              <MediaExternalLinks imdbId={selectedVideo.imdbId} tmdbId={selectedVideo.tmdbId} mediaType="movie" />
              <div className="flex flex-wrap items-center gap-1.5">
                {canPlayPreview ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className={subtitleRowActionIconClassName}
                    disabled={busy || !selectedVideo}
                    onClick={() => setPlayPreviewOpen(true)}
                    title={t("common.playPreview")}
                    aria-label={t("common.playPreview")}
                  >
                    <Play className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
                {canAutoDownload ? (
                  <Button
                    type="button"
                    size="icon"
                    className={subtitleRowActionIconClassName}
                    disabled={busy}
                    onClick={() => setDownloadDialogOpen(true)}
                    title={downloadPending ? t("download.downloading") : t("common.search")}
                    aria-label={downloadPending ? t("download.downloading") : t("common.search")}
                  >
                    {downloadPending ? <SpinnerIcon className="h-3.5 w-3.5" /> : <Search className="h-3.5 w-3.5" />}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="icon"
                  variant={canAutoDownload ? "outline" : "default"}
                  className={subtitleRowActionIconClassName}
                  disabled={uploadDisabled}
                  onClick={workflow.openUploadPicker}
                  title={uploadPending ? uploadingMessage || t("details.uploading") : t("movie.uploadSubtitleArchive")}
                  aria-label={uploadPending ? uploadingMessage || t("details.uploading") : t("movie.uploadSubtitleArchive")}
                >
                  {uploadPending || workflow.zipLoading ? <SpinnerIcon className="h-3.5 w-3.5" /> : <UploadCloud className="h-3.5 w-3.5" />}
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className={subtitleRowActionIconClassName}
                  disabled={busy || !selectedVideo || selectedVideo.subtitles.length === 0}
                  onClick={() => {
                    if (!selectedVideo) return;
                    setNormalizeScope({ kind: "video", videoId: selectedVideo.id });
                    setNormalizeOpen(true);
                  }}
                  title={t("normalize.action")}
                  aria-label={t("normalize.action")}
                >
                  <CaseSensitive className="h-3.5 w-3.5" />
                </Button>
                {workflow.zipLoading ? <InlinePending label={t("details.parsingArchive")} /> : null}
              </div>
              {workflow.zipPickError ? <p className="text-sm text-destructive">{workflow.zipPickError}</p> : null}
            </div>
          </div>
        ) : (
          <div className="min-w-0 space-y-2">
            <h2 className="min-w-0 max-w-full truncate text-lg font-semibold tracking-tight sm:text-xl">{selectedMovieTitle}</h2>
          </div>
        )}
      </div>

      <input
        ref={workflow.uploadInputRef}
        type="file"
        accept={ACCEPTED_SUBTITLE_UPLOAD_TYPES}
        className="hidden"
        onChange={workflow.onUploadFileChange}
      />

      {!selectedVideo ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <EmptyPanel padded={false}>{emptyText}</EmptyPanel>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-3 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:space-y-4 sm:px-6">
              <section className="space-y-2">
                  {selectedVideo.subtitles.length === 0 ? (
                    <EmptyPanel className="min-h-0 px-4 py-5" padded={false}>
                      {t("common.noSubtitles")}
                    </EmptyPanel>
                  ) : (
                    selectedVideo.subtitles.map((subtitle) => {
                      const deletePending = subtitleAction?.kind === "delete" && subtitleAction.subtitleId === subtitle.id;
                      return (
                        <SubtitleTrackCard
                          key={subtitle.id}
                          subtitle={subtitle}
                          busy={busy}
                          subtitleAction={subtitleAction}
                          formatTime={formatTime}
                          replaceInputRef={(node) => workflow.setReplaceInputNode(subtitle.id, node)}
                          onReplaceFileChange={(event) => {
                            void workflow.onReplaceFilePicked(subtitle, event);
                          }}
                          onPreview={() => void workflow.openStoredSubtitlePreview(subtitle)}
                          onReplaceClick={() => workflow.replaceInputRef.current[subtitle.id]?.click()}
                          onConvert={() => {
                            workflow.setPendingConvertSubtitle(subtitle);
                            workflow.setConvertSourceEncoding("auto");
                          }}
                          onOffset={() => {
                            workflow.setPendingOffsetSubtitle(subtitle);
                            workflow.setOffsetSeconds("");
                          }}
                          onDelete={() => workflow.setDeleteDialogSubtitleId(subtitle.id)}
                          deleteDialog={
                            <DeleteSubtitleDialog
                              open={workflow.deleteDialogSubtitleId === subtitle.id}
                              onOpenChange={(open) => {
                                if (!open) {
                                  workflow.setDeleteDialogSubtitleId((current) => (current === subtitle.id ? null : current));
                                  return;
                                }
                                workflow.setDeleteDialogSubtitleId(subtitle.id);
                              }}
                              subtitle={subtitle}
                              deletePending={deletePending}
                              onConfirm={() => {
                                void workflow.confirmDeleteSubtitle(subtitle);
                              }}
                            />
                          }
                        />
                      );
                    })
                  )}
              </section>
            </div>
          </ScrollArea>
        </div>
      )}

      <UploadSubtitleDialog
        open={workflow.uploadDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            workflow.setUploadDialogOpen(false);
            workflow.setPendingUploadFile(null);
            return;
          }
          workflow.setUploadDialogOpen(true);
        }}
        pendingUploadFile={workflow.pendingUploadFile}
        uploadLabel={workflow.uploadLabel}
        onUploadLabelChange={workflow.setUploadLabel}
        canConvertToAss={Boolean(workflow.pendingUploadFile && isSRTFileName(workflow.pendingUploadFile.name))}
        convertToAss={workflow.uploadConvertToAss}
        onConvertToAssChange={workflow.setUploadConvertToAss}
        sourceEncoding={workflow.uploadSourceEncoding}
        onSourceEncodingChange={workflow.setUploadSourceEncoding}
        onConfirm={() => {
          void workflow.confirmUpload();
        }}
        busy={busy}
        uploadPending={uploadPending}
      />

      <ConvertSubtitleDialog
        open={workflow.pendingConvertSubtitle !== null}
        onOpenChange={(open) => {
          if (!open) {
            workflow.setPendingConvertSubtitle(null);
            workflow.setConvertSourceEncoding("auto");
          }
        }}
        subtitle={workflow.pendingConvertSubtitle}
        sourceEncoding={workflow.convertSourceEncoding}
        onSourceEncodingChange={workflow.setConvertSourceEncoding}
        convertPending={Boolean(
          subtitleAction?.kind === "convert" &&
            workflow.pendingConvertSubtitle &&
            subtitleAction.subtitleId === workflow.pendingConvertSubtitle.id
        )}
        onConfirm={() => {
          void workflow.confirmConvertSubtitle();
        }}
      />

      <TimingOffsetDialog
        open={workflow.pendingOffsetSubtitle !== null}
        onOpenChange={(open) => {
          if (!open) {
            workflow.setPendingOffsetSubtitle(null);
            workflow.setOffsetSeconds("");
            return;
          }
          workflow.setPendingOffsetSubtitle(workflow.pendingOffsetSubtitle);
        }}
        subtitle={workflow.pendingOffsetSubtitle}
        offsetSeconds={workflow.offsetSeconds}
        onOffsetSecondsChange={workflow.setOffsetSeconds}
        offsetPending={Boolean(
          subtitleAction?.kind === "offset" &&
            workflow.pendingOffsetSubtitle &&
            subtitleAction.subtitleId === workflow.pendingOffsetSubtitle.id
        )}
        onConfirm={(offsetMs) => {
          void workflow.confirmOffsetSubtitle(offsetMs);
        }}
      />

      <ArchiveEntryPickerDialog
        open={workflow.zipPickDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            workflow.setZipPickDialogOpen(false);
            workflow.setSelectedZipEntryId("");
            return;
          }
          workflow.setZipPickDialogOpen(true);
        }}
        mode={workflow.zipPickMode}
        zipPickFileName={workflow.zipPickFileName}
        zipPickEntries={workflow.zipPickEntries}
        zipUploadLabel={workflow.zipUploadLabel}
        onZipUploadLabelChange={workflow.setZipUploadLabel}
        selectedZipEntryId={workflow.selectedZipEntryId}
        onSelectZipEntryId={workflow.setSelectedZipEntryId}
        onPreviewEntry={workflow.openArchiveSubtitlePreview}
        onConfirm={() => {
          void workflow.confirmZipEntrySelection();
        }}
        busy={busy}
        uploading={uploading}
        zipLoading={workflow.zipLoading}
      />

      <SubtitlePreviewDialog
        open={workflow.previewDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            workflow.resetPreviewState();
            return;
          }
          workflow.setPreviewDialogOpen(true);
        }}
        previewTitle={workflow.previewTitle}
        previewStatus={workflow.previewStatus}
        previewError={workflow.previewError}
        previewContent={workflow.previewContent}
        previewEncoding={workflow.previewEncoding}
        previewTruncated={workflow.previewTruncated}
      />

      {canPlayPreview ? (
        <VideoSubtitlePreviewDialog
          open={playPreviewOpen}
          onOpenChange={setPlayPreviewOpen}
          video={selectedVideo}
          onLoadSubtitleContent={onPreviewSubtitle}
        />
      ) : null}

      {canAutoDownload && onSearchSubHD && onDownloadSubHD ? (
        <SubHDDownloadDialog
          open={downloadDialogOpen}
          onOpenChange={setDownloadDialogOpen}
          video={selectedVideo}
          busy={busy || workflow.zipLoading}
          downloading={downloadPending}
          onSearch={onSearchSubHD}
          onDownload={onDownloadSubHD}
          onUploadLocal={workflow.openUploadPicker}
          uploadLocalPending={uploadPending || workflow.zipLoading}
        />
      ) : null}

      <NormalizeSubtitlesDialog
        open={normalizeOpen}
        onOpenChange={(open) => {
          setNormalizeOpen(open);
          if (!open) setNormalizeScope(null);
        }}
        scope={normalizeScope}
        onApplied={async () => {
          if (selectedVideo && onRefreshVideo) {
            await onRefreshVideo(selectedVideo);
          }
        }}
      />
    </div>
  );
});
