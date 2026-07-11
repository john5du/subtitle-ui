import type {
  BatchSubtitleDeleteItem,
  BatchSubtitleUploadItem,
  BatchSubtitleUploadResult,
  SubHDDownloadOptions,
  SubHDSearchPage,
  SubHDSeasonInstallOptions,
  SubHDSeasonInstallResult,
  SubHDSeasonPacksResult,
  SubHDSeasonPrepareOptions,
  SubHDSeasonPrepareResult,
  Subtitle,
  SubtitleSourceEncoding,
  SubtitleUploadOptions,
  Video
} from "@/lib/types";
import { ApiRequestError, requestBinary, requestPayload } from "@/lib/subtitle-manager/api-client";
import { normalizeForCompare } from "@/lib/subtitle-manager/tv-tree";

import { formatOffsetMilliseconds, type ControllerRuntime } from "./controller-runtime";
import type { LoadActions } from "./controller-load";

function adjustSeriesNoSubtitleCount(prev: number, before: number, after: number) {
  const delta = (before === 0 ? 1 : 0) - (after === 0 ? 1 : 0);
  return Math.max(0, prev + delta);
}

function isVideoUnderSeriesPath(videoDirectory: string, seriesPath: string) {
  const videoNorm = normalizeForCompare(videoDirectory);
  const seriesNorm = normalizeForCompare(seriesPath);
  if (!videoNorm || !seriesNorm) {
    return false;
  }
  return videoNorm === seriesNorm || videoNorm.startsWith(`${seriesNorm}/`);
}

