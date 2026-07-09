import type {
  BatchSubtitleUploadItem,
  BatchSubtitleUploadResult,
  Subtitle,
  SubtitleSourceEncoding,
  SubtitleUploadOptions,
  Video
} from "@/lib/types";
import { requestBinary, requestPayload } from "@/lib/subtitle-manager/api-client";

import { formatOffsetMilliseconds, type ControllerRuntime } from "./controller-runtime";
import type { LoadActions } from "./controller-load";

export function createSubtitleActions(runtime: ControllerRuntime, load: LoadActions) {
  const {
    state,
    selectors,
    t,
    setSubtitleActionPending,
    beginLoading,
    endLoading,
    beginUpload,
    updateUploadMessage,
    endUpload,
    setTranslatedMessage,
    notifySuccess,
    notifyInfo,
    reportRequestError
  } = runtime;
  const {
    loadMovieVideos,
    loadTvSeriesPage,
    refreshTvVideosForPath,
    requestTvVideosForPath,
    loadLogs
  } = load;

  async function refreshAfterSubtitleMutation(video: Video) {
    if (video.mediaType === "tv") {
      const targetDir =
        selectors.selectedTvSeries?.path ||
        state.selectedTvDirPath ||
        video.directory ||
        state.tvEpisodesPath ||
        selectors.tvRootPath ||
        state.directoryScan.tvRoot;
      await Promise.all([
        loadTvSeriesPage({ page: state.tvSeriesPager.page || 1, force: true }),
        refreshTvVideosForPath(targetDir || ""),
        loadLogs({ page: 1 })
      ]);
      return;
    }

    await Promise.all([loadMovieVideos({ page: selectors.moviePager.page || 1, force: true }), loadLogs({ page: 1 })]);
  }

  async function uploadSubtitle(video: Video, file: File, label: string, options: SubtitleUploadOptions = {}) {
    const body = new FormData();
    body.append("file", file);
    body.append("label", label || "");
    if (options.convertToAss) {
      body.append("convertTo", "ass");
      body.append("sourceEncoding", options.sourceEncoding || "auto");
    }

    setSubtitleActionPending({
      kind: "upload",
      videoId: video.id
    });
    beginUpload("status.uploadingSubtitleFile");
    try {
      await requestPayload(`/api/videos/${video.id}/subtitles`, { method: "POST", body });
      await refreshAfterSubtitleMutation(video);
      setTranslatedMessage("status.uploadedSubtitleFor", { title: video.title || video.fileName });
      notifySuccess(t("toast.subtitleUploadedTitle"), video.title || video.fileName, file.name);
      return true;
    } catch (error) {
      if (options.convertToAss) {
        try {
          await refreshAfterSubtitleMutation(video);
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

  async function replaceSubtitle(video: Video, subtitle: Subtitle, file: File) {
    const body = new FormData();
    body.append("file", file);
    body.append("replaceId", subtitle.id);

    setSubtitleActionPending({
      kind: "replace",
      videoId: video.id,
      subtitleId: subtitle.id,
      subtitleFileName: subtitle.fileName
    });
    beginUpload("status.uploadingSubtitleFile");
    try {
      await requestPayload(`/api/videos/${video.id}/subtitles`, { method: "POST", body });
      await refreshAfterSubtitleMutation(video);
      setTranslatedMessage("status.replacedSubtitle", { name: subtitle.fileName });
      notifySuccess(t("toast.subtitleReplacedTitle"), subtitle.fileName, file.name);
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
      await refreshAfterSubtitleMutation(video);
      setTranslatedMessage("status.convertedSubtitle", { name: subtitle.fileName });
      notifySuccess(t("toast.subtitleConvertedTitle"), subtitle.fileName, "ASS");
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
      await refreshAfterSubtitleMutation(video);
      const offsetLabel = formatOffsetMilliseconds(offsetMs);
      setTranslatedMessage("status.offsetSubtitle", { name: subtitle.fileName, offset: offsetLabel });
      notifySuccess(t("toast.subtitleOffsetTitle"), subtitle.fileName, offsetLabel);
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
    setSubtitleActionPending({
      kind: "delete",
      videoId: video.id,
      subtitleId: subtitle.id,
      subtitleFileName: subtitle.fileName
    });
    try {
      await requestPayload(`/api/videos/${video.id}/subtitles/${subtitle.id}`, { method: "DELETE" });
      await refreshAfterSubtitleMutation(video);
      setTranslatedMessage("status.deletedSubtitle", { name: subtitle.fileName });
      notifySuccess(t("toast.subtitleDeletedTitle"), subtitle.fileName, video.title || video.fileName);
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

  async function loadTvBatchCandidates() {
    const targetDir = (
      selectors.selectedTvSeries?.path ||
      state.selectedTvDirPath ||
      state.tvEpisodesPath ||
      selectors.tvRootPath ||
      state.directoryScan.tvRoot ||
      ""
    ).trim();

    if (!targetDir) {
      setTranslatedMessage("status.tvBatchNeedsSeries");
      notifyInfo(t("toast.selectTvSeriesTitle"), t("toast.selectTvSeriesMessage"));
      return [];
    }

    return requestTvVideosForPath(targetDir);
  }

  async function uploadBatchSubtitles(items: BatchSubtitleUploadItem[]): Promise<BatchSubtitleUploadResult> {
    if (items.length === 0) {
      return { total: 0, success: 0, failed: 0, errors: [] };
    }

    setSubtitleActionPending({
      kind: "batch",
      videoId: items[0]?.video.id || ""
    });
    beginLoading();
    beginUpload("status.uploadingSubtitleFilesProgress", { current: 0, total: items.length });
    const errors: string[] = [];
    let success = 0;

    try {
      for (const [index, item] of items.entries()) {
        updateUploadMessage("status.uploadingSubtitleFilesProgress", { current: index + 1, total: items.length });
        const body = new FormData();
        body.append("file", item.file);
        body.append("label", item.label || "");

        try {
          await requestPayload(`/api/videos/${item.video.id}/subtitles`, { method: "POST", body });
          success += 1;
        } catch (error) {
          const errorText = error instanceof Error ? error.message : String(error);
          const source = item.sourceName || item.file.name;
          errors.push(`${source} -> ${item.video.fileName}: ${errorText}`);
        }
      }
    } finally {
      try {
        await Promise.all([
          loadTvSeriesPage({ page: state.tvSeriesPager.page || 1, force: true }),
          refreshTvVideosForPath(
            selectors.selectedTvSeries?.path ||
              state.selectedTvDirPath ||
              state.tvEpisodesPath ||
              selectors.tvRootPath ||
              state.directoryScan.tvRoot ||
              ""
          ),
          loadLogs({ page: 1 })
        ]);
      } catch (error) {
        const errorText = error instanceof Error ? error.message : String(error);
        errors.push(`refresh after batch upload failed: ${errorText}`);
      }
      endUpload();
      endLoading();
    }

    const total = items.length;
    const failed = total - success;
    if (failed > 0) {
      setTranslatedMessage("status.batchFinishedWarnings", { success, total, failed });
      notifyInfo(
        t("toast.batchWarningsTitle"),
        t("toast.batchWarningsMessage", { success, total }),
        t("toast.batchWarningsDetail", { failed })
      );
    } else {
      setTranslatedMessage("status.batchFinishedSuccess", { success, total });
      notifySuccess(t("toast.batchSuccessTitle"), t("toast.batchSuccessMessage", { success, total }));
    }
    setSubtitleActionPending(null);

  return {
    total,
    success,
    failed,
    errors
  };
}

  return {
    uploadSubtitle,
    replaceSubtitle,
    convertSubtitleToAss,
    offsetSubtitleTiming,
    removeSubtitle,
    previewSubtitle,
    loadTvBatchCandidates,
    uploadBatchSubtitles
  };
}

export type SubtitleActions = ReturnType<typeof createSubtitleActions>;
