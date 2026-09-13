"use client";

import { useCallback, useMemo, useState } from "react";

import { useCommittedValue } from "@/hooks/use-committed-value";
import { useI18n } from "@/lib/i18n";
import { formatTimeWithLocale, resolveLocalizedText } from "@/lib/subtitle-manager/messages";

import { createSubtitleManagerController } from "./controller";
import { useSubtitleManagerEffects } from "./effects";
import { useSubtitleManagerSelectors } from "./selectors";
import { useSubtitleManagerState } from "./state";
import type { SubtitleManagerController, SubtitleManagerResult } from "./types";

export function useSubtitleManager(): SubtitleManagerResult {
  const { locale, t } = useI18n();
  const stateApi = useSubtitleManagerState();
  const { state, getState } = stateApi;
  const selectors = useSubtitleManagerSelectors({ state, t });
  const getSelectors = useCommittedValue(selectors);
  const getT = useCommittedValue(t);
  const [controller] = useState<SubtitleManagerController>(() => createSubtitleManagerController({
    stateApi,
    getState,
    getSelectors,
    getT
  }));

  useSubtitleManagerEffects({
    stateApi,
    selectors,
    controller
  });

  const uploadingMessage = useMemo(() => resolveLocalizedText(state.uploadingMessageState, t), [state.uploadingMessageState, t]);
  const formatTime = useCallback((value: string | undefined | null) => formatTimeWithLocale(locale, value), [locale]);
  // Controller methods are stable for the lifetime of this manager; forward them directly.
  const {
    setMovieQuery, setTvQuery, selectMovieVideo, selectTvVideo, setMoviePage, setMoviePageSize,
    setTvPage, setTvPageSize, setLogsPage, setLogsDialogOpen, setMovieSortBy, toggleMovieSortOrder,
    setTvSeriesSortBy, toggleTvSeriesSortOrder, loadMovieWorkspace, loadTvWorkspace,
    selectTvDirectory, setSelectedTvSeason, loadTvBatchCandidates, switchTab, triggerScan,
    refreshActiveTab, clearLogs, uploadSubtitle, replaceSubtitle, convertSubtitleToAss,
    offsetSubtitleTiming, removeSubtitle, removeSubtitlesBatch, previewSubtitle,
    searchSubHDSubtitles, searchSubHDSeasonPacks, downloadSubHDSubtitle, uploadBatchSubtitles,
    prepareSubHDSeasonPack, installSubHDSeasonPack, refreshVideoAfterMutation, refreshSeriesVideos
  } = controller;
  const refreshLogs = useCallback(async (page = 1) => { await controller.loadLogs({ page }); }, [controller]);

  return {
    core: {
      activeTab: state.activeTab,
      pending: state.pending,
      uploading: state.uploading,
      uploadingMessage,
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
      sortBy: state.movieSortBy,
      sortOrder: state.movieSortOrder,
      selectedVideo: selectors.selectedMovie,
      selectedVideoId: state.selectedVideoIdByType.movie,
      selectVideo: selectMovieVideo,
      setPage: setMoviePage,
      setPageSize: setMoviePageSize,
      setSortBy: setMovieSortBy,
      toggleSortOrder: toggleMovieSortOrder,
      loadWorkspace: loadMovieWorkspace
    },
    tv: {
      query: state.queryByType.tv,
      setQuery: setTvQuery,
      rows: state.tvSeriesRows,
      pager: selectors.tvPager,
      sortBy: state.tvSeriesSortBy,
      sortOrder: state.tvSeriesSortOrder,
      selectedSeries: selectors.selectedTvSeries,
      selectedSeason: state.selectedTvSeason,
      seasonOptions: selectors.tvSeasonOptions,
      videos: selectors.sortedTvVideos,
      seriesVideos: selectors.selectedTvSeriesVideos,
      selectedVideo: selectors.selectedTvVideo,
      selectedVideoId: state.selectedVideoIdByType.tv,
      showScanPrompt: selectors.showTvScanPrompt,
      selectSeries: selectTvDirectory,
      selectVideo: selectTvVideo,
      setSelectedSeason: setSelectedTvSeason,
      setPage: setTvPage,
      setPageSize: setTvPageSize,
      setSortBy: setTvSeriesSortBy,
      toggleSortOrder: toggleTvSeriesSortOrder,
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
      removeSubtitlesBatch,
      previewSubtitle,
      searchSubHDSubtitles,
      searchSubHDSeasonPacks,
      downloadSubHDSubtitle,
      uploadBatchSubtitles,
      prepareSubHDSeasonPack,
      installSubHDSeasonPack,
      refreshVideoAfterMutation,
      refreshSeriesVideos
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
