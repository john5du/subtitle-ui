import type {
  BatchSubtitleUploadResult,
  SubHDDownloadOptions,
  SubHDSearchPage,
  SubHDSeasonInstallOptions,
  SubHDSeasonInstallResult,
  SubHDSeasonPacksResult,
  SubHDSeasonPrepareOptions,
  SubHDSeasonPrepareResult,
  Video
} from "@/lib/types";
import { ApiRequestError, requestPayload } from "@/lib/subtitle-manager/api-client";

import type { ControllerRuntime } from "./controller-runtime";
import type { LoadActions } from "./controller-load";
import type { SubtitleRefresh } from "./controller-subtitle-refresh";

export function createSubtitleSubHDActions(
  runtime: ControllerRuntime,
  load: LoadActions,
  refresh: SubtitleRefresh
) {
  const {
    setSubtitleActionPending,
    beginLoading,
    endLoading,
    beginUpload,
    endUpload,
    notifySuccess,
    notifyInfo,
    reportRequestError
  } = runtime;
  const { loadTvSeriesPage, refreshTvVideosForPath } = load;
  const { refreshAfterSubtitleMutation, maybeRefreshLogs } = refresh;

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
      notifySuccess(runtime.t("toast.subtitleDownloadedTitle"), video.title || video.fileName);
      return true;
    } catch (error) {
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
          languagePreference: options.languagePreference || "bilingual",
          formatPreference: options.formatPreference || "any",
          skipExisting: Boolean(options.skipExisting),
          label: options.label || ""
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
      notifyInfo(runtime.t("toast.batchWarningsTitle"), runtime.t("toast.batchSuccessMessage", { success, total }));
    } else {
      notifySuccess(runtime.t("toast.batchSuccessMessage", { success, total }));
    }
    return { total, success, failed, errors };
  }

  return {
    searchSubHDSubtitles,
    searchSubHDSeasonPacks,
    downloadSubHDSubtitle,
    prepareSubHDSeasonPack,
    installSubHDSeasonPack
  };
}
