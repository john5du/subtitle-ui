"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type ChangeEvent, type Ref } from "react";

import { useI18n } from "@/lib/i18n";
import { emitToast } from "@/lib/toast";
import type { Subtitle, SubtitleSourceEncoding, SubtitleUploadOptions, Video } from "@/lib/types";
import {
  extractSubtitleEntriesFromArchiveFile,
  isArchiveFileName,
  isSubtitleFileName,
  toSubtitleFile,
  type ZipSubtitleEntry
} from "@/lib/subtitle-zip";

import type { SubtitleDetailsPanelHandle } from "../types";
import { decodeSubtitlePreviewContent } from "./preview-utils";

export const ACCEPTED_SUBTITLE_UPLOAD_TYPES = ".srt,.ass,.ssa,.vtt,.sub,.zip,.7z,.rar";

export function isSRTFileName(fileName: string) {
  return fileName.toLowerCase().endsWith(".srt");
}

export function isSRTSubtitle(subtitle: Subtitle) {
  return subtitle.format.toLowerCase() === "srt" || isSRTFileName(subtitle.fileName);
}

export function isTimingOffsetSupported(subtitle: Subtitle) {
  const format = subtitle.format.toLowerCase();
  const fileName = subtitle.fileName.toLowerCase();
  return (
    format === "srt" ||
    format === "vtt" ||
    format === "ass" ||
    format === "ssa" ||
    fileName.endsWith(".srt") ||
    fileName.endsWith(".vtt") ||
    fileName.endsWith(".ass") ||
    fileName.endsWith(".ssa")
  );
}

