"use client";

import { useCallback, useMemo, useRef } from "react";

import { useI18n } from "@/lib/i18n";
import type { ActiveTab, BatchSubtitleUploadItem, Subtitle, SubtitleSourceEncoding, SubtitleUploadOptions, Video } from "@/lib/types";
import { formatTimeWithLocale, resolveLocalizedText } from "@/lib/subtitle-manager/messages";

import { createSubtitleManagerController } from "./controller";
import { useSubtitleManagerEffects } from "./effects";
import { useSubtitleManagerSelectors } from "./selectors";
import { useSubtitleManagerState } from "./state";
import type { SubtitleManagerController, SubtitleManagerResult } from "./types";

export function useSubtitleManager(): SubtitleManagerResult {
  const { locale, t } = useI18n();
  const stateApi = useSubtitleManagerState();
  const { state, stateRef } = stateApi;
  const selectors = useSubtitleManagerSelectors({ state, t });
  const selectorsRef = useRef(selectors);
  selectorsRef.current = selectors;
  const tRef = useRef(t);
  tRef.current = t;

  const controllerRef = useRef<SubtitleManagerController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createSubtitleManagerController({
      stateApi,
      getState: () => stateRef.current,
      getSelectors: () => selectorsRef.current,
      getT: () => tRef.current
    });
  }
  const controller = controllerRef.current;

  useSubtitleManagerEffects({
    stateApi,
    selectors,
    controller
  });

  const uploadingMessage = useMemo(() => resolveLocalizedText(state.uploadingMessageState, t), [state.uploadingMessageState, t]);
  const message = useMemo(() => resolveLocalizedText(state.messageState, t), [state.messageState, t]);
  const formatTime = useCallback((value: string | undefined | null) => formatTimeWithLocale(locale, value), [locale]);
  const setMovieQuery = useCallback((value: string) => controller.setMovieQuery(value), [controller]);
  const setTvQuery = useCallback((value: string) => controller.setTvQuery(value), [controller]);
  const selectMovieVideo = useCallback((video: Video) => controller.selectMovieVideo(video), [controller]);
  const selectTvVideo = useCallback((video: Video) => controller.selectTvVideo(video), [controller]);
  const setMoviePage = useCallback((nextPage: number) => controller.setMoviePage(nextPage), [controller]);
  const setTvPage = useCallback((nextPage: number) => controller.setTvPage(nextPage), [controller]);
  const setLogsPage = useCallback((nextPage: number) => controller.setLogsPage(nextPage), [controller]);
  const setLogsDialogOpen = useCallback((open: boolean) => controller.setLogsDialogOpen(open), [controller]);
  const refreshLogs = useCallback((page = 1) => controller.loadLogs({ page }), [controller]);
  const toggleMovieYearSort = useCallback(() => controller.toggleMovieYearSort(), [controller]);
  const toggleTvSeriesYearSort = useCallback(() => controller.toggleTvSeriesYearSort(), [controller]);
  const loadMovieWorkspace = useCallback(() => controller.loadMovieWorkspace(), [controller]);
  const loadTvWorkspace = useCallback((seriesPath?: string) => controller.loadTvWorkspace(seriesPath), [controller]);
  const selectTvDirectory = useCallback((path: string) => controller.selectTvDirectory(path), [controller]);
  const setSelectedTvSeason = useCallback((value: string) => controller.setSelectedTvSeason(value), [controller]);
  const loadTvBatchCandidates = useCallback(() => controller.loadTvBatchCandidates(), [controller]);
  const switchTab = useCallback((tab: ActiveTab) => controller.switchTab(tab), [controller]);
  const triggerScan = useCallback(() => controller.triggerScan(), [controller]);
  const refreshActiveTab = useCallback(() => controller.refreshActiveTab(), [controller]);
  const clearLogs = useCallback(() => controller.clearLogs(), [controller]);
  const uploadSubtitle = useCallback(
    (video: Video, file: File, label: string, options?: SubtitleUploadOptions) => controller.uploadSubtitle(video, file, label, options),
    [controller]
  );
  const replaceSubtitle = useCallback(
    (video: Video, subtitle: Subtitle, file: File) => controller.replaceSubtitle(video, subtitle, file),
    [controller]
  );
  const convertSubtitleToAss = useCallback(
    (video: Video, subtitle: Subtitle, sourceEncoding?: SubtitleSourceEncoding) =>
      controller.convertSubtitleToAss(video, subtitle, sourceEncoding),
    [controller]
  );
  const offsetSubtitleTiming = useCallback(
    (video: Video, subtitle: Subtitle, offsetMs: number) => controller.offsetSubtitleTiming(video, subtitle, offsetMs),
    [controller]
  );
  const removeSubtitle = useCallback(
    (video: Video, subtitle: Subtitle) => controller.removeSubtitle(video, subtitle),
    [controller]
  );
  const previewSubtitle = useCallback(
    (video: Video, subtitle: Subtitle) => controller.previewSubtitle(video, subtitle),
    [controller]
  );
  const uploadBatchSubtitles = useCallback(
    (items: BatchSubtitleUploadItem[]) => controller.uploadBatchSubtitles(items),
    [controller]
  );

  return {
    core: {
      activeTab: state.activeTab,
      loading: state.loading,
      pending: state.pending,
      uploading: state.uploading,
      uploadingMessage,
      message,
      formatTime
    },
    dashboard: {
      scanStatus: state.scanStatus,
      directoryScan: state.directoryScan,
      logs: state.logs,
      logsPager: state.logsPager,
      versionInfo: state.versionInfo,
      setLogsPage,
      refreshLogs,
      clearLogs,
      setLogsDialogOpen
    },
    movie: {
      query: state.queryByType.movie,
      setQuery: setMovieQuery,
      videos: selectors.movieVideos,
      pager: selectors.moviePager,
      yearSortOrder: state.movieYearSortOrder,
      selectedVideo: selectors.selectedMovie,
      selectedVideoId: state.selectedVideoIdByType.movie,
      selectVideo: selectMovieVideo,
      setPage: setMoviePage,
      toggleYearSort: toggleMovieYearSort,
      loadWorkspace: loadMovieWorkspace
    },
    tv: {
      query: state.queryByType.tv,
      setQuery: setTvQuery,
      rows: state.tvSeriesRows,
      pager: selectors.tvPager,
      yearSortOrder: state.tvSeriesYearSortOrder,
      selectedSeries: selectors.selectedTvSeries,
      selectedSeason: state.selectedTvSeason,
      seasonOptions: selectors.tvSeasonOptions,
      videos: selectors.sortedTvVideos,
      selectedVideo: selectors.selectedTvVideo,
      selectedVideoId: state.selectedVideoIdByType.tv,
      showScanPrompt: selectors.showTvScanPrompt,
      selectSeries: selectTvDirectory,
      selectVideo: selectTvVideo,
      setSelectedSeason: setSelectedTvSeason,
      setPage: setTvPage,
      toggleYearSort: toggleTvSeriesYearSort,
      loadWorkspace: loadTvWorkspace,
      loadBatchCandidates: loadTvBatchCandidates
    },
    actions: {
      switchTab,
      triggerScan,
      refreshActiveTab,
      uploadSubtitle,
      replaceSubtitle,
      convertSubtitleToAss,
      offsetSubtitleTiming,
      removeSubtitle,
      previewSubtitle,
      uploadBatchSubtitles
    }
  };
}

export type {
  SubtitleManagerActions,
  SubtitleManagerCore,
  SubtitleManagerDashboardDomain,
  SubtitleManagerMovieDomain,
  SubtitleManagerResult,
  SubtitleManagerState,
  SubtitleManagerTvDomain
} from "./types";
