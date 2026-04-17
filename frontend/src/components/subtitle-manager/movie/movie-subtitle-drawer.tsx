"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent
} from "react";
import { ExternalLink, Eye, FileArchive, Languages, Pencil, Trash2, UploadCloud } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { buildSubtitleSearchLinks } from "@/lib/subtitle-search";
import { emitToast } from "@/lib/toast";
import type { Subtitle } from "@/lib/types";
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
import { ScrollArea } from "@/components/ui/scroll-area";

import type { SubtitleDetailsPanelHandle, SubtitleDetailsPanelProps } from "../types";
import { InlinePending, SpinnerIcon } from "../shared/pending-state";
import { ArchiveEntryPickerDialog } from "../subtitle/dialogs/archive-entry-picker-dialog";
import { DeleteSubtitleDialog } from "../subtitle/dialogs/delete-subtitle-dialog";
import { SubtitlePreviewDialog } from "../subtitle/dialogs/subtitle-preview-dialog";
import { UploadSubtitleDialog } from "../subtitle/dialogs/upload-subtitle-dialog";
import { decodeSubtitlePreviewContent } from "../subtitle/preview-utils";

const ACCEPTED_UPLOAD_TYPES = ".srt,.ass,.ssa,.vtt,.sub,.zip,.7z,.rar";

function formatSubtitleSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) {
    return "-";
  }

  if (size < 1024) {
    return `${Math.round(size)} B`;
  }

  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

type MovieSubtitleDrawerProps = Pick<
  SubtitleDetailsPanelProps,
  "selectedVideo" | "emptyText" | "onUpload" | "onReplace" | "onRemove" | "onPreviewSubtitle" | "formatTime" | "busy" | "uploading" | "uploadingMessage" | "subtitleAction"
>;

