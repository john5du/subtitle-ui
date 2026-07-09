import type { ActiveTab, Video } from "@/lib/types";
import { requestPayload } from "@/lib/subtitle-manager/api-client";
import { normalizeDirectoryScanResult, normalizeScanStatus } from "@/lib/subtitle-manager/normalizers";
import { normalizeForCompare, pickDefaultTvDirectory } from "@/lib/subtitle-manager/tv-tree";

import { DEFAULT_LOG_PAGE_SIZE } from "./state";
import type { ControllerRuntime } from "./controller-runtime";
import type { LoadActions } from "./controller-load";

export function createWorkspaceActions(runtime: ControllerRuntime, load: LoadActions) {
  const {
    state,
    setters,
    selectors,
    t,
    beginLoadChannel,
    endLoadChannel,
    beginLoading,
    endLoading,
    setTranslatedMessage,
    notifySuccess,
    notifyInfo,
    reportRequestError
  } = runtime;
  const {
    loadMovieVideos,
    loadVersionInfo,
    loadTvSeriesPage,
    requestTvVideosForPath,
    shouldRefreshTvVideosForPath,
    refreshTvVideosForPath,
    loadScanStatus,
    loadDirectoryScanResult,
    loadLogs
  } = load;

  async function clearLogs() {
    beginLoadChannel("logs");
    try {
      await requestPayload<unknown>("/api/logs", { method: "DELETE" });
      setters.setLogs([]);
      setters.setLogsPager({
        page: 1,
        pageSize: state.logsPager.pageSize || DEFAULT_LOG_PAGE_SIZE,
        total: 0,
        totalPages: 0
      });
      setTranslatedMessage("status.logsCleared");
      notifySuccess(t("toast.logsClearedTitle"), t("toast.logsClearedMessage"));
      return true;
    } catch (error) {
      reportRequestError("error.clearLogs", error);
      return false;
    } finally {
      endLoadChannel("logs");
    }
  }

  async function switchTab(tab: ActiveTab) {
    setters.setPending((prev) => ({ ...prev, tabSwitch: true }));
    setters.setActiveTab(tab);

    try {
      if (tab === "settings") {
        if (!state.loadedTabs.settings) {
          await loadVersionInfo();
        }
        setters.setLoadedTabs((prev) => ({ ...prev, settings: true }));
        return;
      }

      if (tab === "dashboard") {
        await Promise.all([loadScanStatus(), loadDirectoryScanResult()]);
        setters.setLoadedTabs((prev) => ({ ...prev, dashboard: true }));
        return;
      }

      if (tab === "tv") {
        if (!state.loadedTabs.tv) {
          const defaultDir = state.directoryScan.generatedAt ? state.selectedTvDirPath : await loadDirectoryScanResult();
          const seriesRows = await loadTvSeriesPage({ page: state.tvSeriesPager.page || 1 });
          const selectedNorm = normalizeForCompare(state.selectedTvDirPath);
          const targetDir =
            seriesRows.find((item) => normalizeForCompare(item.path) === selectedNorm)?.path ||
            seriesRows.find((item) => item.path)?.path ||
            state.selectedTvDirPath ||
            defaultDir ||
            state.directoryScan.tvRoot;

          if (targetDir) {
            setters.setSelectedTvDirPath(targetDir);
          } else {
            setters.setTvEpisodes([]);
            setters.setTvEpisodesPath("");
          }

          setters.setLoadedTabs((prev) => ({ ...prev, tv: true }));
        }
        return;
      }

      await loadMovieVideos({ page: selectors.moviePager.page || 1 });
      setters.setLoadedTabs((prev) => ({ ...prev, movie: true }));
    } finally {
      setters.setPending((prev) => ({ ...prev, tabSwitch: false }));
    }
  }

  async function triggerScan() {
    beginLoading();
    setters.setPending((prev) => ({ ...prev, scan: true }));
    setTranslatedMessage("status.scanStepDirs");

    try {
      const discoveredPayload = await requestPayload<unknown>("/api/scan/directories", { method: "POST" });
      const discovered = normalizeDirectoryScanResult(discoveredPayload);
      setters.setDirectoryScan(discovered);

      const defaultDir = pickDefaultTvDirectory(discovered);
      if (defaultDir) {
        setters.setSelectedTvDirPath(defaultDir);
      }

      setTranslatedMessage("status.scanStepFiles");

      const payload = {
        movieDirs: discovered.movie.map((item) => item.path),
        tvDirs: discovered.tv.map((item) => item.path)
      };

      const statusPayload = await requestPayload<unknown>("/api/scan/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const normalizedStatus = normalizeScanStatus(statusPayload);
      setters.setScanStatus(normalizedStatus);

      const targetDir = defaultDir || selectors.tvRootPath || discovered.tvRoot || "";
      await Promise.all([
        loadMovieVideos({ page: 1, force: true }),
        loadTvSeriesPage({ page: 1, force: true }),
        refreshTvVideosForPath(selectors.selectedTvSeries?.path || state.selectedTvDirPath || state.tvEpisodesPath || targetDir),
        loadLogs({ page: 1 })
      ]);

      const warningCount = discovered.errors.length;
      const videoCount = normalizedStatus?.videoCount ?? 0;
      if (warningCount > 0) {
        setTranslatedMessage("status.scanCompletedWithWarnings", { count: videoCount, warnings: warningCount });
        notifyInfo(
          t("toast.scanWarningsTitle"),
          t("toast.scanWarningsMessage", { count: videoCount }),
          t("toast.scanWarningsDetail", { warnings: warningCount })
        );
      } else {
        setTranslatedMessage("status.scanCompletedNoWarnings", { count: videoCount });
        notifySuccess(
          t("toast.scanSuccessTitle"),
          t("toast.scanSuccessMessage", { count: videoCount }),
          t("toast.scanSuccessDetail")
        );
      }
    } catch (error) {
      reportRequestError("error.scanFailed", error);
    } finally {
      setters.setPending((prev) => ({ ...prev, scan: false }));
      endLoading();
    }
  }

  async function refreshActiveTab() {
    if (state.activeTab === "settings") {
      return;
    }

    setters.setPending((prev) => ({ ...prev, refreshTab: state.activeTab }));
    try {
      if (state.activeTab === "dashboard") {
        await Promise.all([loadScanStatus(), loadDirectoryScanResult()]);
        setTranslatedMessage("status.dashboardRefreshed");
        notifySuccess(t("toast.dashboardRefreshedTitle"), t("toast.dashboardRefreshedMessage"));
        return;
      }

      if (state.activeTab === "tv") {
        const targetDir = selectors.selectedTvSeries?.path || state.selectedTvDirPath || selectors.tvRootPath || state.directoryScan.tvRoot || "";
        const reloadEpisodes = shouldRefreshTvVideosForPath(targetDir);
        await Promise.all([loadTvSeriesPage({ page: state.tvSeriesPager.page || 1, force: true }), refreshTvVideosForPath(targetDir)]);
        setTranslatedMessage("status.tvRefreshed");
        notifySuccess(
          t("toast.tvRefreshedTitle"),
          reloadEpisodes ? t("toast.tvRefreshedMessageAll") : t("toast.tvRefreshedMessageList")
        );
        return;
      }

      await loadMovieVideos({ page: selectors.moviePager.page || 1, force: true });
      setTranslatedMessage("status.movieRefreshed");
      notifySuccess(t("toast.movieRefreshedTitle"), t("toast.movieRefreshedMessage"));
    } finally {
      setters.setPending((prev) => ({ ...prev, refreshTab: null }));
    }
  }

  async function loadMovieWorkspace() {
    return;
  }

  async function loadTvWorkspace(seriesPath = "") {
    const requestedPath = seriesPath.trim();
    const selectedNorm = normalizeForCompare(requestedPath || selectors.selectedTvSeries?.path || state.selectedTvDirPath);
    const selectedPath = (
      state.tvSeriesRows.find((item) => normalizeForCompare(item.path) === selectedNorm)?.path ||
      requestedPath ||
      selectors.selectedTvSeries?.path ||
      state.selectedTvDirPath ||
      state.tvSeriesRows.find((item) => item.path)?.path ||
      selectors.tvRootPath ||
      state.directoryScan.tvRoot ||
      ""
    ).trim();

    if (!selectedPath) {
      return [];
    }

    setters.setSelectedTvDirPath(selectedPath);
    return requestTvVideosForPath(selectedPath);
  }

  function setMoviePage(nextPage: number) {
    const totalPages = Math.max(1, selectors.moviePager.totalPages || 1);
    if (nextPage < 1 || nextPage > totalPages || nextPage === selectors.moviePager.page) {
      return;
    }
    void loadMovieVideos({ page: nextPage });
  }

  function setTvPage(nextPage: number) {
    const totalPages = Math.max(1, selectors.tvPager.totalPages || 1);
    if (nextPage < 1 || nextPage > totalPages || nextPage === selectors.tvPager.page) {
      return;
    }
    void loadTvSeriesPage({ page: nextPage });
  }

  function setLogsPage(nextPage: number) {
    const totalPages = Math.max(1, state.logsPager.totalPages || 1);
    if (nextPage < 1 || nextPage > totalPages || nextPage === state.logsPager.page) {
      return;
    }
    void loadLogs({ page: nextPage });
  }

  function toggleMovieYearSort() {
    setters.setMovieYearSortOrder((prev) => (prev === "desc" ? "asc" : "desc"));
  }

  function toggleTvSeriesYearSort() {
    setters.setTvSeriesYearSortOrder((prev) => (prev === "desc" ? "asc" : "desc"));
  }

  function selectMovieVideo(video: Video) {
    setters.setSelectedVideoIdByType((prev) => (prev.movie === video.id ? prev : { ...prev, movie: video.id }));
  }

  function selectTvVideo(video: Video) {
    setters.setSelectedVideoIdByType((prev) => (prev.tv === video.id ? prev : { ...prev, tv: video.id }));
  }

  function selectTvDirectory(path: string) {
    const nextNorm = normalizeForCompare(path);
    const currentNorm = normalizeForCompare(state.selectedTvDirPath);

    if (nextNorm === currentNorm) {
      return;
    }

    setters.setSelectedTvDirPath(path);
    setters.setSelectedTvSeason("");
    setters.setSelectedVideoIdByType((prev) => (prev.tv ? { ...prev, tv: "" } : prev));
  }

  function setMovieQuery(value: string) {
    setters.setQueryByType((prev) => (prev.movie === value ? prev : { ...prev, movie: value }));
  }

  function setTvQuery(value: string) {
    setters.setQueryByType((prev) => (prev.tv === value ? prev : { ...prev, tv: value }));
  }

  function setSelectedTvSeason(value: string) {
    setters.setSelectedTvSeason((prev) => (prev === value ? prev : value));
  }

  return {
    clearLogs,
    switchTab,
    triggerScan,
    refreshActiveTab,
    loadMovieWorkspace,
    loadTvWorkspace,
    setMoviePage,
    setTvPage,
    setLogsPage,
    toggleMovieYearSort,
    toggleTvSeriesYearSort,
    selectMovieVideo,
    selectTvVideo,
    selectTvDirectory,
    setMovieQuery,
    setTvQuery,
    setSelectedTvSeason
  };
}

export type WorkspaceActions = ReturnType<typeof createWorkspaceActions>;