export function createSubtitleActions(runtime: ControllerRuntime, load: LoadActions) {
  const {
    setters,
    refs,
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
  const { loadTvSeriesPage, refreshTvVideosForPath, requestTvVideosForPath, loadLogs, loadVideoById } = load;

  function applyVideoLocally(video: Video) {
    const state = runtime.state;
    const inMovie = state.movieVideos.some((item) => item.id === video.id);
    const inTv = state.tvEpisodes.some((item) => item.id === video.id);
    // Patch every list that currently holds this video so mediaType mismatches cannot drop updates.
    if (inMovie) {
      setters.patchMovieVideo(video);
    }
    if (inTv) {
      setters.patchTvEpisode(video);
    }
    return inMovie || inTv;
  }

  async function refreshVideoLocally(source: Video) {
    const video = await loadVideoById(source.id, source);
    const applied = applyVideoLocally(video);
    return { video, applied };
  }

  async function maybeRefreshLogs() {
    if (!refs.logsDialogOpenRef.current) {
      return;
    }
    await loadLogs({ page: 1 });
  }

  async function fallbackRefreshAfterSubtitleMutation(video: Video) {
    const mediaType = video.mediaType === "tv" ? "tv" : "movie";
    if (mediaType === "tv") {
      const videoDirectory = video.directory || "";
      const matchedSeries = runtime.state.tvSeriesRows.find((row) => isVideoUnderSeriesPath(videoDirectory, row.path));
      const targetDir =
        matchedSeries?.path ||
        runtime.selectors.selectedTvSeries?.path ||
        runtime.state.selectedTvDirPath ||
        runtime.state.tvEpisodesPath ||
        runtime.selectors.tvRootPath ||
        runtime.state.directoryScan.tvRoot;
      await Promise.all([
        loadTvSeriesPage({ page: runtime.state.tvSeriesPager.page || 1, force: true }),
        refreshTvVideosForPath(targetDir || "")
      ]);
      return;
    }

    const { loadMovieVideos } = load;
    await loadMovieVideos({ page: runtime.selectors.moviePager.page || 1, force: true });
  }

  async function refreshAfterSubtitleMutation(video: Video, previousSubtitleCount?: number) {
    try {
      const { video: refreshed, applied } = await refreshVideoLocally(video);
      if (!applied) {
        await fallbackRefreshAfterSubtitleMutation(refreshed);
      } else if (refreshed.mediaType === "tv" && typeof previousSubtitleCount === "number") {
        const videoDirectory = video.directory || refreshed.directory || "";
        setters.setTvSeriesRows((rows) =>
          rows.map((row) => {
            if (!isVideoUnderSeriesPath(videoDirectory, row.path)) {
              return row;
            }
            return {
              ...row,
              noSubtitleCount: adjustSeriesNoSubtitleCount(
                row.noSubtitleCount,
                previousSubtitleCount,
                refreshed.subtitles.length
              ),
              updatedAt: refreshed.updatedAt || row.updatedAt
            };
          })
        );
      }
    } catch {
      await fallbackRefreshAfterSubtitleMutation(video);
    }

    await maybeRefreshLogs();
  }

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

  async function removeSubtitlesBatch(items: BatchSubtitleDeleteItem[]): Promise<BatchSubtitleUploadResult> {
    if (items.length === 0) {
      return { total: 0, success: 0, failed: 0, errors: [] };
    }

    setSubtitleActionPending({
      kind: "batch",
      videoId: items[0]?.video.id || ""
    });
    beginLoading();
    beginUpload("status.deletingSubtitlesProgress", { current: 0, total: items.length });
    const errors: string[] = [];
    let success = 0;

    try {
      let progress = 0;
      for (const item of items) {
        progress += 1;
        updateUploadMessage("status.deletingSubtitlesProgress", { current: progress, total: items.length });
        try {
          await requestPayload(`/api/videos/${item.video.id}/subtitles/${item.subtitle.id}`, { method: "DELETE" });
          success += 1;
        } catch (error) {
          const errorText = error instanceof Error ? error.message : String(error);
          errors.push(`${item.subtitle.fileName} -> ${item.video.fileName}: ${errorText}`);
        }
      }
    } finally {
      try {
        const state = runtime.state;
        const selectors = runtime.selectors;
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
          maybeRefreshLogs()
        ]);
      } catch (error) {
        const errorText = error instanceof Error ? error.message : String(error);
        errors.push(`refresh after batch delete failed: ${errorText}`);
      }
      endUpload();
      endLoading();
      setSubtitleActionPending(null);
    }

    const total = items.length;
    const failed = total - success;
    if (failed > 0) {
      setTranslatedMessage("status.batchDeleteFinishedWarnings", { success, total, failed });
      notifyInfo(
        runtime.t("toast.batchDeleteWarningsTitle"),
        runtime.t("toast.batchDeleteSuccessMessage", { success, total })
      );
    } else {
      setTranslatedMessage("status.batchDeleteFinishedSuccess", { success, total });
      notifySuccess(runtime.t("toast.batchDeleteSuccessMessage", { success, total }));
    }

    return { total, success, failed, errors };
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
    const state = runtime.state;
    const selectors = runtime.selectors;
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
      notifyInfo(runtime.t("toast.selectTvSeriesTitle"));
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
      // Group archive items by File identity for one-shot batch-from-archive.
      const archiveGroups = new Map<File, BatchSubtitleUploadItem[]>();
      const plainItems: BatchSubtitleUploadItem[] = [];
      for (const item of items) {
        if (item.archiveEntry?.trim()) {
          const list = archiveGroups.get(item.file) || [];
          list.push(item);
          archiveGroups.set(item.file, list);
        } else {
          plainItems.push(item);
        }
      }

      let progress = 0;
      const bump = () => {
        progress += 1;
        updateUploadMessage("status.uploadingSubtitleFilesProgress", { current: progress, total: items.length });
      };

      for (const [archiveFile, group] of archiveGroups) {
        const body = new FormData();
        body.append("file", archiveFile);
        body.append(
          "mappings",
          JSON.stringify(
            group.map((item) => ({
              videoId: item.video.id,
              archiveEntry: item.archiveEntry,
              label: item.label || ""
            }))
          )
        );
        try {
          const result = await requestPayload<{
            results?: Array<{ videoId: string; archiveEntry: string; ok: boolean; error?: string }>;
          }>("/api/subtitles/batch-from-archive", { method: "POST", body });
          const byKey = new Map(
            (result.results || []).map((row) => [`${row.videoId}\0${row.archiveEntry}`, row])
          );
          for (const item of group) {
            bump();
            const row = byKey.get(`${item.video.id}\0${item.archiveEntry}`);
            if (row?.ok) {
              success += 1;
              continue;
            }
            const source = item.sourceName || item.file.name;
            errors.push(`${source} -> ${item.video.fileName}: ${row?.error || "upload failed"}`);
          }
        } catch (error) {
          const errorText = error instanceof Error ? error.message : String(error);
          for (const item of group) {
            bump();
            const source = item.sourceName || item.file.name;
            errors.push(`${source} -> ${item.video.fileName}: ${errorText}`);
          }
        }
      }

      for (const item of plainItems) {
        bump();
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
        const state = runtime.state;
        const selectors = runtime.selectors;
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
          maybeRefreshLogs()
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
        runtime.t("toast.batchWarningsTitle"),
        runtime.t("toast.batchSuccessMessage", { success, total })
      );
    } else {
      setTranslatedMessage("status.batchFinishedSuccess", { success, total });
      notifySuccess(runtime.t("toast.batchSuccessMessage", { success, total }));
    }
    setSubtitleActionPending(null);

    return {
      total,
      success,
      failed,
      errors
    };
  }

  async function searchSubHDSubtitles(video: Video, opts: { query?: string; page?: number } = {}) {
    const params = new URLSearchParams();
    const query = (opts.query ?? "").trim();
    if (query) {
      params.set("q", query);
    }
    if (opts.page && opts.page > 1) {
      params.set("page", String(opts.page));
    }
    const qs = params.toString();
    const path = `/api/videos/${video.id}/subtitles/providers/subhd/search${qs ? `?${qs}` : ""}`;
    return requestPayload<SubHDSearchPage>(path);
  }

  async function searchSubHDSeasonPacks(video: Video, opts: { query?: string; season?: number } = {}) {
    const params = new URLSearchParams();
    const query = (opts.query ?? "").trim();
    if (query) {
      params.set("q", query);
    }
    if (typeof opts.season === "number" && opts.season >= 0) {
      params.set("season", String(opts.season));
    }
    const qs = params.toString();
    const path = `/api/videos/${video.id}/subtitles/providers/subhd/season-packs${qs ? `?${qs}` : ""}`;
    return requestPayload<SubHDSeasonPacksResult>(path);
  }

  async function downloadSubHDSubtitle(video: Video, sid: string, options: SubHDDownloadOptions = {}) {
    const previousSubtitleCount = video.subtitles.length;
    setSubtitleActionPending({
      kind: "download",
      videoId: video.id
    });
    beginUpload("status.downloadingSubtitle");
    try {
      const body: Record<string, string> = { sid };
      if (options.label?.trim()) {
        body.label = options.label.trim();
      }
      if (options.replaceId?.trim()) {
        body.replaceId = options.replaceId.trim();
      }
      if (options.archiveEntry?.trim()) {
        body.archiveEntry = options.archiveEntry.trim();
      }
      await requestPayload(`/api/videos/${video.id}/subtitles/providers/subhd/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      await refreshAfterSubtitleMutation(video, previousSubtitleCount);
      setTranslatedMessage("status.downloadedSubtitleFor", { title: video.title || video.fileName });
      notifySuccess(runtime.t("toast.subtitleDownloadedTitle"), video.title || video.fileName);
      return true;
    } catch (error) {
      // Propagate structured multi-entry errors for UI picker; other errors stay toast-only.
      if (error instanceof ApiRequestError && error.code === "archive_multiple_entries") {
        throw error;
      }
      reportRequestError("error.subhdDownloadFailed", error);
      return false;
    } finally {
      endUpload();
      setSubtitleActionPending(null);
    }
  }

  async function prepareSubHDSeasonPack(options: SubHDSeasonPrepareOptions) {
    beginUpload("status.downloadingSubtitle");
    try {
      return await requestPayload<SubHDSeasonPrepareResult>("/api/subtitles/providers/subhd/season-prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sid: options.sid,
          videoIds: options.videoIds,
          season: options.season && options.season > 0 ? options.season : undefined,
          languagePreference: options.languagePreference || "any",
          formatPreference: options.formatPreference || "any",
          skipExisting: Boolean(options.skipExisting),
          label: options.label || "zh"
        })
      });
    } catch (error) {
      reportRequestError("error.subhdDownloadFailed", error);
      throw error;
    } finally {
      endUpload();
    }
  }

  async function installSubHDSeasonPack(options: SubHDSeasonInstallOptions): Promise<BatchSubtitleUploadResult> {
    const mappings = options.mappings || [];
    if (mappings.length === 0) {
      return { total: 0, success: 0, failed: 0, errors: [] };
    }
    setSubtitleActionPending({
      kind: "batch",
      videoId: mappings[0]?.videoId || ""
    });
    beginLoading();
    beginUpload("status.uploadingSubtitleFilesProgress", { current: 0, total: mappings.length });
    const errors: string[] = [];
    let success = 0;
    try {
      const result = await requestPayload<SubHDSeasonInstallResult>("/api/subtitles/providers/subhd/season-install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cacheToken: options.cacheToken,
          mappings: mappings.map((m) => ({
            videoId: m.videoId,
            archiveEntry: m.archiveEntry,
            label: m.label || ""
          }))
        })
      });
      for (const row of result.results || []) {
        if (row.ok) {
          success += 1;
        } else {
          errors.push(`${row.archiveEntry || "?"} -> ${row.videoId}: ${row.error || "install failed"}`);
        }
      }
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      errors.push(errorText);
    } finally {
      try {
        const state = runtime.state;
        const selectors = runtime.selectors;
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
          maybeRefreshLogs()
        ]);
      } catch (error) {
        const errorText = error instanceof Error ? error.message : String(error);
        errors.push(`refresh after season install failed: ${errorText}`);
      }
      endUpload();
      endLoading();
      setSubtitleActionPending(null);
    }

    const total = mappings.length;
    const failed = Math.max(0, total - success);
    if (failed > 0 || errors.length > 0) {
      setTranslatedMessage("status.batchFinishedWarnings", { success, total, failed: failed || errors.length });
      notifyInfo(
        runtime.t("toast.batchWarningsTitle"),
        runtime.t("toast.batchSuccessMessage", { success, total })
      );
    } else {
      setTranslatedMessage("status.batchFinishedSuccess", { success, total });
      notifySuccess(runtime.t("toast.batchSuccessMessage", { success, total }));
    }
    return { total, success, failed, errors };
  }

  return {
    uploadSubtitle,
    replaceSubtitle,
    convertSubtitleToAss,
    offsetSubtitleTiming,
    removeSubtitle,
    removeSubtitlesBatch,
    previewSubtitle,
    searchSubHDSubtitles,
    searchSubHDSeasonPacks,
    downloadSubHDSubtitle,
    loadTvBatchCandidates,
    uploadBatchSubtitles,
    prepareSubHDSeasonPack,
    installSubHDSeasonPack
  };
}

export type SubtitleActions = ReturnType<typeof createSubtitleActions>;
