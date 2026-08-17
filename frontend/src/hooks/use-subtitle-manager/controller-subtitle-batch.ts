import type {
  BatchSubtitleDeleteItem,
  BatchSubtitleUploadItem,
  BatchSubtitleUploadResult
} from "@/lib/types";
import { requestPayload } from "@/lib/subtitle-manager/api-client";

import type { ControllerRuntime } from "./controller-runtime";
import type { LoadActions } from "./controller-load";
import type { SubtitleRefresh } from "./controller-subtitle-refresh";

export function createSubtitleBatchActions(
  runtime: ControllerRuntime,
  load: LoadActions,
  refresh: SubtitleRefresh
) {
  const {
    setSubtitleActionPending,
    beginLoading,
    endLoading,
    beginUpload,
    updateUploadMessage,
    endUpload,
    notifySuccess,
    notifyInfo
  } = runtime;
  const { loadTvSeriesPage, refreshTvVideosForPath, requestTvVideosForPath } = load;
  const { maybeRefreshLogs } = refresh;

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
      notifyInfo(runtime.t("toast.selectTvSeriesTitle"));
      return [];
    }

    return requestTvVideosForPath(targetDir);
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
      notifyInfo(
        runtime.t("toast.batchDeleteWarningsTitle"),
        runtime.t("toast.batchDeleteSuccessMessage", { success, total })
      );
    } else {
      notifySuccess(runtime.t("toast.batchDeleteSuccessMessage", { success, total }));
    }

    return { total, success, failed, errors };
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
          const byKey = new Map((result.results || []).map((row) => [`${row.videoId}\0${row.archiveEntry}`, row]));
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
      notifyInfo(runtime.t("toast.batchWarningsTitle"), runtime.t("toast.batchSuccessMessage", { success, total }));
    } else {
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

  return {
    loadTvBatchCandidates,
    removeSubtitlesBatch,
    uploadBatchSubtitles
  };
}
