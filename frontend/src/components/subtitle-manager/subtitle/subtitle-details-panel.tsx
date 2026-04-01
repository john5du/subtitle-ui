import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ChangeEvent } from "react";
import { ArrowLeft, ExternalLink, Eye, Pencil, Trash2, UploadCloud } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import type { Subtitle } from "@/lib/types";
import { buildSubtitleSearchLinks, buildSubtitleSearchLinksByKeyword } from "@/lib/subtitle-search";
import { emitToast } from "@/lib/toast";
import {
  extractSubtitleEntriesFromArchiveFile,
  isArchiveFileName,
  isSubtitleFileName,
  toSubtitleFile,
  type ZipSubtitleEntry
} from "@/lib/subtitle-zip";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import type { SubtitleDetailsPanelHandle, SubtitleDetailsPanelProps } from "../types";
import { InfoItem } from "../shared/info-item";
import { InlinePending, SpinnerIcon } from "../shared/pending-state";
import { decodeSubtitlePreviewContent } from "./preview-utils";
import { ArchiveEntryPickerDialog } from "./dialogs/archive-entry-picker-dialog";
import { DeleteSubtitleDialog } from "./dialogs/delete-subtitle-dialog";
import { SubtitlePreviewDialog } from "./dialogs/subtitle-preview-dialog";
import { UploadSubtitleDialog } from "./dialogs/upload-subtitle-dialog";

