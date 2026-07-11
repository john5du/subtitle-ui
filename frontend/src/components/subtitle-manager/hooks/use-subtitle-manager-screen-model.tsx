"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Film, LayoutDashboard, Tv } from "lucide-react";

import { useSubtitleManager } from "@/hooks/use-subtitle-manager";
import { DEFAULT_PAGE_SIZE } from "@/hooks/use-subtitle-manager/state";
import { useI18n } from "@/lib/i18n";
import type { ActiveTab, Video } from "@/lib/types";

import type { LibraryViewMode, SubtitleDetailsPanelHandle, TvDrawerMode } from "../types";

const LIBRARY_VIEW_STORAGE_KEY = "subtitle-ui:library-view";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "subtitle-ui:sidebar-collapsed";

declare global {
  interface Window {
    __subtitleUiSidebarCollapsed?: boolean;
  }
}

function isLibraryViewMode(value: string | null | undefined): value is LibraryViewMode {
  return value === "list" || value === "card";
}

export function useSubtitleManagerScreenModel() {
  const { t } = useI18n();
  const { core, dashboard, movie, tv, actions } = useSubtitleManager();

  const {
    activeTab,
    pending,
    uploading,
    uploadingMessage,
    formatTime
  } = core;
  const { logs, logsPager, scanStatus, directoryScan, versionInfo } = dashboard;

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    try {
      if (typeof window.__subtitleUiSidebarCollapsed === "boolean") {
        return window.__subtitleUiSidebarCollapsed;
      }
      return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const movieDetailsRef = useRef<SubtitleDetailsPanelHandle | null>(null);

  const navItems = useMemo<Array<{ key: ActiveTab; icon: ReactNode; label: string }>>(
    () => [
      { key: "tv", icon: <Tv className="h-5 w-5" />, label: t("nav.tv") },
      { key: "movie", icon: <Film className="h-5 w-5" />, label: t("nav.movie") },
      { key: "dashboard", icon: <LayoutDashboard className="h-5 w-5" />, label: t("settings.title") }
    ],
    [t]
  );
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

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((current) => !current);
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

  const setMoviePageSize = movie.setPageSize;
  const setTvPageSize = tv.setPageSize;

  useEffect(() => {
    if (libraryViewMode !== "list") {
      return;
    }
    setMoviePageSize(DEFAULT_PAGE_SIZE);
    setTvPageSize(DEFAULT_PAGE_SIZE);
  }, [libraryViewMode, setMoviePageSize, setTvPageSize]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(sidebarCollapsed));
      window.__subtitleUiSidebarCollapsed = sidebarCollapsed;
    } catch {
      window.__subtitleUiSidebarCollapsed = sidebarCollapsed;
    }
  }, [sidebarCollapsed]);

  const shellModel = useMemo(() => ({
      activeTab,
      navItems,
      sidebarCollapsed,
      toggleSidebarCollapsed,
      operationLocked,
      scanPending,
      refreshPending,
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
      sidebarCollapsed,
      toggleSidebarCollapsed
    ]);

  const dashboardModel = useMemo(() => ({
      scanStatus,
      directoryScan,
      logs,
      logsPager,
      versionInfo,
      setLogsPage: dashboard.setLogsPage,
      refreshLogs: dashboard.refreshLogs,
      clearLogs: dashboard.clearLogs,
      setLogsDialogOpen: dashboard.setLogsDialogOpen,
      pending,
      formatTime
    }), [dashboard.clearLogs, dashboard.refreshLogs, dashboard.setLogsDialogOpen, dashboard.setLogsPage, directoryScan, formatTime, logs, logsPager, pending, scanStatus, versionInfo]);

  const movieModel = useMemo(() => ({
      query: movie.query,
      setQuery: movie.setQuery,
      videos: movie.videos,
      pager: movie.pager,
      viewMode: libraryViewMode,
      setViewMode: setLibraryViewMode,
      sortBy: movie.sortBy,
      sortOrder: movie.sortOrder,
      setSortBy: movie.setSortBy,
      toggleSortOrder: movie.toggleSortOrder,
      pending: pending.movieList,
      selectedVideo: selectedMovie,
      selectVideo: handleMovieSelect,
      setPage: movie.setPage,
      setPageSize: movie.setPageSize,
      openUploadPicker: openMovieUploadPicker,
      openManager: openMovieManager
    }), [
      handleMovieSelect,
      movie.pager,
      movie.query,
      movie.setPage,
      movie.setPageSize,
      movie.setQuery,
      movie.setSortBy,
      movie.sortBy,
      movie.sortOrder,
      movie.toggleSortOrder,
      movie.videos,
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
      sortBy: tv.sortBy,
      sortOrder: tv.sortOrder,
      setSortBy: tv.setSortBy,
      toggleSortOrder: tv.toggleSortOrder,
      pendingList: pending.tvSeriesList,
      showScanPrompt: showTvScanPrompt,
      selectSeries: tv.selectSeries,
      setPage: tv.setPage,
      setPageSize: tv.setPageSize,
      openManagerForSeries: openTvManagerForSeries,
      openBatchForSeries: openTvBatchDialogForSeries,
      selectedSeries: tv.selectedSeries,
      selectedSeason: tv.selectedSeason,
      seasonOptions: tv.seasonOptions,
      videos: tv.videos,
      seriesVideos: tv.seriesVideos,
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
      tv.seriesVideos,
      tv.setPage,
      tv.setPageSize,
      tv.setQuery,
      tv.setSelectedSeason,
      tv.setSortBy,
      tv.sortBy,
      tv.sortOrder,
      tv.toggleSortOrder,
      tv.videos,
      libraryViewMode
    ]);

  const subtitleActionsModel = useMemo(() => ({
      uploadSubtitle: actions.uploadSubtitle,
      replaceSubtitle: actions.replaceSubtitle,
      convertSubtitleToAss: actions.convertSubtitleToAss,
      offsetSubtitleTiming: actions.offsetSubtitleTiming,
      removeSubtitle: actions.removeSubtitle,
      previewSubtitle: actions.previewSubtitle,
      searchSubHDSubtitles: actions.searchSubHDSubtitles,
      downloadSubHDSubtitle: actions.downloadSubHDSubtitle,
      uploading,
      uploadingMessage,
      subtitleAction: pending.subtitleAction,
      formatTime,
      operationLocked
    }), [
      actions.previewSubtitle,
      actions.convertSubtitleToAss,
      actions.downloadSubHDSubtitle,
      actions.offsetSubtitleTiming,
      actions.removeSubtitle,
      actions.replaceSubtitle,
      actions.searchSubHDSubtitles,
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
      uploadBatchSubtitles: actions.uploadBatchSubtitles,
      removeSubtitlesBatch: actions.removeSubtitlesBatch,
      searchSubHDSeasonPacks: actions.searchSubHDSeasonPacks,
      prepareSubHDSeasonPack: actions.prepareSubHDSeasonPack,
      installSubHDSeasonPack: actions.installSubHDSeasonPack
    }), [
      actions.installSubHDSeasonPack,
      actions.prepareSubHDSeasonPack,
      actions.removeSubtitlesBatch,
      actions.searchSubHDSeasonPacks,
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
