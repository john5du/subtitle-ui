"use client";

import { useCallback, useMemo } from "react";

import { useI18n } from "@/lib/i18n";
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

  useSubtitleManagerEffects({
    stateApi,
    selectors,
    controller
  });

  const uploadingMessage = useMemo(() => resolveLocalizedText(state.uploadingMessageState, t), [state.uploadingMessageState, t]);
  const message = useMemo(() => resolveLocalizedText(state.messageState, t), [state.messageState, t]);
  const formatTime = useCallback((value: string | undefined | null) => formatTimeWithLocale(locale, value), [locale]);

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
      setQuery: controller.setMovieQuery,
      videos: selectors.movieVideos,
      pager: selectors.moviePager,
      yearSortOrder: state.movieYearSortOrder,
      selectedVideo: selectors.selectedMovie,
      selectedVideoId: state.selectedVideoIdByType.movie,
      selectVideo: controller.selectMovieVideo,
      setPage: controller.setMoviePage,
      toggleYearSort: controller.toggleMovieYearSort,
      loadWorkspace: controller.loadMovieWorkspace
    },
    tv: {
      query: state.queryByType.tv,
      setQuery: controller.setTvQuery,
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
      selectSeries: controller.selectTvDirectory,
      selectVideo: controller.selectTvVideo,
      setSelectedSeason: controller.setSelectedTvSeason,
      setPage: controller.setTvPage,
      toggleYearSort: controller.toggleTvSeriesYearSort,
      loadWorkspace: controller.loadTvWorkspace,
      loadBatchCandidates: controller.loadTvBatchCandidates
    },
    actions: {
      switchTab: controller.switchTab,
      triggerScan: controller.triggerScan,
      refreshActiveTab: controller.refreshActiveTab,
      uploadSubtitle: controller.uploadSubtitle,
      replaceSubtitle: controller.replaceSubtitle,
      removeSubtitle: controller.removeSubtitle,
      previewSubtitle: controller.previewSubtitle,
      uploadBatchSubtitles: controller.uploadBatchSubtitles
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
