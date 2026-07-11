import type { TranslateFn } from "@/lib/i18n";

import { createControllerRuntime } from "./controller-runtime";
import { createLoadActions } from "./controller-load";
import { createSubtitleActions } from "./controller-subtitles";
import { createWorkspaceActions } from "./controller-workspace";
import type {
  SubtitleManagerController,
  SubtitleManagerSelectors,
  SubtitleManagerState,
  SubtitleManagerStateApi
} from "./types";

interface CreateSubtitleManagerControllerParams {
  stateApi: SubtitleManagerStateApi;
  getState: () => SubtitleManagerState;
  getSelectors: () => SubtitleManagerSelectors;
  getT: () => TranslateFn;
}

export function createSubtitleManagerController({
  stateApi,
  getState,
  getSelectors,
  getT
}: CreateSubtitleManagerControllerParams): SubtitleManagerController {
  const runtime = createControllerRuntime({ stateApi, getState, getSelectors, getT });
  const load = createLoadActions(runtime);
  const workspace = createWorkspaceActions(runtime, load);
  const subtitles = createSubtitleActions(runtime, load);

  return {
    finishBootstrapping: runtime.finishBootstrapping,
    loadVersionInfo: load.loadVersionInfo,
    loadScanStatus: load.loadScanStatus,
    loadDirectoryScanResult: load.loadDirectoryScanResult,
    loadLogs: load.loadLogs,
    clearLogs: workspace.clearLogs,
    loadMovieVideos: load.loadMovieVideos,
    loadTvSeriesPage: load.loadTvSeriesPage,
    refreshTvVideosForPath: load.refreshTvVideosForPath,
    switchTab: workspace.switchTab,
    triggerScan: workspace.triggerScan,
    refreshActiveTab: workspace.refreshActiveTab,
    loadMovieWorkspace: workspace.loadMovieWorkspace,
    loadTvWorkspace: workspace.loadTvWorkspace,
    selectMovieVideo: workspace.selectMovieVideo,
    selectTvVideo: workspace.selectTvVideo,
    selectTvDirectory: workspace.selectTvDirectory,
    setMoviePage: workspace.setMoviePage,
    setMoviePageSize: workspace.setMoviePageSize,
    setTvPage: workspace.setTvPage,
    setTvPageSize: workspace.setTvPageSize,
    setLogsPage: workspace.setLogsPage,
    setLogsDialogOpen: workspace.setLogsDialogOpen,
    toggleMovieYearSort: workspace.toggleMovieYearSort,
    toggleTvSeriesYearSort: workspace.toggleTvSeriesYearSort,
    uploadSubtitle: subtitles.uploadSubtitle,
    replaceSubtitle: subtitles.replaceSubtitle,
    convertSubtitleToAss: subtitles.convertSubtitleToAss,
    offsetSubtitleTiming: subtitles.offsetSubtitleTiming,
    removeSubtitle: subtitles.removeSubtitle,
    removeSubtitlesBatch: subtitles.removeSubtitlesBatch,
    previewSubtitle: subtitles.previewSubtitle,
    searchSubHDSubtitles: subtitles.searchSubHDSubtitles,
    searchSubHDSeasonPacks: subtitles.searchSubHDSeasonPacks,
    downloadSubHDSubtitle: subtitles.downloadSubHDSubtitle,
    prepareSubHDSeasonPack: subtitles.prepareSubHDSeasonPack,
    installSubHDSeasonPack: subtitles.installSubHDSeasonPack,
    loadTvBatchCandidates: subtitles.loadTvBatchCandidates,
    uploadBatchSubtitles: subtitles.uploadBatchSubtitles,
    setMovieQuery: workspace.setMovieQuery,
    setTvQuery: workspace.setTvQuery,
    setSelectedTvSeason: workspace.setSelectedTvSeason
  };
}