export function formatSubtitleSize(size: number) {
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

export type PreviewStatus = "idle" | "loading" | "success" | "error" | "empty";

export interface UseSubtitleFileWorkflowParams {
  selectedVideo: Video | null;
  busy: boolean;
  onUpload: (video: Video, file: File, label: string, options?: SubtitleUploadOptions) => Promise<boolean>;
  onReplace: (video: Video, subtitle: Subtitle, file: File) => Promise<boolean>;
  onConvertSubtitle: (video: Video, subtitle: Subtitle, sourceEncoding?: SubtitleSourceEncoding) => Promise<boolean>;
  onOffsetSubtitle: (video: Video, subtitle: Subtitle, offsetMs: number) => Promise<boolean>;
  onRemove: (video: Video, subtitle: Subtitle) => Promise<boolean>;
  onPreviewSubtitle: (video: Video, subtitle: Subtitle) => Promise<ArrayBuffer>;
  handleRef?: Ref<SubtitleDetailsPanelHandle>;
  confirmReplace?: boolean;
  onMutationSuccess?: () => void;
}

export function useSubtitleFileWorkflow({
  selectedVideo,
  busy,
  onUpload,
  onReplace,
  onConvertSubtitle,
  onOffsetSubtitle,
  onRemove,
  onPreviewSubtitle,
  handleRef,
  confirmReplace = false,
  onMutationSuccess
}: UseSubtitleFileWorkflowParams) {
  const { t } = useI18n();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<Record<string, HTMLInputElement | null>>({});

  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [uploadLabel, setUploadLabel] = useState("zh");
  const [uploadConvertToAss, setUploadConvertToAss] = useState(false);
  const [uploadSourceEncoding, setUploadSourceEncoding] = useState<SubtitleSourceEncoding>("auto");
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
  const [pendingConvertSubtitle, setPendingConvertSubtitle] = useState<Subtitle | null>(null);
  const [convertSourceEncoding, setConvertSourceEncoding] = useState<SubtitleSourceEncoding>("auto");
  const [pendingOffsetSubtitle, setPendingOffsetSubtitle] = useState<Subtitle | null>(null);
  const [offsetSeconds, setOffsetSeconds] = useState("");
  const [pendingReplace, setPendingReplace] = useState<{ subtitle: Subtitle; file: File } | null>(null);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>("idle");
  const [previewError, setPreviewError] = useState("");
  const [previewContent, setPreviewContent] = useState("");
  const [previewEncoding, setPreviewEncoding] = useState("");
  const [previewTruncated, setPreviewTruncated] = useState(false);

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
    setUploadConvertToAss(false);
    setUploadSourceEncoding("auto");
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

  useEffect(() => {
    resetUploadState();
    resetZipPickState();
    resetPreviewState();
    setDeleteDialogSubtitleId(null);
    setPendingConvertSubtitle(null);
    setConvertSourceEncoding("auto");
    setPendingOffsetSubtitle(null);
    setOffsetSeconds("");
    setPendingReplace(null);
  }, [selectedVideo?.id]);

  function openUploadPicker() {
    if (busy || zipLoading) {
      return;
    }
    uploadInputRef.current?.click();
  }

  useImperativeHandle(handleRef, () => ({
    openUploadPicker
  }));

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
      setUploadConvertToAss(false);
      setUploadSourceEncoding("auto");
      setUploadDialogOpen(true);
      return;
    }

    if (!selectedVideo || !targetSubtitle) {
      return;
    }

    if (confirmReplace) {
      setPendingReplace({ subtitle: targetSubtitle, file });
      return;
    }

    const success = await onReplace(selectedVideo, targetSubtitle, file);
    if (success) {
      setZipPickError("");
      onMutationSuccess?.();
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
    const success = await onUpload(selectedVideo, pendingUploadFile, uploadLabel.trim(), {
      convertToAss: uploadConvertToAss && isSRTFileName(pendingUploadFile.name),
      sourceEncoding: uploadSourceEncoding
    });
    if (success) {
      resetUploadState();
      setZipPickError("");
      onMutationSuccess?.();
    }
  }

  async function confirmReplaceSubtitle() {
    if (!pendingReplace || !selectedVideo) {
      return;
    }
    const { subtitle, file } = pendingReplace;
    const success = await onReplace(selectedVideo, subtitle, file);
    if (success) {
      setPendingReplace(null);
      onMutationSuccess?.();
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
        onMutationSuccess?.();
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
      onMutationSuccess?.();
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
      onMutationSuccess?.();
    }
  }

  async function confirmConvertSubtitle() {
    if (!selectedVideo || !pendingConvertSubtitle) {
      return;
    }
    const success = await onConvertSubtitle(selectedVideo, pendingConvertSubtitle, convertSourceEncoding);
    if (success) {
      setPendingConvertSubtitle(null);
      setConvertSourceEncoding("auto");
      onMutationSuccess?.();
    }
  }

  async function confirmOffsetSubtitle(offsetMs: number) {
    if (!selectedVideo || !pendingOffsetSubtitle) {
      return;
    }
    const success = await onOffsetSubtitle(selectedVideo, pendingOffsetSubtitle, offsetMs);
    if (success) {
      setPendingOffsetSubtitle(null);
      setOffsetSeconds("");
      onMutationSuccess?.();
    }
  }

  const setReplaceInputNode = useCallback((subtitleId: string, node: HTMLInputElement | null) => {
    replaceInputRef.current[subtitleId] = node;
  }, []);

  return {
    t,
    uploadInputRef,
    replaceInputRef,
    setReplaceInputNode,
    openUploadPicker,
    uploadDialogOpen,
    setUploadDialogOpen,
    pendingUploadFile,
    setPendingUploadFile,
    uploadLabel,
    setUploadLabel,
    uploadConvertToAss,
    setUploadConvertToAss,
    uploadSourceEncoding,
    setUploadSourceEncoding,
    zipPickDialogOpen,
    setZipPickDialogOpen,
    zipPickMode,
    zipPickFileName,
    zipPickEntries,
    zipUploadLabel,
    setZipUploadLabel,
    selectedZipEntryId,
    setSelectedZipEntryId,
    zipPickError,
    setZipPickError,
    zipLoading,
    deleteDialogSubtitleId,
    setDeleteDialogSubtitleId,
    pendingConvertSubtitle,
    setPendingConvertSubtitle,
    convertSourceEncoding,
    setConvertSourceEncoding,
    pendingOffsetSubtitle,
    setPendingOffsetSubtitle,
    offsetSeconds,
    setOffsetSeconds,
    pendingReplace,
    setPendingReplace,
    previewDialogOpen,
    setPreviewDialogOpen,
    previewTitle,
    previewStatus,
    previewError,
    previewContent,
    previewEncoding,
    previewTruncated,
    resetUploadState,
    resetZipPickState,
    resetPreviewState,
    onUploadFileChange,
    onReplaceFilePicked,
    handlePickedFile,
    confirmUpload,
    confirmReplaceSubtitle,
    confirmZipEntrySelection,
    confirmDeleteSubtitle,
    confirmConvertSubtitle,
    confirmOffsetSubtitle,
    openStoredSubtitlePreview,
    openArchiveSubtitlePreview
  };
}
