"use client";

import { emitToast } from "@/lib/toast";
import type {
  PendingSubtitleAction,
  SubHDDownloadOptions,
  SubHDSearchPage,
  Subtitle,
  Video
} from "@/lib/types";
import { useI18n } from "@/lib/i18n";

import { ArchiveEntryPickerDialog } from "./dialogs/archive-entry-picker-dialog";
import { ConvertSubtitleDialog } from "./dialogs/convert-subtitle-dialog";
import { ReplaceSubtitleDialog } from "./dialogs/replace-subtitle-dialog";
import { SubHDDownloadDialog } from "./dialogs/subhd-download-dialog";
import { SubtitlePreviewDialog } from "./dialogs/subtitle-preview-dialog";
import { TimingOffsetDialog } from "./dialogs/timing-offset-dialog";
import { UploadSubtitleDialog } from "./dialogs/upload-subtitle-dialog";
import { VideoSubtitlePreviewDialog } from "./dialogs/video-subtitle-preview-dialog";
import { isSRTFileName } from "./file-guards";
import type { useSubtitleFileWorkflow } from "./use-subtitle-file-workflow";

type Workflow = ReturnType<typeof useSubtitleFileWorkflow>;

export function SubtitleDetailsDialogs({
  workflow,
  selectedVideo,
  busy,
  uploading,
  subtitleAction,
  uploadPending,
  downloadPending,
  canPlayPreview,
  canAutoDownload,
  playPreviewOpen,
  setPlayPreviewOpen,
  downloadDialogOpen,
  setDownloadDialogOpen,
  showUploadButton,
  searchKeyword,
  onPreviewSubtitle,
  onSearchSubHD,
  onDownloadSubHD
}: {
  workflow: Workflow;
  selectedVideo: Video | null;
  busy: boolean;
  uploading: boolean;
  subtitleAction: PendingSubtitleAction | null;
  uploadPending: boolean;
  downloadPending: boolean;
  canPlayPreview: boolean;
  canAutoDownload: boolean;
  playPreviewOpen: boolean;
  setPlayPreviewOpen: (open: boolean) => void;
  downloadDialogOpen: boolean;
  setDownloadDialogOpen: (open: boolean) => void;
  showUploadButton: boolean;
  searchKeyword?: string;
  onPreviewSubtitle: (video: Video, subtitle: Subtitle) => Promise<ArrayBuffer>;
  onSearchSubHD?: (video: Video, opts?: { query?: string; page?: number }) => Promise<SubHDSearchPage>;
  onDownloadSubHD?: (video: Video, sid: string, options?: SubHDDownloadOptions) => Promise<boolean>;
}) {
  const { t } = useI18n();

  return (
    <>
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
          searchKeyword={searchKeyword}
          onUploadLocal={showUploadButton ? workflow.openUploadPicker : undefined}
          uploadLocalPending={uploadPending || workflow.zipLoading}
        />
      ) : null}

    </>
  );
}
