"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Film, FileText, LayoutDashboard, Tv } from "lucide-react";

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
  const { logs, scanStatus, directoryScan } = dashboard;

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

  const navItems: Array<{ key: ActiveTab; icon: ReactNode; label: string }> = [
    { key: "dashboard", icon: <LayoutDashboard className="h-5 w-5" />, label: t("nav.overview") },
    { key: "movie", icon: <Film className="h-5 w-5" />, label: t("nav.movie") },
    { key: "tv", icon: <Tv className="h-5 w-5" />, label: t("nav.tv") },
    { key: "logs", icon: <FileText className="h-5 w-5" />, label: t("nav.logs") }
  ];
  const activeTabLabel = navItems.find((item) => item.key === activeTab)?.label || activeTab;
  const selectedMovie = movie.selectedVideo;
  const selectedTvVideo = tv.selectedVideo;
  const showTvScanPrompt = tv.showScanPrompt;

  const statusBadgeClass = useMemo(() => {
    if (scanPending) {
      return "border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.03)] text-[rgba(255,255,255,0.5)]";
    }
    if (refreshPending) {
      return "border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.03)] text-[rgba(255,255,255,0.5)]";
    }
    if (uploading) {
      return "border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.03)] text-[rgba(255,255,255,0.5)]";
    }
    if (pending.tabSwitch || pending.bootstrapping || loading) {
      return "border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] text-[rgba(255,255,255,0.5)]";
    }
    return "border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.03)] text-[rgba(255,255,255,0.7)]";
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

  function handleMovieSelect(video: Video) {
    movie.selectVideo(video);
  }

  function handleTvSelect(video: Video) {
    tv.selectVideo(video);
  }

  function openMovieUploadPicker(video?: Video) {
    const targetVideo = video || selectedMovie;
    if (!targetVideo) return;
    movie.selectVideo(targetVideo);
    setPendingMovieUploadPick(true);
    setMovieManagerOpen(true);
    void movie.loadWorkspace();
  }

  function openMovieManager(video?: Video) {
    const targetVideo = video || selectedMovie;
    if (!targetVideo) return;
    movie.selectVideo(targetVideo);
    setMovieManagerOpen(true);
    void movie.loadWorkspace();
  }

  function openTvManager() {
    const targetSeries = tv.selectedSeries;
    if (!targetSeries) return;
    tv.selectSeries(targetSeries.path);
    setTvDrawerMode("manage");
    setTvDrawerOpen(true);
    void tv.loadWorkspace(targetSeries.path);
  }

  function openTvManagerForSeries(path: string) {
    tv.selectSeries(path);
    setTvDrawerMode("manage");
    setTvDrawerOpen(true);
    void tv.loadWorkspace(path);
  }

  function openTvBatchDialog() {
    const targetSeries = tv.selectedSeries;
    if (!targetSeries) return;
    tv.selectSeries(targetSeries.path);
    setTvDrawerMode("batch");
    setTvDrawerOpen(true);
    void tv.loadWorkspace(targetSeries.path);
  }

  function openTvBatchDialogForSeries(path: string) {
    tv.selectSeries(path);
    setTvDrawerMode("batch");
    setTvDrawerOpen(true);
    void tv.loadWorkspace(path);
  }

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

  return {
    shell: {
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
    },
    dashboard: {
      scanStatus,
      directoryScan,
      message,
      logs,
      pending,
      formatTime
    },
    movie: {
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
    },
    tv: {
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
    },
    logs: {
      items: logs,
      pending: pending.logs,
      formatTime
    },
    subtitleActions: {
      uploadSubtitle: actions.uploadSubtitle,
      replaceSubtitle: actions.replaceSubtitle,
      removeSubtitle: actions.removeSubtitle,
      previewSubtitle: actions.previewSubtitle,
      uploading,
      uploadingMessage,
      subtitleAction: pending.subtitleAction,
      formatTime,
      operationLocked
    },
    dialogs: {
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
    }
  };
}

export type SubtitleManagerScreenModel = ReturnType<typeof useSubtitleManagerScreenModel>;
