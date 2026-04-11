"use client";

import { useCallback, useMemo, useRef } from "react";

import { useI18n } from "@/lib/i18n";
import type { ActiveTab, BatchSubtitleUploadItem, Subtitle, Video } from "@/lib/types";
import { formatTimeWithLocale, resolveLocalizedText } from "@/lib/subtitle-manager/messages";

import { createSubtitleManagerController } from "./controller";
import { useSubtitleManagerEffects } from "./effects";
import { useSubtitleManagerSelectors } from "./selectors";
import { useSubtitleManagerState } from "./state";
import type { SubtitleManagerResult } from "./types";

export function useSubtitleManager(): SubtitleManagerResult {
  const { locale, t } = useI18n();
  const stateApi = useSubtitleManagerState();
  const { state } = stateApi;
  const selectors = useSubtitleManagerSelectors({ state, t });
  const controller = createSubtitleManagerController({
    stateApi,
    selectors,
    t
  });
  const controllerRef = useRef(controller);
  controllerRef.current = controller;

  useSubtitleManagerEffects({
    stateApi,
    selectors,
    controller
  });

  const uploadingMessage = useMemo(() => resolveLocalizedText(state.uploadingMessageState, t), [state.uploadingMessageState, t]);
  const message = useMemo(() => resolveLocalizedText(state.messageState, t), [state.messageState, t]);
  const formatTime = useCallback((value: string | undefined | null) => formatTimeWithLocale(locale, value), [locale]);
  const setMovieQuery = useCallback((value: string) => controllerRef.current.setMovieQuery(value), []);
  const setTvQuery = useCallback((value: string) => controllerRef.current.setTvQuery(value), []);
  const selectMovieVideo = useCallback((video: Video) => controllerRef.current.selectMovieVideo(video), []);
  const selectTvVideo = useCallback((video: Video) => controllerRef.current.selectTvVideo(video), []);
  const setMoviePage = useCallback((nextPage: number) => controllerRef.current.setMoviePage(nextPage), []);
  const setTvPage = useCallback((nextPage: number) => controllerRef.current.setTvPage(nextPage), []);
  const toggleMovieYearSort = useCallback(() => controllerRef.current.toggleMovieYearSort(), []);
  const toggleTvSeriesYearSort = useCallback(() => controllerRef.current.toggleTvSeriesYearSort(), []);
  const loadMovieWorkspace = useCallback(() => controllerRef.current.loadMovieWorkspace(), []);
  const loadTvWorkspace = useCallback((seriesPath?: string) => controllerRef.current.loadTvWorkspace(seriesPath), []);
  const selectTvDirectory = useCallback((path: string) => controllerRef.current.selectTvDirectory(path), []);
  const setSelectedTvSeason = useCallback((value: string) => controllerRef.current.setSelectedTvSeason(value), []);
  const loadTvBatchCandidates = useCallback(() => controllerRef.current.loadTvBatchCandidates(), []);
  const switchTab = useCallback((tab: ActiveTab) => controllerRef.current.switchTab(tab), []);
  const triggerScan = useCallback(() => controllerRef.current.triggerScan(), []);
  const refreshActiveTab = useCallback(() => controllerRef.current.refreshActiveTab(), []);
  const uploadSubtitle = useCallback((video: Video, file: File, label: string) => controllerRef.current.uploadSubtitle(video, file, label), []);
  const replaceSubtitle = useCallback((video: Video, subtitle: Subtitle, file: File) => controllerRef.current.replaceSubtitle(video, subtitle, file), []);
  const removeSubtitle = useCallback((video: Video, subtitle: Subtitle) => controllerRef.current.removeSubtitle(video, subtitle), []);
  const previewSubtitle = useCallback((video: Video, subtitle: Subtitle) => controllerRef.current.previewSubtitle(video, subtitle), []);
  const uploadBatchSubtitles = useCallback((items: BatchSubtitleUploadItem[]) => controllerRef.current.uploadBatchSubtitles(items), []);

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
      logs: state.logs
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
