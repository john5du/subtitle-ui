"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Film, LayoutDashboard, Tv } from "lucide-react";

import { useSubtitleManager } from "@/hooks/use-subtitle-manager";
import { useI18n } from "@/lib/i18n";
import type { ActiveTab, Video } from "@/lib/types";

import type { LibraryViewMode, SubtitleDetailsPanelHandle, TvDrawerMode } from "../types";

const LIBRARY_VIEW_STORAGE_KEY = "subtitle-ui:library-view";

function isLibraryViewMode(value: string | null | undefined): value is LibraryViewMode {
  return value === "list" || value === "card";
}

export function useSubtitleManagerScreenModel() {
  const { t } = useI18n();
  const { core, dashboard, movie, tv, actions } = useSubtitleManager();

  const {
    activeTab,
    loading,
    pending,
    uploading,
    uploadingMessage,
    message,
    formatTime
  } = core;
  const { logs, logsPager, scanStatus, directoryScan } = dashboard;

  const operationLocked = pending.scan || uploading || Boolean(pending.refreshTab);
  const scanPending = pending.scan;
  const refreshPending = pending.refreshTab === activeTab;

  const [movieManagerOpen, setMovieManagerOpen] = useState(false);
  const [tvDrawerOpen, setTvDrawerOpen] = useState(false);
  const [tvDrawerMode, setTvDrawerMode] = useState<TvDrawerMode>("manage");
  const [pendingMovieUploadPick, setPendingMovieUploadPick] = useState(false);
  const [libraryViewMode, setLibraryViewMode] = useState<LibraryViewMode>(() => {
    if (typeof window === "undefined") {
      return "card";
    }
    try {
      const bootstrapView = window.__subtitleUiLibraryView;
      if (isLibraryViewMode(bootstrapView)) {
        return bootstrapView;
      }
      const storedView = window.localStorage.getItem(LIBRARY_VIEW_STORAGE_KEY);
      return isLibraryViewMode(storedView) ? storedView : "card";
    } catch {
      return "card";
    }
  });
  const movieDetailsRef = useRef<SubtitleDetailsPanelHandle | null>(null);

  const navItems = useMemo<Array<{ key: ActiveTab; icon: ReactNode; label: string }>>(
    () => [
      { key: "dashboard", icon: <LayoutDashboard className="h-5 w-5" />, label: t("nav.overview") },
      { key: "movie", icon: <Film className="h-5 w-5" />, label: t("nav.movie") },
      { key: "tv", icon: <Tv className="h-5 w-5" />, label: t("nav.tv") }
    ],
    [t]
  );
  const activeTabLabel = useMemo(() => navItems.find((item) => item.key === activeTab)?.label || activeTab, [activeTab, navItems]);
  const selectedMovie = movie.selectedVideo;
  const selectedTvVideo = tv.selectedVideo;
  const showTvScanPrompt = tv.showScanPrompt;
  const selectedMovieRef = useRef(selectedMovie);
  const selectedTvSeriesRef = useRef(tv.selectedSeries);
  const movieSelectVideoRef = useRef(movie.selectVideo);
  const movieLoadWorkspaceRef = useRef(movie.loadWorkspace);
  const tvSelectVideoRef = useRef(tv.selectVideo);
  const tvSelectSeriesRef = useRef(tv.selectSeries);
  const tvLoadWorkspaceRef = useRef(tv.loadWorkspace);
  selectedMovieRef.current = selectedMovie;
  selectedTvSeriesRef.current = tv.selectedSeries;
  movieSelectVideoRef.current = movie.selectVideo;
  movieLoadWorkspaceRef.current = movie.loadWorkspace;
  tvSelectVideoRef.current = tv.selectVideo;
  tvSelectSeriesRef.current = tv.selectSeries;
  tvLoadWorkspaceRef.current = tv.loadWorkspace;

  const statusBadgeClass = useMemo(() => {
    if (scanPending) {
      return "border-border bg-surface-subtle text-foreground-muted";
    }
    if (refreshPending) {
      return "border-border bg-surface-subtle text-foreground-muted";
    }
    if (uploading) {
      return "border-border bg-surface-subtle text-foreground-muted";
    }
    if (pending.tabSwitch || pending.bootstrapping || loading) {
      return "border-border bg-surface-subtle text-foreground-muted";
    }
    return "border-border bg-surface-subtle text-muted-foreground";
  }, [loading, pending.bootstrapping, pending.tabSwitch, refreshPending, scanPending, uploading]);

  const statusBadgeText = scanPending
    ? t("status.scanningLibrary")
    : refreshPending
      ? t("status.refreshingTab", { tab: activeTabLabel })
      : uploading
        ? uploadingMessage || t("status.uploadingSubtitles")
        : pending.tabSwitch
          ? t("status.loadingWorkspace")
          : message || t("status.ready");

  const handleMovieSelect = useCallback((video: Video) => {
    movieSelectVideoRef.current(video);
  }, []);

  const handleTvSelect = useCallback((video: Video) => {
    tvSelectVideoRef.current(video);
  }, []);

  const openMovieUploadPicker = useCallback((video?: Video) => {
    const targetVideo = video || selectedMovieRef.current;
    if (!targetVideo) return;
    movieSelectVideoRef.current(targetVideo);
    setPendingMovieUploadPick(true);
    setMovieManagerOpen(true);
    void movieLoadWorkspaceRef.current();
  }, []);

  const openMovieManager = useCallback((video?: Video) => {
    const targetVideo = video || selectedMovieRef.current;
    if (!targetVideo) return;
    movieSelectVideoRef.current(targetVideo);
    setMovieManagerOpen(true);
    void movieLoadWorkspaceRef.current();
  }, []);

  const openTvManager = useCallback(() => {
    const targetSeries = selectedTvSeriesRef.current;
    if (!targetSeries) return;
    tvSelectSeriesRef.current(targetSeries.path);
    setTvDrawerMode("manage");
    setTvDrawerOpen(true);
    void tvLoadWorkspaceRef.current(targetSeries.path);
  }, []);

  const openTvManagerForSeries = useCallback((path: string) => {
    tvSelectSeriesRef.current(path);
    setTvDrawerMode("manage");
    setTvDrawerOpen(true);
    void tvLoadWorkspaceRef.current(path);
  }, []);

  const openTvBatchDialog = useCallback(() => {
    const targetSeries = selectedTvSeriesRef.current;
    if (!targetSeries) return;
    tvSelectSeriesRef.current(targetSeries.path);
    setTvDrawerMode("batch");
    setTvDrawerOpen(true);
    void tvLoadWorkspaceRef.current(targetSeries.path);
  }, []);

  const openTvBatchDialogForSeries = useCallback((path: string) => {
    tvSelectSeriesRef.current(path);
    setTvDrawerMode("batch");
    setTvDrawerOpen(true);
    void tvLoadWorkspaceRef.current(path);
  }, []);

  useEffect(() => {
    if (!movieManagerOpen || !pendingMovieUploadPick) {
      return;
    }

    const timer = window.setTimeout(() => {
      movieDetailsRef.current?.openUploadPicker();
      setPendingMovieUploadPick(false);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [movieManagerOpen, pendingMovieUploadPick]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(LIBRARY_VIEW_STORAGE_KEY, libraryViewMode);
      window.__subtitleUiLibraryView = libraryViewMode;
    } catch {
      window.__subtitleUiLibraryView = libraryViewMode;
    }
  }, [libraryViewMode]);

  const shellModel = useMemo(() => ({
      activeTab,
      navItems,
      operationLocked,
      scanPending,
      refreshPending,
      statusBadgeClass,
      statusBadgeText,
      switchTab: actions.switchTab,
      triggerScan: actions.triggerScan,
      refreshActiveTab: actions.refreshActiveTab
    }), [
      actions.refreshActiveTab,
      actions.switchTab,
      actions.triggerScan,
      activeTab,
      navItems,
      operationLocked,
      refreshPending,
      scanPending,
      statusBadgeClass,
      statusBadgeText
    ]);

  const dashboardModel = useMemo(() => ({
      scanStatus,
      directoryScan,
      logs,
      logsPager,
      setLogsPage: dashboard.setLogsPage,
      clearLogs: dashboard.clearLogs,
      pending,
      formatTime
    }), [dashboard.clearLogs, dashboard.setLogsPage, directoryScan, formatTime, logs, logsPager, pending, scanStatus]);

  const movieModel = useMemo(() => ({
      query: movie.query,
      setQuery: movie.setQuery,
      videos: movie.videos,
      pager: movie.pager,
      viewMode: libraryViewMode,
      setViewMode: setLibraryViewMode,
      yearSortOrder: movie.yearSortOrder,
      toggleYearSort: movie.toggleYearSort,
      pending: pending.movieList,
      selectedVideo: selectedMovie,
      selectVideo: handleMovieSelect,
      setPage: movie.setPage,
      openUploadPicker: openMovieUploadPicker,
      openManager: openMovieManager
    }), [
      handleMovieSelect,
      movie.pager,
      movie.query,
      movie.setPage,
      movie.setQuery,
      movie.toggleYearSort,
      movie.videos,
      movie.yearSortOrder,
      openMovieManager,
      openMovieUploadPicker,
      pending.movieList,
      selectedMovie,
      libraryViewMode
    ]);

  const tvModel = useMemo(() => ({
      query: tv.query,
      setQuery: tv.setQuery,
      rows: tv.rows,
      pager: tv.pager,
      viewMode: libraryViewMode,
      setViewMode: setLibraryViewMode,
      yearSortOrder: tv.yearSortOrder,
      toggleYearSort: tv.toggleYearSort,
      pendingList: pending.tvSeriesList,
      showScanPrompt: showTvScanPrompt,
      selectSeries: tv.selectSeries,
      setPage: tv.setPage,
      openManagerForSeries: openTvManagerForSeries,
      openBatchForSeries: openTvBatchDialogForSeries,
      selectedSeries: tv.selectedSeries,
      selectedSeason: tv.selectedSeason,
      seasonOptions: tv.seasonOptions,
      videos: tv.videos,
      selectedVideo: selectedTvVideo,
      selectedVideoId: tv.selectedVideoId,
      selectVideo: handleTvSelect,
      setSelectedSeason: tv.setSelectedSeason,
      episodesPending: pending.tvEpisodes,
      scanLoading: scanPending,
      openManager: openTvManager,
      openBatchDialog: openTvBatchDialog
    }), [
      handleTvSelect,
      openTvBatchDialog,
      openTvBatchDialogForSeries,
      openTvManager,
      openTvManagerForSeries,
      pending.tvEpisodes,
      pending.tvSeriesList,
      scanPending,
      showTvScanPrompt,
      selectedTvVideo,
      tv.pager,
      tv.query,
      tv.rows,
      tv.seasonOptions,
      tv.selectedSeason,
      tv.selectedSeries,
      tv.selectedVideoId,
      tv.selectSeries,
      tv.setPage,
      tv.setQuery,
      tv.setSelectedSeason,
      tv.toggleYearSort,
      tv.videos,
      tv.yearSortOrder,
      libraryViewMode
    ]);

  const subtitleActionsModel = useMemo(() => ({
      uploadSubtitle: actions.uploadSubtitle,
      replaceSubtitle: actions.replaceSubtitle,
      removeSubtitle: actions.removeSubtitle,
      previewSubtitle: actions.previewSubtitle,
      uploading,
      uploadingMessage,
      subtitleAction: pending.subtitleAction,
      formatTime,
      operationLocked
    }), [
      actions.previewSubtitle,
      actions.removeSubtitle,
      actions.replaceSubtitle,
      actions.uploadSubtitle,
      formatTime,
      operationLocked,
      pending.subtitleAction,
      uploading,
      uploadingMessage
    ]);

  const dialogsModel = useMemo(() => ({
      movieManagerOpen,
      setMovieManagerOpen,
      movieDetailsRef,
      tvDrawerOpen,
      setTvDrawerOpen,
      tvDrawerMode,
      setTvDrawerMode,
      loadMovieWorkspaceOnDemand: movie.loadWorkspace,
      loadTvWorkspaceOnDemand: tv.loadWorkspace,
      loadTvBatchCandidates: tv.loadBatchCandidates,
      uploadBatchSubtitles: actions.uploadBatchSubtitles
    }), [
      actions.uploadBatchSubtitles,
      movie.loadWorkspace,
      movieManagerOpen,
      tv.loadBatchCandidates,
      tv.loadWorkspace,
      tvDrawerMode,
      tvDrawerOpen
    ]);

  return {
    shell: shellModel,
    dashboard: dashboardModel,
    movie: movieModel,
    tv: tvModel,
    subtitleActions: subtitleActionsModel,
    dialogs: dialogsModel
  };
}

export type SubtitleManagerScreenModel = ReturnType<typeof useSubtitleManagerScreenModel>;
