"use client";

import { forwardRef, useState } from "react";
import { Clock, Eye, FileArchive, FileCode2, Languages, Pencil, Search, Trash2, UploadCloud } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

import type { SubtitleDetailsPanelHandle, SubtitleDetailsPanelProps } from "../types";
import { MediaExternalLinks } from "../shared/media-external-links";
import { InlinePending, SpinnerIcon } from "../shared/pending-state";
import { PosterThumbnail } from "../shared/poster-thumbnail";
import { ArchiveEntryPickerDialog } from "../subtitle/dialogs/archive-entry-picker-dialog";
import { ConvertSubtitleDialog } from "../subtitle/dialogs/convert-subtitle-dialog";
import { DeleteSubtitleDialog } from "../subtitle/dialogs/delete-subtitle-dialog";
import { SubHDDownloadDialog } from "../subtitle/dialogs/subhd-download-dialog";
import { SubtitlePreviewDialog } from "../subtitle/dialogs/subtitle-preview-dialog";
import { TimingOffsetDialog } from "../subtitle/dialogs/timing-offset-dialog";
import { UploadSubtitleDialog } from "../subtitle/dialogs/upload-subtitle-dialog";
import { formatSubtitleSourceLabel } from "../subtitle/source-utils";
import { SubtitleSourceDetailButton } from "../subtitle/source-detail-button";
import {
  ACCEPTED_SUBTITLE_UPLOAD_TYPES,
  formatSubtitleSize,
  isSRTFileName,
  isSRTSubtitle,
  isTimingOffsetSupported,
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
>;

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
    formatTime,
    busy,
    uploading,
    uploadingMessage,
    subtitleAction
  },
  ref
) {
  const { t } = useI18n();
  const subtitleRowActionIconClassName = "h-8 w-8 shrink-0";
  const subtitleRowActionTextClassName = "h-8 shrink-0 gap-1 px-2 text-caption";
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const canAutoDownload = Boolean(onSearchSubHD && onDownloadSubHD);

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
                {canAutoDownload ? (
                  <Button
                    type="button"
                    size="icon"
                    className="h-8 w-8"
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
                  className="h-8 w-8"
                  disabled={uploadDisabled}
                  onClick={workflow.openUploadPicker}
                  title={uploadPending ? uploadingMessage || t("details.uploading") : t("movie.uploadSubtitleArchive")}
                  aria-label={uploadPending ? uploadingMessage || t("details.uploading") : t("movie.uploadSubtitleArchive")}
                >
                  {uploadPending || workflow.zipLoading ? <SpinnerIcon className="h-3.5 w-3.5" /> : <UploadCloud className="h-3.5 w-3.5" />}
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
          <div className="surface-panel w-full px-6 py-12 text-center text-sm text-muted-foreground">{emptyText}</div>
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="space-y-4 px-5 py-4 sm:px-6">
              <section className="space-y-2">
                  {selectedVideo.subtitles.length === 0 ? (
                    <div className="surface-panel px-4 py-5 text-center text-sm text-muted-foreground">{t("common.noSubtitles")}</div>
                  ) : (
                    selectedVideo.subtitles.map((subtitle) => {
                      const replacePending = subtitleAction?.kind === "replace" && subtitleAction.subtitleId === subtitle.id;
                      const convertPending = subtitleAction?.kind === "convert" && subtitleAction.subtitleId === subtitle.id;
                      const offsetPending = subtitleAction?.kind === "offset" && subtitleAction.subtitleId === subtitle.id;
                      const deletePending = subtitleAction?.kind === "delete" && subtitleAction.subtitleId === subtitle.id;
                      const rowBusy = replacePending || convertPending || offsetPending || deletePending;
                      const sourceText = formatSubtitleSourceLabel(subtitle, t);

                      return (
                        <article
                          key={subtitle.id}
                          className={cn("surface-panel p-3", rowBusy && "animate-pulse-soft")}
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius)] bg-surface-subtle text-foreground-muted">
                              <FileArchive className="h-4 w-4" />
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 items-center gap-2">
                                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground" title={subtitle.fileName || undefined}>
                                  {subtitle.fileName}
                                </p>
                                <Badge variant="secondary" className="shrink-0">
                                  {subtitle.format || "-"}
                                </Badge>
                              </div>

                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                <div className="flex items-center gap-1.5">
                                  <Languages className="h-3.5 w-3.5" />
                                  <span>{subtitle.language || "-"}</span>
                                </div>
                                <div className="flex min-w-0 items-center gap-1">
                                  <span className="min-w-0 truncate" title={sourceText}>
                                    {sourceText}
                                  </span>
                                  <SubtitleSourceDetailButton subtitle={subtitle} sourceLabel={sourceText} />
                                </div>
                                <div>{formatSubtitleSize(subtitle.size)}</div>
                                <div>{formatTime(subtitle.modTime)}</div>
                              </div>
                            </div>
                          </div>

                          <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-border pt-2.5">
                            <input
                              ref={(node) => workflow.setReplaceInputNode(subtitle.id, node)}
                              type="file"
                              accept={ACCEPTED_SUBTITLE_UPLOAD_TYPES}
                              className="hidden"
                              onChange={(event) => {
                                void workflow.onReplaceFilePicked(subtitle, event);
                              }}
                            />

                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className={subtitleRowActionIconClassName}
                              disabled={busy || rowBusy}
                              onClick={() => void workflow.openStoredSubtitlePreview(subtitle)}
                              title={t("common.preview")}
                              aria-label={t("common.preview")}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>

                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className={subtitleRowActionIconClassName}
                              disabled={busy || rowBusy}
                              onClick={() => workflow.replaceInputRef.current[subtitle.id]?.click()}
                              title={replacePending ? t("common.replacing") : t("common.replace")}
                              aria-label={replacePending ? t("common.replacing") : t("common.replace")}
                            >
                              {replacePending ? <SpinnerIcon className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                            </Button>

                            {isSRTSubtitle(subtitle) && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className={subtitleRowActionTextClassName}
                                disabled={busy || rowBusy}
                                onClick={() => {
                                  workflow.setPendingConvertSubtitle(subtitle);
                                  workflow.setConvertSourceEncoding("auto");
                                }}
                              >
                                {convertPending ? <SpinnerIcon className="h-3.5 w-3.5" /> : <FileCode2 className="h-3.5 w-3.5" />}
                                {convertPending ? t("conversion.converting") : t("conversion.convertToAss")}
                              </Button>
                            )}

                            {isTimingOffsetSupported(subtitle) && (
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className={subtitleRowActionIconClassName}
                                disabled={busy || rowBusy}
                                onClick={() => {
                                  workflow.setPendingOffsetSubtitle(subtitle);
                                  workflow.setOffsetSeconds("");
                                }}
                                title={offsetPending ? t("timing.offsetting") : t("timing.offset")}
                                aria-label={offsetPending ? t("timing.offsetting") : t("timing.offset")}
                              >
                                {offsetPending ? <SpinnerIcon className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                              </Button>
                            )}

                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className={cn(
                                subtitleRowActionIconClassName,
                                "border-destructive-border text-destructive-muted hover:bg-destructive-soft hover:text-destructive-muted"
                              )}
                              disabled={busy || rowBusy}
                              onClick={() => workflow.setDeleteDialogSubtitleId(subtitle.id)}
                              title={deletePending ? t("common.deleting") : t("common.delete")}
                              aria-label={deletePending ? t("common.deleting") : t("common.delete")}
                            >
                              {deletePending ? <SpinnerIcon className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                            </Button>
                          </div>

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
                        </article>
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
    </div>
  );
});
