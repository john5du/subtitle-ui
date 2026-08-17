import type { Video } from "@/lib/types";
import { normalizeForCompare } from "@/lib/subtitle-manager/path-utils";

import type { ControllerRuntime } from "./controller-runtime";
import type { LoadActions } from "./controller-load";

export function adjustSeriesNoSubtitleCount(prev: number, before: number, after: number) {
  const delta = (before === 0 ? 1 : 0) - (after === 0 ? 1 : 0);
  return Math.max(0, prev + delta);
}

export function isVideoUnderSeriesPath(videoDirectory: string, seriesPath: string) {
  const videoNorm = normalizeForCompare(videoDirectory);
  const seriesNorm = normalizeForCompare(seriesPath);
  if (!videoNorm || !seriesNorm) {
    return false;
  }
  return videoNorm === seriesNorm || videoNorm.startsWith(`${seriesNorm}/`);
}

export function createSubtitleRefresh(runtime: ControllerRuntime, load: LoadActions) {
  const { setters, refs } = runtime;
  const { loadTvSeriesPage, refreshTvVideosForPath, loadLogs, loadVideoById, loadMovieVideos } = load;

  function applyVideoLocally(video: Video) {
    const state = runtime.state;
    const inMovie = state.movieVideos.some((item) => item.id === video.id);
    const inTv = state.tvEpisodes.some((item) => item.id === video.id);
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

  async function refreshVideoAfterMutation(video: Video) {
    await refreshAfterSubtitleMutation(video, video.subtitles.length);
  }

  async function refreshSeriesVideos(seriesPath: string) {
    const path = (seriesPath || "").trim();
    if (path) {
      await refreshTvVideosForPath(path);
    }
    await maybeRefreshLogs();
  }

  return {
    maybeRefreshLogs,
    refreshAfterSubtitleMutation,
    refreshVideoAfterMutation,
    refreshSeriesVideos
  };
}

export type SubtitleRefresh = ReturnType<typeof createSubtitleRefresh>;
