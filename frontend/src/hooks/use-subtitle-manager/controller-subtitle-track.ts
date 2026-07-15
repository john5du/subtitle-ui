import type { Subtitle, SubtitleSourceEncoding, SubtitleUploadOptions, Video } from "@/lib/types";
import { requestBinary, requestPayload } from "@/lib/subtitle-manager/api-client";

import { formatOffsetMilliseconds, type ControllerRuntime } from "./controller-runtime";
import type { SubtitleRefresh } from "./controller-subtitle-refresh";

export function createSubtitleTrackActions(runtime: ControllerRuntime, refresh: SubtitleRefresh) {
  const {
    setSubtitleActionPending,
    beginUpload,
    endUpload,
    setTranslatedMessage,
    notifySuccess,
    reportRequestError
  } = runtime;
  const { refreshAfterSubtitleMutation } = refresh;

  async function uploadSubtitle(video: Video, file: File, label: string, options: SubtitleUploadOptions = {}) {
    const body = new FormData();
    body.append("file", file);
    body.append("label", label || "");
    if (options.archiveEntry?.trim()) {
      body.append("archiveEntry", options.archiveEntry.trim());
    }
    if (options.convertToAss) {
      body.append("convertTo", "ass");
      body.append("sourceEncoding", options.sourceEncoding || "auto");
    }

    const previousSubtitleCount = video.subtitles.length;
    setSubtitleActionPending({
      kind: "upload",
      videoId: video.id
    });
    beginUpload("status.uploadingSubtitleFile");
    try {
      await requestPayload(`/api/videos/${video.id}/subtitles`, { method: "POST", body });
      await refreshAfterSubtitleMutation(video, previousSubtitleCount);
      setTranslatedMessage("status.uploadedSubtitleFor", { title: video.title || video.fileName });
      notifySuccess(runtime.t("toast.subtitleUploadedTitle"), video.title || video.fileName);
      return true;
    } catch (error) {
      if (options.convertToAss) {
        try {
          await refreshAfterSubtitleMutation(video, previousSubtitleCount);
        } catch {
          // Best-effort refresh: conversion can fail after the original SRT is saved.
        }
      }
      reportRequestError("error.uploadFailed", error);
      return false;
    } finally {
      endUpload();
      setSubtitleActionPending(null);
    }
  }

  async function replaceSubtitle(video: Video, subtitle: Subtitle, file: File, options: { archiveEntry?: string } = {}) {
    const body = new FormData();
    body.append("file", file);
    body.append("replaceId", subtitle.id);
    if (options.archiveEntry?.trim()) {
      body.append("archiveEntry", options.archiveEntry.trim());
    }

    setSubtitleActionPending({
      kind: "replace",
      videoId: video.id,
      subtitleId: subtitle.id,
      subtitleFileName: subtitle.fileName
    });
    beginUpload("status.uploadingSubtitleFile");
    try {
      await requestPayload(`/api/videos/${video.id}/subtitles`, { method: "POST", body });
      await refreshAfterSubtitleMutation(video, video.subtitles.length);
      setTranslatedMessage("status.replacedSubtitle", { name: subtitle.fileName });
      notifySuccess(runtime.t("toast.subtitleReplacedTitle"), subtitle.fileName);
      return true;
    } catch (error) {
      reportRequestError("error.replaceFailed", error);
      return false;
    } finally {
      endUpload();
      setSubtitleActionPending(null);
    }
  }

  async function convertSubtitleToAss(video: Video, subtitle: Subtitle, sourceEncoding: SubtitleSourceEncoding = "auto") {
    setSubtitleActionPending({
      kind: "convert",
      videoId: video.id,
      subtitleId: subtitle.id,
      subtitleFileName: subtitle.fileName
    });
    beginUpload("status.convertingSubtitle");
    try {
      await requestPayload(`/api/videos/${video.id}/subtitles/${subtitle.id}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetFormat: "ass", sourceEncoding })
      });
      await refreshAfterSubtitleMutation(video, video.subtitles.length);
      setTranslatedMessage("status.convertedSubtitle", { name: subtitle.fileName });
      notifySuccess(runtime.t("toast.subtitleConvertedTitle"), subtitle.fileName);
      return true;
    } catch (error) {
      reportRequestError("error.convertFailed", error);
      return false;
    } finally {
      endUpload();
      setSubtitleActionPending(null);
    }
  }

  async function offsetSubtitleTiming(video: Video, subtitle: Subtitle, offsetMs: number) {
    setSubtitleActionPending({
      kind: "offset",
      videoId: video.id,
      subtitleId: subtitle.id,
      subtitleFileName: subtitle.fileName
    });
    beginUpload("status.offsettingSubtitle");
    try {
      await requestPayload(`/api/videos/${video.id}/subtitles/${subtitle.id}/timing/offset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offsetMs })
      });
      await refreshAfterSubtitleMutation(video, video.subtitles.length);
      const offsetLabel = formatOffsetMilliseconds(offsetMs);
      setTranslatedMessage("status.offsetSubtitle", { name: subtitle.fileName, offset: offsetLabel });
      notifySuccess(runtime.t("toast.subtitleOffsetTitle"), `${subtitle.fileName} · ${offsetLabel}`);
      return true;
    } catch (error) {
      reportRequestError("error.offsetFailed", error);
      return false;
    } finally {
      endUpload();
      setSubtitleActionPending(null);
    }
  }

  async function removeSubtitle(video: Video, subtitle: Subtitle) {
    const previousSubtitleCount = video.subtitles.length;
    setSubtitleActionPending({
      kind: "delete",
      videoId: video.id,
      subtitleId: subtitle.id,
      subtitleFileName: subtitle.fileName
    });
    try {
      await requestPayload(`/api/videos/${video.id}/subtitles/${subtitle.id}`, { method: "DELETE" });
      await refreshAfterSubtitleMutation(video, previousSubtitleCount);
      setTranslatedMessage("status.deletedSubtitle", { name: subtitle.fileName });
      notifySuccess(runtime.t("toast.subtitleDeletedTitle"), subtitle.fileName);
      return true;
    } catch (error) {
      reportRequestError("error.deleteFailed", error);
      return false;
    } finally {
      setSubtitleActionPending(null);
    }
  }

  async function previewSubtitle(video: Video, subtitle: Subtitle) {
    try {
      return await requestBinary(`/api/videos/${video.id}/subtitles/${subtitle.id}/content`);
    } catch (error) {
      reportRequestError("error.previewFailed", error);
      throw error;
    }
  }

  return {
    uploadSubtitle,
    replaceSubtitle,
    convertSubtitleToAss,
    offsetSubtitleTiming,
    removeSubtitle,
    previewSubtitle
  };
}
