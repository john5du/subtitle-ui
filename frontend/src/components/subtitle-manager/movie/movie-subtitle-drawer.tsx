"use client";

import { forwardRef, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Clock, ExternalLink, Eye, FileArchive, FileCode2, Languages, Pencil, Trash2, UploadCloud } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { buildSubtitleSearchLinks } from "@/lib/subtitle-search";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

import type { SubtitleDetailsPanelHandle, SubtitleDetailsPanelProps } from "../types";
import { MediaExternalLinks } from "../shared/media-external-links";
import { InlinePending, SpinnerIcon } from "../shared/pending-state";
import { ArchiveEntryPickerDialog } from "../subtitle/dialogs/archive-entry-picker-dialog";
import { ConvertSubtitleDialog } from "../subtitle/dialogs/convert-subtitle-dialog";
import { DeleteSubtitleDialog } from "../subtitle/dialogs/delete-subtitle-dialog";
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
    formatTime,
    busy,
    uploading,
    uploadingMessage,
    subtitleAction
  },
  ref
) {
  const { t } = useI18n();
  const dragDepthRef = useRef(0);
  const subtitleRowActionButtonClassName = "h-8 shrink-0 gap-1 px-2 text-caption";
  const [dragActive, setDragActive] = useState(false);

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

  const searchLinks = useMemo(() => (selectedVideo ? buildSubtitleSearchLinks(selectedVideo) : null), [selectedVideo]);
  const uploadPending = subtitleAction?.kind === "upload" && subtitleAction.videoId === selectedVideo?.id;
  const selectedMovieTitle = selectedVideo?.title || selectedVideo?.fileName || t("details.movieManagementTitle");

  useEffect(() => {
    setDragActive(false);
    dragDepthRef.current = 0;
  }, [selectedVideo?.id]);

  function handleDropzoneDragEnter(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (busy || workflow.zipLoading) {
      return;
    }
    dragDepthRef.current += 1;
    setDragActive(true);
  }

  function handleDropzoneDragOver(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (busy || workflow.zipLoading) {
      return;
    }
    event.dataTransfer.dropEffect = "copy";
    setDragActive(true);
  }

  function handleDropzoneDragLeave(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (busy || workflow.zipLoading) {
      return;
    }
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDragActive(false);
    }
  }

  function handleDropzoneDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (busy || workflow.zipLoading) {
      return;
    }
    dragDepthRef.current = 0;
    setDragActive(false);
    const file = event.dataTransfer.files?.[0] ?? null;
    if (!file) {
      return;
    }
    void workflow.handlePickedFile(file, "upload", null);
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-card">
      <div className="border-b border-border/70 bg-card/96 px-5 pb-4 pt-5 sm:px-6">
        <div className="flex flex-wrap items-start gap-3 pr-10">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
              <h2 className="min-w-0 max-w-full truncate text-2xl font-semibold tracking-tight sm:text-[2rem]">{selectedMovieTitle}</h2>
              {selectedVideo ? (
                <MediaExternalLinks imdbId={selectedVideo.imdbId} tmdbId={selectedVideo.tmdbId} mediaType="movie" />
              ) : null}
            </div>
            {searchLinks ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" className="gap-1.5" asChild>
                  <a href={searchLinks.subhd} target="_blank" rel="noreferrer">
                    <span>SubHD</span>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                  </a>
                </Button>
                <Button type="button" variant="outline" size="sm" className="gap-1.5" asChild>
                  <a href={searchLinks.zimuku} target="_blank" rel="noreferrer">
                    <span>Zimuku</span>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                  </a>
                </Button>
              </div>
            ) : null}
          </div>
          {selectedVideo ? (
            <Badge variant="outline" className="border-input bg-transparent px-3 py-1 tracking-display text-foreground">
              {t("tv.subtitleCount", { count: selectedVideo.subtitles.length })}
            </Badge>
          ) : null}
        </div>
      </div>

      {!selectedVideo ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-8">
          <div className="w-full bg-surface-subtle px-6 py-12 text-center text-sm text-muted-foreground">{emptyText}</div>
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="space-y-5 px-5 py-5 sm:px-6">
              <section className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold">{t("movie.drawerUploadTitle")}</h3>
                    <p className="text-sm text-muted-foreground">{t("movie.drawerUploadDescription")}</p>
                  </div>
                  {workflow.zipLoading ? (
                    <InlinePending label={t("details.parsingArchive")} />
                  ) : uploadPending ? (
                    <InlinePending label={uploadingMessage || t("details.uploading")} />
                  ) : null}
                </div>

                <input
                  ref={workflow.uploadInputRef}
                  type="file"
                  accept={ACCEPTED_SUBTITLE_UPLOAD_TYPES}
                  className="hidden"
                  onChange={workflow.onUploadFileChange}
                />

                <button
                  type="button"
                  aria-label={t("movie.drawerDropAria")}
                  className={cn(
                    "surface-transition flex w-full flex-col items-center justify-center gap-4 border border-dashed border-border px-6 py-8 text-center",
                    dragActive ? "bg-surface-strong" : "bg-surface-subtle hover:bg-surface-strong",
                    (busy || workflow.zipLoading) && "cursor-not-allowed opacity-65"
                  )}
                  disabled={busy || workflow.zipLoading}
                  onClick={workflow.openUploadPicker}
                  onDragEnter={handleDropzoneDragEnter}
                  onDragOver={handleDropzoneDragOver}
                  onDragLeave={handleDropzoneDragLeave}
                  onDrop={handleDropzoneDrop}
                >
                  <span className="flex h-16 w-16 items-center justify-center bg-surface-strong text-foreground">
                    {uploadPending || workflow.zipLoading ? <SpinnerIcon className="h-7 w-7" /> : <UploadCloud className="h-7 w-7" />}
                  </span>
                  <div className="space-y-1">
                    <p className="text-base font-semibold">{dragActive ? t("movie.drawerUploadActive") : t("movie.uploadSubtitleArchive")}</p>
                    <p className="text-sm text-muted-foreground">{t("movie.drawerUploadHint")}</p>
                  </div>
                </button>

                {workflow.zipPickError ? <p className="text-sm text-destructive">{workflow.zipPickError}</p> : null}
              </section>

              <section className="space-y-3">
                <div>
                  <h3 className="text-lg font-semibold">{t("movie.drawerRepositoryTitle")}</h3>
                  <p className="text-sm text-muted-foreground">{t("movie.drawerRepositoryDescription")}</p>
                </div>

                <div className="space-y-3">
                  {selectedVideo.subtitles.length === 0 ? (
                    <div className="bg-surface-subtle px-5 py-8 text-center text-sm text-muted-foreground">{t("movie.drawerEmptyRepository")}</div>
                  ) : (
                    selectedVideo.subtitles.map((subtitle) => {
                      const replacePending = subtitleAction?.kind === "replace" && subtitleAction.subtitleId === subtitle.id;
                      const convertPending = subtitleAction?.kind === "convert" && subtitleAction.subtitleId === subtitle.id;
                      const offsetPending = subtitleAction?.kind === "offset" && subtitleAction.subtitleId === subtitle.id;
                      const deletePending = subtitleAction?.kind === "delete" && subtitleAction.subtitleId === subtitle.id;
                      const rowBusy = replacePending || convertPending || offsetPending || deletePending;
                      const sourceText = formatSubtitleSourceLabel(subtitle, t);

                      return (
                        <article key={subtitle.id} className={cn("bg-surface-subtle p-4", rowBusy && "animate-pulse-soft")}>
                          <div className="flex flex-wrap items-start gap-3">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center bg-surface-strong text-foreground-muted">
                              <FileArchive className="h-5 w-5" />
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground" title={subtitle.fileName || undefined}>
                                  {subtitle.fileName}
                                </p>
                                <Badge variant="secondary" className="shrink-0">
                                  {subtitle.format || "-"}
                                </Badge>
                              </div>

                              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                                <div className="flex items-center gap-2">
                                  <Languages className="h-3.5 w-3.5" />
                                  <span>{subtitle.language || "-"}</span>
                                </div>
                                <div className="flex min-w-0 items-center gap-1">
                                  <span className="min-w-0 truncate" title={sourceText}>
                                    {sourceText}
                                  </span>
                                  <SubtitleSourceDetailButton subtitle={subtitle} sourceLabel={sourceText} />
                                </div>
                                <div>{t("details.sizeValue", { value: formatSubtitleSize(subtitle.size) })}</div>
                                <div>{formatTime(subtitle.modTime)}</div>
                              </div>
                            </div>
                          </div>

                          <div className="mt-4 flex flex-wrap gap-1.5">
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
                              size="sm"
                              className={subtitleRowActionButtonClassName}
                              disabled={busy || rowBusy}
                              onClick={() => void workflow.openStoredSubtitlePreview(subtitle)}
                            >
                              <Eye className="h-3.5 w-3.5" />
                              {t("common.preview")}
                            </Button>

                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className={subtitleRowActionButtonClassName}
                              disabled={busy || rowBusy}
                              onClick={() => workflow.replaceInputRef.current[subtitle.id]?.click()}
                            >
                              {replacePending ? <SpinnerIcon className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                              {replacePending ? t("common.replacing") : t("common.replace")}
                            </Button>

                            {isSRTSubtitle(subtitle) && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className={subtitleRowActionButtonClassName}
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
                                size="sm"
                                className={subtitleRowActionButtonClassName}
                                disabled={busy || rowBusy}
                                onClick={() => {
                                  workflow.setPendingOffsetSubtitle(subtitle);
                                  workflow.setOffsetSeconds("");
                                }}
                              >
                                {offsetPending ? <SpinnerIcon className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                                {offsetPending ? t("timing.offsetting") : t("timing.offset")}
                              </Button>
                            )}

                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className={cn(
                                subtitleRowActionButtonClassName,
                                "border-destructive-border text-destructive-muted hover:bg-destructive-soft hover:text-destructive-muted"
                              )}
                              disabled={busy || rowBusy}
                              onClick={() => workflow.setDeleteDialogSubtitleId(subtitle.id)}
                            >
                              {deletePending ? <SpinnerIcon className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                              {deletePending ? t("common.deleting") : t("common.delete")}
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
                </div>
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
    </div>
  );
});
