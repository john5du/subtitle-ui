import type { ActiveTab, Video } from "@/lib/types";
import { requestPayload } from "@/lib/subtitle-manager/api-client";
import { normalizeDirectoryScanResult, normalizeScanStatus } from "@/lib/subtitle-manager/normalizers";
import { normalizeForCompare, pickDefaultTvDirectory } from "@/lib/subtitle-manager/path-utils";
import {
  clampPage,
  clampPageSize,
  resolveTvInitialPath,
  resolveTvWorkspacePath
} from "@/lib/subtitle-manager/workspace-path";

import { DEFAULT_LOG_PAGE_SIZE, DEFAULT_PAGE_SIZE } from "./state";
import type { ControllerRuntime } from "./controller-runtime";
import type { LoadActions } from "./controller-load";
import type { MovieSortBy, TvSeriesSortBy } from "./types";

export function createWorkspaceActions(runtime: ControllerRuntime, load: LoadActions) {
  const {
    setters,
    beginLoadChannel,
    endLoadChannel,
    beginLoading,
    endLoading,
    notifySuccess,
    notifyInfo,
    reportRequestError
  } = runtime;
  const {
    loadMovieVideos,
    loadVersionInfo,
    loadTvSeriesPage,
    requestTvVideosForPath,
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
        pageSize: runtime.state.logsPager.pageSize || DEFAULT_LOG_PAGE_SIZE,
        total: 0,
        totalPages: 0
      });
      notifySuccess(runtime.t("toast.logsClearedTitle"));
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
      if (tab === "dashboard") {
        await Promise.all([loadScanStatus(), loadDirectoryScanResult(), loadVersionInfo()]);
        setters.setLoadedTabs((prev) => ({ ...prev, dashboard: true }));
        return;
      }

      if (tab === "tv") {
        if (!runtime.state.loadedTabs.tv) {
          const defaultDir = runtime.state.directoryScan.generatedAt
            ? runtime.state.selectedTvDirPath
            : await loadDirectoryScanResult();
          const seriesRows = await loadTvSeriesPage({ page: runtime.state.tvSeriesPager.page || 1 });
          const targetDir = resolveTvInitialPath({
            seriesRows,
            selectedPath: runtime.state.selectedTvDirPath,
            defaultDir,
            tvRoot: runtime.state.directoryScan.tvRoot
          });

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

      await loadMovieVideos({ page: runtime.selectors.moviePager.page || 1 });
      setters.setLoadedTabs((prev) => ({ ...prev, movie: true }));
    } finally {
      setters.setPending((prev) => ({ ...prev, tabSwitch: false }));
    }
  }

  async function triggerScan() {
    beginLoading();
    setters.setPending((prev) => ({ ...prev, scan: true }));

    try {
      const discoveredPayload = await requestPayload<unknown>("/api/scan/directories", { method: "POST" });
      const discovered = normalizeDirectoryScanResult(discoveredPayload);
      setters.setDirectoryScan(discovered);

      const defaultDir = pickDefaultTvDirectory(discovered);
      if (defaultDir) {
        setters.setSelectedTvDirPath(defaultDir);
      }

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

      const targetDir = defaultDir || runtime.selectors.tvRootPath || discovered.tvRoot || "";
      await Promise.all([
        loadMovieVideos({ page: 1, force: true }),
        loadTvSeriesPage({ page: 1, force: true }),
        refreshTvVideosForPath(
          runtime.selectors.selectedTvSeries?.path ||
            runtime.state.selectedTvDirPath ||
            runtime.state.tvEpisodesPath ||
            targetDir
        ),
        loadLogs({ page: 1 })
      ]);

      const warningCount = discovered.errors.length;
      const videoCount = normalizedStatus?.videoCount ?? 0;
      if (warningCount > 0) {
        notifyInfo(
          runtime.t("toast.scanWarningsTitle"),
          runtime.t("toast.scanWarningsDetail", { count: videoCount, warnings: warningCount })
        );
      } else {
        notifySuccess(runtime.t("toast.scanSuccessMessage", { count: videoCount }));
      }
    } catch (error) {
      reportRequestError("error.scanFailed", error);
    } finally {
      setters.setPending((prev) => ({ ...prev, scan: false }));
      endLoading();
    }
  }

  async function refreshActiveTab() {
    setters.setPending((prev) => ({ ...prev, refreshTab: runtime.state.activeTab }));
    try {
      if (runtime.state.activeTab === "dashboard") {
        await Promise.all([loadScanStatus(), loadDirectoryScanResult(), loadVersionInfo()]);
        notifySuccess(runtime.t("toast.dashboardRefreshedTitle"));
        return;
      }

      if (runtime.state.activeTab === "tv") {
        const targetDir =
          runtime.selectors.selectedTvSeries?.path ||
          runtime.state.selectedTvDirPath ||
          runtime.selectors.tvRootPath ||
          runtime.state.directoryScan.tvRoot ||
          "";
        await Promise.all([
          loadTvSeriesPage({ page: runtime.state.tvSeriesPager.page || 1, force: true }),
          refreshTvVideosForPath(targetDir)
        ]);
        notifySuccess(runtime.t("toast.tvRefreshedTitle"));
        return;
      }

      await loadMovieVideos({ page: runtime.selectors.moviePager.page || 1, force: true });
      notifySuccess(runtime.t("toast.movieRefreshedTitle"));
    } finally {
      setters.setPending((prev) => ({ ...prev, refreshTab: null }));
    }
  }

  async function loadMovieWorkspace() {
    return;
  }

  async function loadTvWorkspace(seriesPath = "") {
    const state = runtime.state;
    const selectors = runtime.selectors;
    const selectedPath = resolveTvWorkspacePath({
      seriesRows: state.tvSeriesRows,
      requestedPath: seriesPath,
      selectedSeriesPath: selectors.selectedTvSeries?.path,
      selectedPath: state.selectedTvDirPath,
      tvRootPath: selectors.tvRootPath,
      tvRoot: state.directoryScan.tvRoot
    });

    if (!selectedPath) {
      return [];
    }

    setters.setSelectedTvDirPath(selectedPath);
    return requestTvVideosForPath(selectedPath);
  }

  function setMoviePage(nextPage: number) {
    const page = clampPage(nextPage, runtime.selectors.moviePager.totalPages || 1, runtime.selectors.moviePager.page);
    if (page == null) {
      return;
    }
    void loadMovieVideos({ page });
  }

  function setMoviePageSize(pageSize: number) {
    const current = runtime.state.moviePager.pageSize || DEFAULT_PAGE_SIZE;
    const next = clampPageSize(pageSize, current);
    if (next == null) {
      return;
    }
    setters.setMoviePager((prev) => ({
      ...prev,
      page: 1,
      pageSize: next
    }));
    void loadMovieVideos({ page: 1, pageSize: next, force: true, quiet: true });
  }

  function setTvPage(nextPage: number) {
    const page = clampPage(nextPage, runtime.selectors.tvPager.totalPages || 1, runtime.selectors.tvPager.page);
    if (page == null) {
      return;
    }
    void loadTvSeriesPage({ page });
  }

  function setTvPageSize(pageSize: number) {
    const current = runtime.state.tvSeriesPager.pageSize || DEFAULT_PAGE_SIZE;
    const next = clampPageSize(pageSize, current);
    if (next == null) {
      return;
    }
    setters.setTvSeriesPager((prev) => ({
      ...prev,
      page: 1,
      pageSize: next
    }));
    void loadTvSeriesPage({ page: 1, pageSize: next, force: true, quiet: true });
  }

  function setLogsPage(nextPage: number) {
    const page = clampPage(nextPage, runtime.state.logsPager.totalPages || 1, runtime.state.logsPager.page);
    if (page == null) {
      return;
    }
    void loadLogs({ page });
  }

  function setLogsDialogOpen(open: boolean) {
    runtime.refs.logsDialogOpenRef.current = open;
  }

  function setMovieSortBy(value: MovieSortBy) {
    setters.setMovieSortBy(value);
  }

  function toggleMovieSortOrder() {
    setters.setMovieSortOrder((prev) => (prev === "desc" ? "asc" : "desc"));
  }

  function setTvSeriesSortBy(value: TvSeriesSortBy) {
    setters.setTvSeriesSortBy(value);
  }

  function toggleTvSeriesSortOrder() {
    setters.setTvSeriesSortOrder((prev) => (prev === "desc" ? "asc" : "desc"));
  }

  function selectMovieVideo(video: Video) {
    setters.setSelectedVideoIdByType((prev) => (prev.movie === video.id ? prev : { ...prev, movie: video.id }));
  }

  function selectTvVideo(video: Video) {
    setters.setSelectedVideoIdByType((prev) => (prev.tv === video.id ? prev : { ...prev, tv: video.id }));
  }

  function selectTvDirectory(path: string) {
    const nextNorm = normalizeForCompare(path);
    const currentNorm = normalizeForCompare(runtime.state.selectedTvDirPath);

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
    setMoviePageSize,
    setTvPage,
    setTvPageSize,
    setLogsPage,
    setLogsDialogOpen,
    setMovieSortBy,
    toggleMovieSortOrder,
    setTvSeriesSortBy,
    toggleTvSeriesSortOrder,
    selectMovieVideo,
    selectTvVideo,
    selectTvDirectory,
    setMovieQuery,
    setTvQuery,
    setSelectedTvSeason
  };
}

export type WorkspaceActions = ReturnType<typeof createWorkspaceActions>;