export const SubtitleDetailsPanel = forwardRef<SubtitleDetailsPanelHandle, SubtitleDetailsPanelProps>(function SubtitleDetailsPanel({
  panelTitle,
  selectedVideo,
  emptyText,
  showBack,
  onBack,
  infoRows,
  onUpload,
  onReplace,
  onRemove,
  onPreviewSubtitle,
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
  showSubtitleListCaption = true
}: SubtitleDetailsPanelProps, ref) {
  const { t } = useI18n();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<Record<string, HTMLInputElement | null>>({});

  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [uploadLabel, setUploadLabel] = useState("zh");
  const [zipPickDialogOpen, setZipPickDialogOpen] = useState(false);
  const [zipPickMode, setZipPickMode] = useState<"upload" | "replace">("upload");
  const [zipPickFileName, setZipPickFileName] = useState("");
  const [zipPickEntries, setZipPickEntries] = useState<ZipSubtitleEntry[]>([]);
  const [zipPickTargetSubtitle, setZipPickTargetSubtitle] = useState<Subtitle | null>(null);
  const [zipUploadLabel, setZipUploadLabel] = useState("zh");
  const [selectedZipEntryId, setSelectedZipEntryId] = useState("");
  const [zipPickError, setZipPickError] = useState("");
  const [zipLoading, setZipLoading] = useState(false);
  const [deleteDialogSubtitleId, setDeleteDialogSubtitleId] = useState<string | null>(null);
  const [flashSubtitleList, setFlashSubtitleList] = useState(false);
  const [metaExpanded, setMetaExpanded] = useState(!metaCollapsedByDefault);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewStatus, setPreviewStatus] = useState<"idle" | "loading" | "success" | "error" | "empty">("idle");
  const [previewError, setPreviewError] = useState("");
  const [previewContent, setPreviewContent] = useState("");
  const [previewEncoding, setPreviewEncoding] = useState("");
  const [previewTruncated, setPreviewTruncated] = useState(false);

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
  const searchActionItems = showSearchLinks && searchLinks
    ? [
        { label: "Zimuku", href: searchLinks.zimuku },
        { label: "SubHD", href: searchLinks.subhd }
      ]
    : [];
  const subtitleActionWidthClass = "w-full sm:w-auto";
  const showPrimaryUploadButton = showUploadButton;
  const hasActionToolbar = showPrimaryUploadButton || searchActionItems.length > 0 || zipLoading || Boolean(zipPickError);
  const detailsInfoGrid = selectedVideo ? (
    <div className="grid gap-2 text-sm md:grid-cols-2">
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

  function triggerSubtitleListFlash() {
    setFlashSubtitleList(false);
    window.requestAnimationFrame(() => {
      setFlashSubtitleList(true);
      window.setTimeout(() => setFlashSubtitleList(false), 900);
    });
  }

  function resetZipPickState() {
    setZipPickDialogOpen(false);
    setZipPickMode("upload");
    setZipPickFileName("");
    setZipPickEntries([]);
    setZipPickTargetSubtitle(null);
    setZipUploadLabel("zh");
    setSelectedZipEntryId("");
    setZipPickError("");
    setZipLoading(false);
  }

  function resetUploadState() {
    setUploadDialogOpen(false);
    setPendingUploadFile(null);
    setUploadLabel("zh");
  }

  function resetPreviewState() {
    setPreviewDialogOpen(false);
    setPreviewTitle("");
    setPreviewStatus("idle");
    setPreviewError("");
    setPreviewContent("");
    setPreviewEncoding("");
    setPreviewTruncated(false);
  }

  function openPreviewFromBuffer(name: string, buffer: ArrayBuffer) {
    setPreviewDialogOpen(true);
    setPreviewTitle(name || "-");
    try {
      const decoded = decodeSubtitlePreviewContent(buffer);
      if (!decoded.text.trim()) {
        setPreviewStatus("empty");
        setPreviewError("");
        setPreviewContent("");
        setPreviewEncoding(decoded.encoding);
        setPreviewTruncated(false);
        return;
      }

      setPreviewStatus("success");
      setPreviewError("");
      setPreviewContent(decoded.text);
      setPreviewEncoding(decoded.encoding);
      setPreviewTruncated(decoded.truncated);
    } catch (error) {
      const errText = error instanceof Error ? error.message : String(error);
      setPreviewStatus("error");
      setPreviewError(errText);
      setPreviewContent("");
      setPreviewEncoding("");
      setPreviewTruncated(false);
    }
  }

  async function openStoredSubtitlePreview(subtitle: Subtitle) {
    if (!selectedVideo) {
      return;
    }

    setPreviewDialogOpen(true);
    setPreviewTitle(subtitle.fileName || "-");
    setPreviewStatus("loading");
    setPreviewError("");
    setPreviewContent("");
    setPreviewEncoding("");
    setPreviewTruncated(false);

    try {
      const data = await onPreviewSubtitle(selectedVideo, subtitle);
      openPreviewFromBuffer(subtitle.fileName, data);
    } catch (error) {
      const errText = error instanceof Error ? error.message : String(error);
      setPreviewStatus("error");
      setPreviewError(errText);
    }
  }

  function openArchiveSubtitlePreview(entry: ZipSubtitleEntry) {
    openPreviewFromBuffer(entry.fileName || entry.path || "-", entry.data);
  }

  useEffect(() => {
    resetUploadState();
    resetZipPickState();
    resetPreviewState();
    setDeleteDialogSubtitleId(null);
    setFlashSubtitleList(false);
  }, [selectedVideo?.id]);

  useEffect(() => {
    setMetaExpanded(!metaCollapsedByDefault);
  }, [metaCollapsedByDefault, selectedVideo?.id]);

  function openUploadPicker() {
    if (busy || zipLoading) {
      return;
    }
    uploadInputRef.current?.click();
  }

  useImperativeHandle(ref, () => ({
    openUploadPicker
  }));

  async function openZipPicker(file: File, mode: "upload" | "replace", targetSubtitle: Subtitle | null) {
    setZipLoading(true);
    setZipPickError("");

    try {
      const entries = await extractSubtitleEntriesFromArchiveFile(file);
      if (entries.length === 0) {
        setZipPickError(t("details.noSubtitleFilesInArchive"));
        emitToast({
          level: "error",
          title: t("toast.archiveParsingFailedTitle"),
          message: t("toast.archiveParsingNoSubtitleMessage")
        });
        return;
      }
      setZipPickMode(mode);
      setZipPickTargetSubtitle(targetSubtitle);
      if (mode === "upload") {
        setZipUploadLabel(uploadLabel.trim() || "zh");
      }
      setZipPickFileName(file.name);
      setZipPickEntries(entries);
      setSelectedZipEntryId("");
      setZipPickDialogOpen(true);
      emitToast({
        level: "info",
        title: t("toast.archiveParsedTitle"),
        message: t("toast.archiveParsedMessage", { count: entries.length }),
        detail: file.name
      });
    } catch (error) {
      const errText = error instanceof Error ? error.message : String(error);
      setZipPickError(t("details.parseArchiveFailed", { error: errText }));
      emitToast({
        level: "error",
        title: t("toast.archiveParsingFailedTitle"),
        message: errText,
        detail: file.name
      });
    } finally {
      setZipLoading(false);
    }
  }

  function onUploadFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    if (isArchiveFileName(file.name)) {
      void openZipPicker(file, "upload", null);
      return;
    }
    if (!isSubtitleFileName(file.name)) {
      setZipPickError(t("details.unsupportedFileType"));
      emitToast({
        level: "error",
        title: t("toast.unsupportedFileTitle"),
        message: file.name,
        detail: t("toast.unsupportedFileDetail")
      });
      return;
    }
    setPendingUploadFile(file);
    setUploadDialogOpen(true);
  }

  async function confirmUpload() {
    if (!selectedVideo || !pendingUploadFile) return;
    const success = await onUpload(selectedVideo, pendingUploadFile, uploadLabel.trim());
    if (success) {
      resetUploadState();
      triggerSubtitleListFlash();
    }
  }

  async function onReplaceFilePicked(subtitle: Subtitle, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file || !selectedVideo) return;
    if (isArchiveFileName(file.name)) {
      await openZipPicker(file, "replace", subtitle);
      return;
    }
    if (!isSubtitleFileName(file.name)) {
      setZipPickError(t("details.unsupportedFileType"));
      emitToast({
        level: "error",
        title: t("toast.unsupportedFileTitle"),
        message: file.name,
        detail: t("toast.unsupportedFileDetail")
      });
      return;
    }
    const success = await onReplace(selectedVideo, subtitle, file);
    if (success) {
      triggerSubtitleListFlash();
    }
  }

  async function onZipEntryPicked(entry: ZipSubtitleEntry) {
    if (!selectedVideo) {
      return;
    }

    const selectedFile = toSubtitleFile(entry);
    if (zipPickMode === "upload") {
      const success = await onUpload(selectedVideo, selectedFile, zipUploadLabel.trim());
      if (success) {
        resetZipPickState();
        triggerSubtitleListFlash();
      }
      return;
    }

    if (!zipPickTargetSubtitle) {
      setZipPickError(t("details.missingReplaceTarget"));
      return;
    }

    const success = await onReplace(selectedVideo, zipPickTargetSubtitle, selectedFile);
    if (success) {
      resetZipPickState();
      triggerSubtitleListFlash();
    }
  }

  async function confirmZipEntrySelection() {
    const entry = zipPickEntries.find((item) => item.id === selectedZipEntryId);
    if (!entry) {
      setZipPickError(t("details.selectArchiveEntryFirst"));
      return;
    }
    await onZipEntryPicked(entry);
  }

  async function confirmDeleteSubtitle(subtitle: Subtitle) {
    if (!selectedVideo) {
      return;
    }
    const success = await onRemove(selectedVideo, subtitle);
    if (success) {
      setDeleteDialogSubtitleId(null);
      triggerSubtitleListFlash();
    }
  }

  return (
    <Card className="animate-fade-in-up flex h-full w-full flex-col border bg-card">
      <CardHeader className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <CardTitle className="text-lg">{panelTitle}</CardTitle>
            {selectedVideo ? (
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="text-[11px]">
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
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-4 p-4 pt-0">
        {!selectedVideo ? (
          <div className="flex flex-1 items-center justify-center rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
            {emptyText}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            {showMetaSection
              ? compactMeta
                ? (
                    <div className="surface-subtle space-y-3 rounded-xl p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="max-w-full truncate text-sm font-semibold sm:max-w-[60%]">
                          {selectedVideo.title || selectedVideo.fileName || "-"}
                        </p>
                        <Badge variant="secondary" className="text-[11px]">
                          {t("tv.subtitleCount", { count: selectedVideo.subtitles.length })}
                        </Badge>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        onClick={() => setMetaExpanded((prev) => !prev)}
                      >
                        {metaExpanded ? t("details.lessInfo") : t("details.moreInfo")}
                      </Button>
                      {metaExpanded && detailsInfoGrid}
                    </div>
                  )
                : detailsInfoGrid
              : null}

            <input
              ref={uploadInputRef}
              type="file"
              accept=".srt,.ass,.ssa,.vtt,.sub,.zip,.7z,.rar"
              className="hidden"
              onChange={onUploadFileChange}
            />
            {hasActionToolbar && (
              <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-background/60 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  {showPrimaryUploadButton && (
                    <Button
                      type="button"
                      size="sm"
                      className={cn("gap-1.5", subtitleActionWidthClass)}
                      disabled={busy || zipLoading}
                      onClick={openUploadPicker}
                    >
                      {uploadPending || zipLoading ? <SpinnerIcon className="h-4 w-4" /> : <UploadCloud className="h-4 w-4" />}
                      <span>{uploadPending ? uploadingMessage || t("details.uploading") : t("movie.uploadSubtitleArchive")}</span>
                    </Button>
                  )}
                  {zipLoading && <InlinePending label={t("details.parsingArchive")} />}
                </div>
                {searchActionItems.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {searchActionItems.map((item) => (
                      <Button key={item.label} type="button" variant="outline" size="sm" className={subtitleActionWidthClass} asChild>
                        <a href={item.href} target="_blank" rel="noreferrer">
                          <span>{item.label}</span>
                          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                        </a>
                      </Button>
                    ))}
                  </div>
                )}
                {zipPickError && <span className="text-xs text-destructive">{zipPickError}</span>}
              </div>
            )}

            <div className={cn("surface-subtle min-h-0 flex-1 rounded-xl", flashSubtitleList && "animate-highlight-flash")}>
              <ScrollArea className="h-full min-h-0">
                <Table>
                  {showSubtitleListCaption ? <TableCaption>{t("details.subtitleListCaption")}</TableCaption> : null}
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("details.name")}</TableHead>
                      <TableHead>{t("details.lang")}</TableHead>
                      <TableHead>{t("batch.format")}</TableHead>
                      <TableHead>{t("details.modified")}</TableHead>
                      <TableHead className="w-[196px] text-right">{t("common.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedVideo.subtitles.map((subtitle) => {
                      const replacePending = subtitleAction?.kind === "replace" && subtitleAction.subtitleId === subtitle.id;
                      const deletePending = subtitleAction?.kind === "delete" && subtitleAction.subtitleId === subtitle.id;
                      const rowBusy = replacePending || deletePending;

                      return (
                        <TableRow key={subtitle.id} className={cn(rowBusy && "animate-pulse-soft bg-muted/40")}>
                          <TableCell className="break-all">{subtitle.fileName}</TableCell>
                          <TableCell>{subtitle.language || "-"}</TableCell>
                          <TableCell>{subtitle.format || "-"}</TableCell>
                          <TableCell>{formatTime(subtitle.modTime)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <input
                                ref={(node) => {
                                  replaceInputRef.current[subtitle.id] = node;
                                }}
                                type="file"
                                accept=".srt,.ass,.ssa,.vtt,.sub,.zip,.7z,.rar"
                                className="hidden"
                                onChange={(event) => {
                                  void onReplaceFilePicked(subtitle, event);
                                }}
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 gap-1 px-2"
                                disabled={busy || rowBusy}
                                onClick={() => void openStoredSubtitlePreview(subtitle)}
                              >
                                <Eye className="h-3.5 w-3.5" />
                                {t("common.preview")}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 gap-1 px-2"
                                disabled={busy || rowBusy}
                                onClick={() => replaceInputRef.current[subtitle.id]?.click()}
                              >
                                {replacePending ? <SpinnerIcon className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                                {replacePending ? t("details.replacing") : t("details.replaceSubtitle")}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 gap-1 border-destructive/25 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                disabled={busy || rowBusy}
                                onClick={() => setDeleteDialogSubtitleId(subtitle.id)}
                              >
                                {deletePending ? <SpinnerIcon className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                                {deletePending ? t("details.deleting") : t("details.deleteSubtitle")}
                              </Button>

                              <DeleteSubtitleDialog
                                open={deleteDialogSubtitleId === subtitle.id}
                                onOpenChange={(open) => {
                                  if (!open) {
                                    setDeleteDialogSubtitleId((current) => (current === subtitle.id ? null : current));
                                    return;
                                  }
                                  setDeleteDialogSubtitleId(subtitle.id);
                                }}
                                subtitle={subtitle}
                                deletePending={deletePending}
                                onConfirm={() => {
                                  void confirmDeleteSubtitle(subtitle);
                                }}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}

                    {selectedVideo.subtitles.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                          {t("details.noSubtitles")}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          </div>
        )}
      </CardContent>

      <UploadSubtitleDialog
        open={uploadDialogOpen}
        onOpenChange={(open) => {
          if (!open && uploading) {
            return;
          }
          if (!open) {
            resetUploadState();
            return;
          }
          setUploadDialogOpen(open);
        }}
        pendingUploadFile={pendingUploadFile}
        uploadLabel={uploadLabel}
        onUploadLabelChange={setUploadLabel}
        onConfirm={() => void confirmUpload()}
        busy={busy || !selectedVideo}
        uploadPending={uploadPending}
      />

      <ArchiveEntryPickerDialog
        open={zipPickDialogOpen}
        onOpenChange={(open) => {
          if (!open && uploading) {
            return;
          }
          if (!open) {
            resetZipPickState();
            return;
          }
          setZipPickDialogOpen(true);
        }}
        mode={zipPickMode}
        zipPickFileName={zipPickFileName}
        zipPickEntries={zipPickEntries}
        zipUploadLabel={zipUploadLabel}
        onZipUploadLabelChange={setZipUploadLabel}
        selectedZipEntryId={selectedZipEntryId}
        onSelectZipEntryId={(value) => {
          setSelectedZipEntryId(value);
          setZipPickError("");
        }}
        onPreviewEntry={openArchiveSubtitlePreview}
        onConfirm={() => void confirmZipEntrySelection()}
        busy={busy}
        uploading={uploading}
        zipLoading={zipLoading}
      />

      <SubtitlePreviewDialog
        open={previewDialogOpen}
        onOpenChange={setPreviewDialogOpen}
        previewTitle={previewTitle}
        previewStatus={previewStatus}
        previewError={previewError}
        previewContent={previewContent}
        previewEncoding={previewEncoding}
        previewTruncated={previewTruncated}
      />
    </Card>
  );
});

SubtitleDetailsPanel.displayName = "SubtitleDetailsPanel";
