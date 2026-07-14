"use client";

import { forwardRef, useEffect, useMemo, useState } from "react";
import { ArrowLeft, AlertTriangle, Clock, ExternalLink, Eye, FileCode2, Pencil, Search, Trash2, UploadCloud } from "lucide-react";

import { useMediaQuery } from "@/hooks/use-media-query";
import { useI18n } from "@/lib/i18n";
import { buildSubtitleSearchLinks, buildSubtitleSearchLinksByKeyword } from "@/lib/subtitle-search";
import { emitToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import type { SubtitleDetailsPanelHandle, SubtitleDetailsPanelProps } from "../types";
import { InfoItem } from "../shared/info-item";
import { InlinePending, SpinnerIcon } from "../shared/pending-state";
import { SubtitleSourceDetailButton } from "./source-detail-button";
import { formatSubtitleSourceLabel } from "./source-utils";
import { ArchiveEntryPickerDialog } from "./dialogs/archive-entry-picker-dialog";
import { ConvertSubtitleDialog } from "./dialogs/convert-subtitle-dialog";
import { DeleteSubtitleDialog } from "./dialogs/delete-subtitle-dialog";
import { ReplaceSubtitleDialog } from "./dialogs/replace-subtitle-dialog";
import { SubHDDownloadDialog } from "./dialogs/subhd-download-dialog";
import { SubtitlePreviewDialog } from "./dialogs/subtitle-preview-dialog";
import { TimingOffsetDialog } from "./dialogs/timing-offset-dialog";
import { UploadSubtitleDialog } from "./dialogs/upload-subtitle-dialog";
import { SubtitleTrackCard, subtitleRowActionIconClassName } from "./subtitle-track-card";
import {
  ACCEPTED_SUBTITLE_UPLOAD_TYPES,
  isSRTFileName,
  isSRTSubtitle,
  isTimingOffsetSupported,
  useSubtitleFileWorkflow
} from "./use-subtitle-file-workflow";

export const SubtitleDetailsPanel = forwardRef<SubtitleDetailsPanelHandle, SubtitleDetailsPanelProps>(function SubtitleDetailsPanel(
  {
    panelTitle,
    selectedVideo,
    emptyText,
    showBack,
    onBack,
    infoRows,
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
    subtitleAction,
    showSearchLinks,
    searchKeyword,
    showMediaType = true,
    showMetadata = true,
    showUploadButton = true,
    compactMeta = false,
    metaCollapsedByDefault = false,
    showMetaSection = true,
    showPanelTitle = true,
    showSubtitleListCaption = true,
    embedded = false
  }: SubtitleDetailsPanelProps,
  ref
) {
  const { t } = useI18n();
  const isMdUp = useMediaQuery("(min-width: 768px)", true);
  const [flashSubtitleList, setFlashSubtitleList] = useState(false);
  const [metaExpanded, setMetaExpanded] = useState(!metaCollapsedByDefault);
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const showHeader = showPanelTitle || showBack || (Boolean(selectedVideo) && !embedded);
  const canAutoDownload = Boolean(onSearchSubHD && onDownloadSubHD);
  const useCardLayout = !isMdUp;

  function triggerSubtitleListFlash() {
    setFlashSubtitleList(false);
    window.requestAnimationFrame(() => {
      setFlashSubtitleList(true);
      window.setTimeout(() => setFlashSubtitleList(false), 900);
    });
  }

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
    confirmReplace: true,
    onMutationSuccess: triggerSubtitleListFlash
  });

  const searchLinks = useMemo(() => {
    if (searchKeyword && searchKeyword.trim()) {
      return buildSubtitleSearchLinksByKeyword(searchKeyword);
    }
    if (!selectedVideo) {
      return null;
    }
    return buildSubtitleSearchLinks(selectedVideo);
  }, [searchKeyword, selectedVideo]);

  const uploadPending = subtitleAction?.kind === "upload" && subtitleAction.videoId === selectedVideo?.id;
  const downloadPending = subtitleAction?.kind === "download" && subtitleAction.videoId === selectedVideo?.id;
  // When SubHD auto-download is available, local upload + site links live inside that dialog as fallbacks.
  const showPrimaryUploadButton = showUploadButton && !canAutoDownload;
  const searchActionItems =
    showSearchLinks && !canAutoDownload && searchLinks
      ? [
          { label: t("download.openSubHDSearch"), href: searchLinks.subhd },
          { label: t("download.openZimuku"), href: searchLinks.zimuku }
        ]
      : [];
  const hasActionToolbar =
    showPrimaryUploadButton ||
    canAutoDownload ||
    searchActionItems.length > 0 ||
    workflow.zipLoading ||
    Boolean(workflow.zipPickError);
  const detailsInfoGrid = selectedVideo ? (
    <div className="flex flex-col divide-y divide-border overflow-hidden border border-border text-sm">
      <InfoItem label={t("info.title")} value={selectedVideo.title || "-"} />
      <InfoItem label={t("info.year")} value={selectedVideo.year || "-"} />
      {showMediaType && <InfoItem label={t("info.mediaType")} value={selectedVideo.mediaType === "movie" ? t("info.movie") : t("info.tv")} />}
      {showMetadata && <InfoItem label={t("info.metadata")} value={selectedVideo.metadataSource || "-"} />}
      {infoRows.map((item) => (
        <InfoItem key={item.label} label={item.label} value={item.value || "-"} />
      ))}
      <InfoItem label={t("info.path")} value={selectedVideo.path || "-"} />
      <InfoItem label={t("info.updated")} value={formatTime(selectedVideo.updatedAt)} />
    </div>
  ) : null;

  useEffect(() => {
    setMetaExpanded(!metaCollapsedByDefault);
  }, [metaCollapsedByDefault, selectedVideo?.id]);

  const rootClassName = cn(
    "flex h-full w-full min-h-0 flex-col",
    embedded ? "bg-transparent" : "animate-fade-in-up rounded-lg bg-card text-card-foreground"
  );
  const contentClassName = cn("flex min-h-0 flex-1 flex-col", embedded ? "gap-0" : "gap-4 p-4 pt-0");

  return (
    <div className={rootClassName}>
      {showHeader ? (
        <div className={cn("shrink-0", embedded ? "border-b border-border px-4 py-3" : "flex flex-col space-y-1.5 p-4")}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              {showPanelTitle && panelTitle ? (
                embedded ? <h3 className="text-lg font-normal leading-none tracking-tight">{panelTitle}</h3> : <CardTitle>{panelTitle}</CardTitle>
              ) : null}
              {selectedVideo && !embedded ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">
                    {t("tv.subtitleCount", { count: selectedVideo.subtitles.length })}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {t("info.updated")}: {formatTime(selectedVideo.updatedAt)}
                  </span>
                </div>
              ) : null}
            </div>
            {showBack && (
              <Button type="button" variant="outline" size="sm" className="gap-1" onClick={onBack} disabled={busy}>
                <ArrowLeft className="h-4 w-4" />
                {t("details.backToList")}
              </Button>
            )}
          </div>
        </div>
      ) : null}

      <div className={contentClassName}>
        {!selectedVideo ? (
          <div className={cn(
            "flex flex-1 items-center justify-center p-6",
            !embedded && "px-4"
          )}>
            <div className="surface-panel w-full px-6 py-12 text-center text-sm text-muted-foreground">
              {emptyText}
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {showMetaSection ? (
              <div className={cn(embedded ? "border-b border-border px-4 py-3" : "mb-4")}>
                {compactMeta ? (
                  <div className="surface-subtle space-y-3 rounded-[var(--radius)] p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="max-w-full truncate text-sm font-semibold sm:max-w-[60%]">{selectedVideo.title || selectedVideo.fileName || "-"}</p>
                      <Badge variant="secondary">
                        {t("tv.subtitleCount", { count: selectedVideo.subtitles.length })}
                      </Badge>
                    </div>
                    <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setMetaExpanded((prev) => !prev)}>
                      {metaExpanded ? t("details.lessInfo") : t("details.moreInfo")}
                    </Button>
                    {metaExpanded && detailsInfoGrid}
                  </div>
                ) : (
                  detailsInfoGrid
                )}
              </div>
            ) : null}

            <input
              ref={workflow.uploadInputRef}
              type="file"
              accept={ACCEPTED_SUBTITLE_UPLOAD_TYPES}
              className="hidden"
              onChange={workflow.onUploadFileChange}
            />
            {hasActionToolbar && (
              <div className={cn(
                "shrink-0",
                embedded ? "border-b border-border px-4 py-3" : "mb-4 flex flex-col gap-3 surface-subtle p-3"
              )}>
                <div className="flex h-9 flex-wrap items-center gap-2">
                  {canAutoDownload ? (
                    <Button
                      type="button"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      disabled={busy || workflow.zipLoading || !selectedVideo}
                      onClick={() => setDownloadDialogOpen(true)}
                      title={downloadPending ? t("download.downloading") : t("common.search")}
                      aria-label={downloadPending ? t("download.downloading") : t("common.search")}
                    >
                      {downloadPending ? <SpinnerIcon className="h-3.5 w-3.5" /> : <Search className="h-3.5 w-3.5" />}
                    </Button>
                  ) : null}
                  {showPrimaryUploadButton && (
                    <Button
                      type="button"
                      size="icon"
                      variant={canAutoDownload ? "outline" : "default"}
                      className="h-9 w-9 shrink-0"
                      disabled={busy || workflow.zipLoading}
                      onClick={workflow.openUploadPicker}
                      title={uploadPending ? uploadingMessage || t("details.uploading") : t("movie.uploadSubtitleArchive")}
                      aria-label={uploadPending ? uploadingMessage || t("details.uploading") : t("movie.uploadSubtitleArchive")}
                    >
                      {uploadPending || workflow.zipLoading ? <SpinnerIcon className="h-3.5 w-3.5" /> : <UploadCloud className="h-3.5 w-3.5" />}
                    </Button>
                  )}
                  {workflow.zipLoading && <InlinePending label={t("details.parsingArchive")} />}
                  {selectedVideo && embedded ? (
                    <Badge variant="secondary" className="shrink-0">
                      {t("tv.subtitleCount", { count: selectedVideo.subtitles.length })}
                    </Badge>
                  ) : null}
                  {searchActionItems.length > 0 && (
                    <div className="ml-auto flex h-9 flex-wrap items-center justify-end gap-1.5">
                      {searchActionItems.map((item) => (
                        <Button
                          key={item.label}
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-9 w-9 shrink-0"
                          title={item.label}
                          aria-label={item.label}
                          asChild
                        >
                          <a href={item.href} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
                {workflow.zipPickError && (
                  <div className="surface-status-destructive mt-2 flex items-start gap-2 border p-2 text-sm">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span className="min-w-0 break-words">{workflow.zipPickError}</span>
                  </div>
                )}
              </div>
            )}

            <div className={cn("min-h-0 flex-1 overflow-hidden", !embedded && "surface-subtle", flashSubtitleList && "animate-highlight-flash")}>
              <ScrollArea className="h-full">
                {useCardLayout ? (
                  <div className="space-y-3 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                    {selectedVideo.subtitles.length === 0 ? (
                      <div className="px-2 py-8 text-center text-sm text-muted-foreground">{t("common.noSubtitles")}</div>
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
                  </div>
                ) : (
                  <Table containerClassName={embedded ? "rounded-none border-0" : undefined}>
                    {showSubtitleListCaption ? <TableCaption>{t("details.subtitleListCaption")}</TableCaption> : null}
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[4.5rem]">{t("details.lang")}</TableHead>
                        <TableHead className="w-[4.5rem]">{t("common.format")}</TableHead>
                        <TableHead className="min-w-[7rem]">{t("details.source")}</TableHead>
                        <TableHead className="hidden w-[9rem] xl:table-cell">{t("details.modified")}</TableHead>
                        <TableHead className="min-w-[10rem] text-right">{t("common.actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedVideo.subtitles.map((subtitle) => {
                        const replacePending = subtitleAction?.kind === "replace" && subtitleAction.subtitleId === subtitle.id;
                        const convertPending = subtitleAction?.kind === "convert" && subtitleAction.subtitleId === subtitle.id;
                        const offsetPending = subtitleAction?.kind === "offset" && subtitleAction.subtitleId === subtitle.id;
                        const deletePending = subtitleAction?.kind === "delete" && subtitleAction.subtitleId === subtitle.id;
                        const rowBusy = replacePending || convertPending || offsetPending || deletePending;
                        const sourceText = formatSubtitleSourceLabel(subtitle, t);

                        return (
                          <TableRow key={subtitle.id} className={cn(rowBusy && "animate-pulse-soft bg-muted/40")}>
                            <TableCell title={subtitle.fileName || undefined}>{subtitle.language || "-"}</TableCell>
                            <TableCell>{subtitle.format || "-"}</TableCell>
                            <TableCell>
                              <div className="flex min-w-0 items-center gap-1">
                                <span className="min-w-0 truncate" title={sourceText}>
                                  {sourceText}
                                </span>
                                <SubtitleSourceDetailButton subtitle={subtitle} sourceLabel={sourceText} />
                              </div>
                            </TableCell>
                            <TableCell className="hidden xl:table-cell">{formatTime(subtitle.modTime)}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex max-w-full flex-wrap items-center justify-end gap-1">
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
                                  className="h-8 w-8 shrink-0"
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
                                  className="h-8 w-8 shrink-0"
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
                                    className="h-8 shrink-0 gap-1 px-2 text-caption"
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
                                    className="h-8 w-8 shrink-0"
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
                                  className="h-8 w-8 shrink-0 border-destructive-border text-destructive-muted hover:bg-destructive-soft hover:text-destructive-muted"
                                  disabled={busy || rowBusy}
                                  onClick={() => workflow.setDeleteDialogSubtitleId(subtitle.id)}
                                  title={deletePending ? t("common.deleting") : t("common.delete")}
                                  aria-label={deletePending ? t("common.deleting") : t("common.delete")}
                                >
                                  {deletePending ? <SpinnerIcon className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                                </Button>

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
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}

                      {selectedVideo.subtitles.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                            {t("common.noSubtitles")}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </ScrollArea>
            </div>
          </div>
        )}
      </div>

      <ReplaceSubtitleDialog
        open={workflow.pendingReplace !== null}
        onOpenChange={(open) => {
          if (!open) {
            const isReplacing =
              subtitleAction?.kind === "replace" && workflow.pendingReplace?.subtitle.id === subtitleAction.subtitleId;
            if (isReplacing) {
              emitToast({
                level: "info",
                message: t("toast.uploadInProgressTitle")
              });
              return;
            }
            workflow.setPendingReplace(null);
          }
        }}
        subtitle={workflow.pendingReplace?.subtitle ?? null}
        newFileName={workflow.pendingReplace?.file.name ?? ""}
        replacePending={Boolean(
          subtitleAction?.kind === "replace" &&
            workflow.pendingReplace &&
            subtitleAction.subtitleId === workflow.pendingReplace.subtitle.id
        )}
        onConfirm={() => {
          void workflow.confirmReplaceSubtitle();
        }}
      />

      <UploadSubtitleDialog
        open={workflow.uploadDialogOpen}
        onOpenChange={(open) => {
          if (!open && uploading) {
            emitToast({
              level: "info",
              message: t("toast.uploadInProgressTitle")
            });
            return;
          }
          if (!open) {
            workflow.resetUploadState();
            return;
          }
          workflow.setUploadDialogOpen(open);
        }}
        pendingUploadFile={workflow.pendingUploadFile}
        uploadLabel={workflow.uploadLabel}
        onUploadLabelChange={workflow.setUploadLabel}
        canConvertToAss={Boolean(workflow.pendingUploadFile && isSRTFileName(workflow.pendingUploadFile.name))}
        convertToAss={workflow.uploadConvertToAss}
        onConvertToAssChange={workflow.setUploadConvertToAss}
        sourceEncoding={workflow.uploadSourceEncoding}
        onSourceEncodingChange={workflow.setUploadSourceEncoding}
        onConfirm={() => void workflow.confirmUpload()}
        busy={busy || !selectedVideo}
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
        onConfirm={() => void workflow.confirmConvertSubtitle()}
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
          if (!open && uploading) {
            emitToast({
              level: "info",
              message: t("toast.uploadInProgressTitle")
            });
            return;
          }
          if (!open) {
            workflow.resetZipPickState();
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
        onSelectZipEntryId={(value) => {
          workflow.setSelectedZipEntryId(value);
          workflow.setZipPickError("");
        }}
        onPreviewEntry={workflow.openArchiveSubtitlePreview}
        onConfirm={() => void workflow.confirmZipEntrySelection()}
        busy={busy}
        uploading={uploading}
        zipLoading={workflow.zipLoading}
      />

      <SubtitlePreviewDialog
        open={workflow.previewDialogOpen}
        onOpenChange={workflow.setPreviewDialogOpen}
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
          searchKeyword={searchKeyword}
          onUploadLocal={showUploadButton ? workflow.openUploadPicker : undefined}
          uploadLocalPending={uploadPending || workflow.zipLoading}
        />
      ) : null}
    </div>
  );
});

SubtitleDetailsPanel.displayName = "SubtitleDetailsPanel";