export const MovieSubtitleDrawer = forwardRef<SubtitleDetailsPanelHandle, MovieSubtitleDrawerProps>(function MovieSubtitleDrawer(
  {
    selectedVideo,
    emptyText,
    onUpload,
    onReplace,
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
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<Record<string, HTMLInputElement | null>>({});
  const dragDepthRef = useRef(0);
  const subtitleRowActionButtonClassName = "h-8 gap-1 px-2 text-[11px]";

  const [dragActive, setDragActive] = useState(false);
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
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewStatus, setPreviewStatus] = useState<"idle" | "loading" | "success" | "error" | "empty">("idle");
  const [previewError, setPreviewError] = useState("");
  const [previewContent, setPreviewContent] = useState("");
  const [previewEncoding, setPreviewEncoding] = useState("");
  const [previewTruncated, setPreviewTruncated] = useState(false);

  const searchLinks = useMemo(() => (selectedVideo ? buildSubtitleSearchLinks(selectedVideo) : null), [selectedVideo]);
  const uploadPending = subtitleAction?.kind === "upload" && subtitleAction.videoId === selectedVideo?.id;
  const selectedMovieTitle = selectedVideo?.title || selectedVideo?.fileName || t("details.movieManagementTitle");

  useEffect(() => {
    setDragActive(false);
    dragDepthRef.current = 0;
    setUploadDialogOpen(false);
    setPendingUploadFile(null);
    setUploadLabel("zh");
    setZipPickDialogOpen(false);
    setZipPickMode("upload");
    setZipPickFileName("");
    setZipPickEntries([]);
    setZipPickTargetSubtitle(null);
    setZipUploadLabel("zh");
    setSelectedZipEntryId("");
    setZipPickError("");
    setZipLoading(false);
    setDeleteDialogSubtitleId(null);
    setPreviewDialogOpen(false);
    setPreviewTitle("");
    setPreviewStatus("idle");
    setPreviewError("");
    setPreviewContent("");
    setPreviewEncoding("");
    setPreviewTruncated(false);
  }, [selectedVideo?.id]);

  function openUploadPicker() {
    if (busy || zipLoading) {
      return;
    }
    uploadInputRef.current?.click();
  }

  useImperativeHandle(ref, () => ({
    openUploadPicker
  }));

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

  async function handlePickedFile(file: File, mode: "upload" | "replace", targetSubtitle: Subtitle | null) {
    if (isArchiveFileName(file.name)) {
      await openZipPicker(file, mode, targetSubtitle);
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

    if (mode === "upload") {
      setPendingUploadFile(file);
      setUploadDialogOpen(true);
      return;
    }

    if (!selectedVideo || !targetSubtitle) {
      return;
    }

    const success = await onReplace(selectedVideo, targetSubtitle, file);
    if (success) {
      setZipPickError("");
    }
  }

  function onUploadFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) {
      return;
    }
    void handlePickedFile(file, "upload", null);
  }

  async function onReplaceFilePicked(subtitle: Subtitle, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) {
      return;
    }
    await handlePickedFile(file, "replace", subtitle);
  }

  async function confirmUpload() {
    if (!selectedVideo || !pendingUploadFile) {
      return;
    }
    const success = await onUpload(selectedVideo, pendingUploadFile, uploadLabel.trim());
    if (success) {
      setUploadDialogOpen(false);
      setPendingUploadFile(null);
      setUploadLabel("zh");
      setZipPickError("");
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
        setZipPickDialogOpen(false);
        setSelectedZipEntryId("");
        setZipPickError("");
      }
      return;
    }

    if (!zipPickTargetSubtitle) {
      setZipPickError(t("details.missingReplaceTarget"));
      return;
    }

    const success = await onReplace(selectedVideo, zipPickTargetSubtitle, selectedFile);
    if (success) {
      setZipPickDialogOpen(false);
      setSelectedZipEntryId("");
      setZipPickError("");
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
    }
  }

  function handleDropzoneDragEnter(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (busy || zipLoading) {
      return;
    }
    dragDepthRef.current += 1;
    setDragActive(true);
  }

  function handleDropzoneDragOver(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (busy || zipLoading) {
      return;
    }
    event.dataTransfer.dropEffect = "copy";
    setDragActive(true);
  }

  function handleDropzoneDragLeave(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (busy || zipLoading) {
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
    if (busy || zipLoading) {
      return;
    }
    dragDepthRef.current = 0;
    setDragActive(false);
    const file = event.dataTransfer.files?.[0] ?? null;
    if (!file) {
      return;
    }
    void handlePickedFile(file, "upload", null);
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-card">
      <div className="border-b border-border/70 bg-card/96 px-5 pb-4 pt-5 sm:px-6">
        <p className="text-display text-[11px] font-semibold uppercase tracking-[0.26em] text-[rgba(255,255,255,0.5)]">
          {t("movie.drawerEyebrow")}
        </p>
        <div className="mt-3 flex flex-wrap items-start gap-3 pr-10">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-2xl font-semibold tracking-tight sm:text-[2rem]">{selectedMovieTitle}</h2>
            {searchLinks ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" className="gap-1.5" asChild>
                  <a href={searchLinks.zimuku} target="_blank" rel="noreferrer">
                    <span>Zimuku</span>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                  </a>
                </Button>
                <Button type="button" variant="outline" size="sm" className="gap-1.5" asChild>
                  <a href={searchLinks.subhd} target="_blank" rel="noreferrer">
                    <span>SubHD</span>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                  </a>
                </Button>
              </div>
            ) : null}
          </div>
          {selectedVideo ? (
            <Badge variant="outline" className="border-[rgba(255,255,255,0.2)] bg-transparent px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-white">
              {t("tv.subtitleCount", { count: selectedVideo.subtitles.length })}
            </Badge>
          ) : null}
        </div>
      </div>

      {!selectedVideo ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-8">
          <div className="w-full border border-dashed border-border bg-[rgba(255,255,255,0.03)] px-6 py-12 text-center text-sm text-muted-foreground">
            {emptyText}
          </div>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1">
            <ScrollArea className="h-full">
              <div className="space-y-5 px-5 py-5 sm:px-6">
                <section className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold">{t("movie.drawerUploadTitle")}</h3>
                      <p className="text-sm text-muted-foreground">{t("movie.drawerUploadDescription")}</p>
                    </div>
                    {zipLoading ? (
                      <InlinePending label={t("details.parsingArchive")} />
                    ) : uploadPending ? (
                      <InlinePending label={uploadingMessage || t("details.uploading")} />
                    ) : null}
                  </div>

                  <input ref={uploadInputRef} type="file" accept={ACCEPTED_UPLOAD_TYPES} className="hidden" onChange={onUploadFileChange} />

                  <button
                    type="button"
                    aria-label={t("movie.drawerDropAria")}
                    className={cn(
                      "surface-transition flex w-full flex-col items-center justify-center gap-4 border border-dashed px-6 py-8 text-center",
                      dragActive
                        ? "border-[rgba(255,255,255,0.3)] bg-[rgba(255,255,255,0.05)]"
                        : "border-border bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.2)] hover:bg-[rgba(255,255,255,0.05)]",
                      (busy || zipLoading) && "cursor-not-allowed opacity-65"
                    )}
                    disabled={busy || zipLoading}
                    onClick={openUploadPicker}
                    onDragEnter={handleDropzoneDragEnter}
                    onDragOver={handleDropzoneDragOver}
                    onDragLeave={handleDropzoneDragLeave}
                    onDrop={handleDropzoneDrop}
                  >
                    <span className="flex h-16 w-16 items-center justify-center border border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.05)] text-white">
                      {uploadPending || zipLoading ? <SpinnerIcon className="h-7 w-7" /> : <UploadCloud className="h-7 w-7" />}
                    </span>
                    <div className="space-y-1">
                      <p className="text-base font-semibold">{dragActive ? t("movie.drawerUploadActive") : t("movie.uploadSubtitleArchive")}</p>
                      <p className="text-sm text-muted-foreground">{t("movie.drawerUploadHint")}</p>
                    </div>
                  </button>

                  {zipPickError ? <p className="text-sm text-destructive">{zipPickError}</p> : null}
                </section>

                <section className="space-y-3">
                  <div>
                    <h3 className="text-lg font-semibold">{t("movie.drawerRepositoryTitle")}</h3>
                    <p className="text-sm text-muted-foreground">{t("movie.drawerRepositoryDescription")}</p>
                  </div>

                  <div className="space-y-3">
                    {selectedVideo.subtitles.length === 0 ? (
                      <div className="border-dashed border border-border bg-[rgba(255,255,255,0.03)] px-5 py-8 text-center text-sm text-muted-foreground">
                        {t("movie.drawerEmptyRepository")}
                      </div>
                    ) : (
                      selectedVideo.subtitles.map((subtitle) => {
                        const replacePending = subtitleAction?.kind === "replace" && subtitleAction.subtitleId === subtitle.id;
                        const deletePending = subtitleAction?.kind === "delete" && subtitleAction.subtitleId === subtitle.id;
                        const rowBusy = replacePending || deletePending;

                        return (
                          <article
                            key={subtitle.id}
                            className={cn(
                              "border border-border bg-[rgba(255,255,255,0.03)] p-4",
                              rowBusy && "animate-pulse-soft"
                            )}
                          >
                            <div className="flex flex-wrap items-start gap-3">
                              <div className="flex h-11 w-11 shrink-0 items-center justify-center border border-border bg-[rgba(255,255,255,0.03)] text-[rgba(255,255,255,0.5)]">
                                <FileArchive className="h-5 w-5" />
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p
                                    className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground"
                                    title={subtitle.fileName || undefined}
                                  >
                                    {subtitle.fileName}
                                  </p>
                                  <Badge variant="secondary" className="shrink-0 text-[11px] uppercase">
                                    {subtitle.format || "-"}
                                  </Badge>
                                </div>

                                <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                                  <div className="flex items-center gap-2">
                                    <Languages className="h-3.5 w-3.5" />
                                    <span>{subtitle.language || "-"}</span>
                                  </div>
                                  <div>{t("details.sizeValue", { value: formatSubtitleSize(subtitle.size) })}</div>
                                  <div>{formatTime(subtitle.modTime)}</div>
                                </div>
                              </div>
                            </div>

                            <div className="mt-4 flex flex-wrap gap-1.5">
                              <input
                                ref={(node) => {
                                  replaceInputRef.current[subtitle.id] = node;
                                }}
                                type="file"
                                accept={ACCEPTED_UPLOAD_TYPES}
                                className="hidden"
                                onChange={(event) => {
                                  void onReplaceFilePicked(subtitle, event);
                                }}
                              />

                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className={subtitleRowActionButtonClassName}
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
                                className={subtitleRowActionButtonClassName}
                                disabled={busy || rowBusy}
                                onClick={() => replaceInputRef.current[subtitle.id]?.click()}
                              >
                                {replacePending ? <SpinnerIcon className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                                {replacePending ? t("common.replacing") : t("common.replace")}
                              </Button>

                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className={cn(
                                  subtitleRowActionButtonClassName,
                                  "border-red-500/25 text-red-400 hover:bg-red-500/10 hover:text-red-400"
                                )}
                                disabled={busy || rowBusy}
                                onClick={() => setDeleteDialogSubtitleId(subtitle.id)}
                              >
                                {deletePending ? <SpinnerIcon className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                                {deletePending ? t("common.deleting") : t("common.delete")}
                              </Button>
                            </div>

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
                          </article>
                        );
                      })
                    )}
                  </div>
                </section>
              </div>
            </ScrollArea>
          </div>
        </>
      )}

      <UploadSubtitleDialog
        open={uploadDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setUploadDialogOpen(false);
            setPendingUploadFile(null);
            return;
          }
          setUploadDialogOpen(true);
        }}
        pendingUploadFile={pendingUploadFile}
        uploadLabel={uploadLabel}
        onUploadLabelChange={setUploadLabel}
        onConfirm={() => {
          void confirmUpload();
        }}
        busy={busy}
        uploadPending={uploadPending}
      />

      <ArchiveEntryPickerDialog
        open={zipPickDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setZipPickDialogOpen(false);
            setSelectedZipEntryId("");
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
        onSelectZipEntryId={setSelectedZipEntryId}
        onPreviewEntry={openArchiveSubtitlePreview}
        onConfirm={() => {
          void confirmZipEntrySelection();
        }}
        busy={busy}
        uploading={uploading}
        zipLoading={zipLoading}
      />

      <SubtitlePreviewDialog
        open={previewDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            resetPreviewState();
            return;
          }
          setPreviewDialogOpen(true);
        }}
        previewTitle={previewTitle}
        previewStatus={previewStatus}
        previewError={previewError}
        previewContent={previewContent}
        previewEncoding={previewEncoding}
        previewTruncated={previewTruncated}
      />
    </div>
  );
});
