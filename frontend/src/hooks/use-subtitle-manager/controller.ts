import type { MessageKey, TranslateFn, TranslationValues } from "@/lib/i18n";
import { emitToast } from "@/lib/toast";
import type {
  ActiveTab,
  BatchSubtitleUploadItem,
  BatchSubtitleUploadResult,
  PendingSubtitleAction,
  Subtitle,
  Video
} from "@/lib/types";
import { requestBinary, requestPayload } from "@/lib/subtitle-manager/api-client";
import {
  normalizeDirectoryScanResult,
  normalizeLogs,
  normalizePagedVideosResponse,
  normalizeScanStatus,
  normalizeTvSeriesPage
} from "@/lib/subtitle-manager/normalizers";
import { normalizeForCompare, pickDefaultTvDirectory } from "@/lib/subtitle-manager/tv-tree";

import { DEFAULT_PAGE_SIZE } from "./state";
import type {
  LoadChannel,
  SubtitleManagerController,
  SubtitleManagerSelectors,
  SubtitleManagerStateApi
} from "./types";

interface CreateSubtitleManagerControllerParams {
  stateApi: SubtitleManagerStateApi;
  selectors: SubtitleManagerSelectors;
  t: TranslateFn;
}

export function createSubtitleManagerController({
  stateApi,
  selectors,
  t
}: CreateSubtitleManagerControllerParams): SubtitleManagerController {
  const { state, setters, refs } = stateApi;

  function beginLoadChannel(channel: LoadChannel) {
    refs.pendingLoadChannelsRef.current[channel] += 1;
    setters.setPending((prev) => ({ ...prev, [channel]: true }));
  }

  function endLoadChannel(channel: LoadChannel) {
    refs.pendingLoadChannelsRef.current[channel] = Math.max(0, refs.pendingLoadChannelsRef.current[channel] - 1);
    if (refs.pendingLoadChannelsRef.current[channel] === 0) {
      setters.setPending((prev) => ({ ...prev, [channel]: false }));
    }
  }

  function setSubtitleActionPending(action: PendingSubtitleAction | null) {
    setters.setPending((prev) => ({ ...prev, subtitleAction: action }));
  }

  function finishBootstrapping() {
    setters.setPending((prev) => (prev.bootstrapping ? { ...prev, bootstrapping: false } : prev));
  }

  function beginLoading() {
    refs.pendingLoadsRef.current += 1;
    setters.setLoading(true);
  }

  function endLoading() {
    refs.pendingLoadsRef.current = Math.max(0, refs.pendingLoadsRef.current - 1);
    if (refs.pendingLoadsRef.current === 0) {
      setters.setLoading(false);
    }
  }

  function setTranslatedMessage(key: MessageKey, values?: TranslationValues) {
    setters.setMessageState({ key, values });
  }

  function beginUpload(key: MessageKey, values?: TranslationValues) {
    refs.pendingUploadsRef.current += 1;
    setters.setUploadingMessageState({ key, values });
    setters.setUploading(true);
  }

  function updateUploadMessage(key: MessageKey, values?: TranslationValues) {
    setters.setUploadingMessageState({ key, values });
  }

  function endUpload() {
    refs.pendingUploadsRef.current = Math.max(0, refs.pendingUploadsRef.current - 1);
    if (refs.pendingUploadsRef.current === 0) {
      setters.setUploading(false);
      setters.setUploadingMessageState(null);
    }
  }

  function reportRequestError(prefix: MessageKey, error: unknown) {
    const errorText = error instanceof Error ? error.message : String(error);
    const title = t(prefix);
    setters.setMessageState({ raw: `${title}: ${errorText}` });
    emitToast({
      level: "error",
      title,
      message: errorText,
      detail: t("toast.operationFailedDetail")
    });
  }

  function notifySuccess(title: string, message: string, detail?: string) {
    emitToast({
      level: "success",
      title,
      message,
      detail
    });
  }

  function notifyInfo(title: string, message: string, detail?: string) {
    emitToast({
      level: "info",
      title,
      message,
      detail
    });
  }

  async function loadMovieVideos(options: { page?: number } = {}) {
    beginLoadChannel("movieList");
    beginLoading();
    try {
      const page = options.page || state.paginationByType.movie.page || 1;
      const pageSize = state.paginationByType.movie.pageSize || DEFAULT_PAGE_SIZE;
      const query = state.queryByType.movie || "";

      const params = new URLSearchParams();
      params.set("mediaType", "movie");
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      params.set("sortBy", "year");
      params.set("sortOrder", state.movieYearSortOrder);
      if (query.trim()) {
        params.set("q", query.trim());
      }

      const payload = await requestPayload<unknown>(`/api/videos?${params.toString()}`);
      const pageData = normalizePagedVideosResponse(payload, page, pageSize);
      setters.setVideosByType((prev) => ({ ...prev, movie: pageData.items }));
      setters.setPaginationByType((prev) => ({
        ...prev,
        movie: {
          page: pageData.page,
          pageSize: pageData.pageSize,
          total: pageData.total,
          totalPages: pageData.totalPages
        }
      }));
    } catch (error) {
      reportRequestError("error.loadMovieVideos", error);
    } finally {
      endLoading();
      endLoadChannel("movieList");
    }
  }

  async function loadTvSeriesPage(options: { page?: number } = {}) {
    beginLoadChannel("tvSeriesList");
    beginLoading();
    try {
      const page = options.page || state.tvSeriesPager.page || 1;
      const pageSize = state.tvSeriesPager.pageSize || DEFAULT_PAGE_SIZE;
      const query = state.queryByType.tv || "";

      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      params.set("sortYear", "year");
      params.set("sortOrder", state.tvSeriesYearSortOrder);
      if (query.trim()) {
        params.set("q", query.trim());
      }

      const payload = await requestPayload<unknown>(`/api/tv/series?${params.toString()}`);
      const pageData = normalizeTvSeriesPage(payload, page, pageSize);
      setters.setTvSeriesRows(pageData.items);
      setters.setTvSeriesPager({
        page: pageData.page,
        pageSize: pageData.pageSize,
        total: pageData.total,
        totalPages: pageData.totalPages
      });
      return pageData.items;
    } catch (error) {
      reportRequestError("error.loadTvSeries", error);
      return [];
    } finally {
      endLoading();
      endLoadChannel("tvSeriesList");
    }
  }

  async function listAllTvVideos(directoryPath = "") {
    const directory = directoryPath.trim();
    const videos: Video[] = [];
    let page = 1;
    let totalPages = 1;
    const pageSize = 200;

    while (page <= totalPages) {
      const params = new URLSearchParams();
      params.set("mediaType", "tv");
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      if (directory) {
        params.set("dir", directory);
      }

      const payload = await requestPayload<unknown>(`/api/videos?${params.toString()}`);
      const pageData = normalizePagedVideosResponse(payload, page, pageSize);
      videos.push(...pageData.items);
      totalPages = Math.max(1, pageData.totalPages || 1);
      page += 1;
    }

    return videos;
  }

  async function loadTvEpisodesForSeries(seriesPath: string) {
    const directory = seriesPath.trim();
    if (!directory) {
      setters.setTvEpisodes([]);
      setters.setTvEpisodesPath("");
      refs.pendingTvEpisodesPathRef.current = "";
      setters.setSelectedVideoIdByType((prev) => ({ ...prev, tv: "" }));
      return [];
    }

    refs.pendingTvEpisodesPathRef.current = directory;
    beginLoadChannel("tvEpisodes");
    beginLoading();
    try {
      const videos = await listAllTvVideos(directory);
      setters.setTvEpisodes(videos);
      setters.setTvEpisodesPath(directory);
      setters.setVideosByType((prev) => ({ ...prev, tv: videos }));
      setters.setPaginationByType((prev) => ({
        ...prev,
        tv: {
          page: 1,
          pageSize: videos.length > 0 ? videos.length : DEFAULT_PAGE_SIZE,
          total: videos.length,
          totalPages: videos.length > 0 ? 1 : 0
        }
      }));
      setters.setSelectedVideoIdByType((prev) => ({
        ...prev,
        tv: videos.some((video) => video.id === prev.tv) ? prev.tv : videos.length > 0 ? videos[0].id : ""
      }));
      return videos;
    } catch (error) {
      reportRequestError("error.loadTvEpisodes", error);
      return [];
    } finally {
      if (normalizeForCompare(refs.pendingTvEpisodesPathRef.current) === normalizeForCompare(directory)) {
        refs.pendingTvEpisodesPathRef.current = "";
      }
      endLoading();
      endLoadChannel("tvEpisodes");
    }
  }

  async function requestTvVideosForPath(seriesPath: string, options: { force?: boolean } = {}) {
    const directory = seriesPath.trim();
    if (!directory) {
      setters.setTvVideosRequestedPath("");
      return [];
    }

    setters.setTvVideosRequestedPath(directory);

    const targetNorm = normalizeForCompare(directory);
    const loadedNorm = normalizeForCompare(state.tvEpisodesPath);
    if (!options.force && targetNorm && targetNorm === loadedNorm) {
      return state.tvEpisodes;
    }

    const pendingRequest = refs.pendingTvEpisodesRequestRef.current;
    if (pendingRequest && normalizeForCompare(pendingRequest.path) === targetNorm) {
      return pendingRequest.promise;
    }

    const promise = loadTvEpisodesForSeries(directory).finally(() => {
      const current = refs.pendingTvEpisodesRequestRef.current;
      if (current && normalizeForCompare(current.path) === targetNorm) {
        refs.pendingTvEpisodesRequestRef.current = null;
      }
    });
    refs.pendingTvEpisodesRequestRef.current = { path: directory, promise };
    return promise;
  }

  function shouldRefreshTvVideosForPath(seriesPath: string) {
    const targetNorm = normalizeForCompare(seriesPath);
    if (!targetNorm) {
      return false;
    }

    const requestedNorm = normalizeForCompare(state.tvVideosRequestedPath);
    const loadedNorm = normalizeForCompare(state.tvEpisodesPath);
    return targetNorm === requestedNorm || targetNorm === loadedNorm;
  }

  async function refreshTvVideosForPath(seriesPath: string) {
    const directory = seriesPath.trim();
    if (!directory || !shouldRefreshTvVideosForPath(directory)) {
      return [];
    }

    return requestTvVideosForPath(directory, { force: true });
  }

  async function loadScanStatus() {
    try {
      const payload = await requestPayload<unknown>("/api/scan/status");
      setters.setScanStatus(normalizeScanStatus(payload));
    } catch (error) {
      reportRequestError("error.loadScanStatus", error);
    }
  }

  async function loadDirectoryScanResult() {
    try {
      const payload = await requestPayload<unknown>("/api/scan/directories");
      const parsed = normalizeDirectoryScanResult(payload);
      setters.setDirectoryScan(parsed);

      const defaultDir = pickDefaultTvDirectory(parsed);
      if (defaultDir) {
        setters.setSelectedTvDirPath(defaultDir);
      }
      return defaultDir;
    } catch (error) {
      reportRequestError("error.loadDirectoryScan", error);
      return "";
    }
  }

  async function loadLogs() {
    beginLoadChannel("logs");
    try {
      const payload = await requestPayload<unknown>("/api/logs?limit=50");
      setters.setLogs(normalizeLogs(payload));
    } catch (error) {
      reportRequestError("error.loadLogs", error);
    } finally {
      endLoadChannel("logs");
    }
  }

  async function switchTab(tab: ActiveTab) {
    setters.setPending((prev) => ({ ...prev, tabSwitch: true }));
    setters.setActiveTab(tab);

    try {
      if (tab === "dashboard") {
        await Promise.all([loadScanStatus(), loadDirectoryScanResult(), loadLogs()]);
        setters.setLoadedTabs((prev) => ({ ...prev, dashboard: true }));
        return;
      }

      if (tab === "logs") {
        await loadLogs();
        setters.setLoadedTabs((prev) => ({ ...prev, logs: true }));
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
        loadMovieVideos({ page: 1 }),
        loadTvSeriesPage({ page: 1 }),
        refreshTvVideosForPath(selectors.selectedTvSeries?.path || state.selectedTvDirPath || state.tvEpisodesPath || targetDir),
        loadLogs()
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
    setters.setPending((prev) => ({ ...prev, refreshTab: state.activeTab }));
    try {
      if (state.activeTab === "dashboard") {
        await Promise.all([loadScanStatus(), loadDirectoryScanResult(), loadLogs()]);
        setTranslatedMessage("status.dashboardRefreshed");
        notifySuccess(t("toast.dashboardRefreshedTitle"), t("toast.dashboardRefreshedMessage"));
        return;
      }

      if (state.activeTab === "logs") {
        await loadLogs();
        setTranslatedMessage("status.logsRefreshed");
        notifySuccess(t("toast.logsRefreshedTitle"), t("toast.logsRefreshedMessage"));
        return;
      }

      if (state.activeTab === "tv") {
        const targetDir = selectors.selectedTvSeries?.path || state.selectedTvDirPath || selectors.tvRootPath || state.directoryScan.tvRoot || "";
        const reloadEpisodes = shouldRefreshTvVideosForPath(targetDir);
        await Promise.all([loadTvSeriesPage({ page: state.tvSeriesPager.page || 1 }), refreshTvVideosForPath(targetDir)]);
        setTranslatedMessage("status.tvRefreshed");
        notifySuccess(
          t("toast.tvRefreshedTitle"),
          reloadEpisodes ? t("toast.tvRefreshedMessageAll") : t("toast.tvRefreshedMessageList")
        );
        return;
      }

      await loadMovieVideos({ page: selectors.moviePager.page || 1 });
      setTranslatedMessage("status.movieRefreshed");
      notifySuccess(t("toast.movieRefreshedTitle"), t("toast.movieRefreshedMessage"));
    } finally {
      setters.setPending((prev) => ({ ...prev, refreshTab: null }));
    }
  }

  async function loadMovieWorkspace() {
    await loadMovieVideos({ page: selectors.moviePager.page || 1 });
  }

  async function loadTvWorkspace(seriesPath = "") {
    const requestedPath = seriesPath.trim();
    const seriesRows = await loadTvSeriesPage({ page: state.tvSeriesPager.page || 1 });
    const selectedNorm = normalizeForCompare(requestedPath || selectors.selectedTvSeries?.path || state.selectedTvDirPath);
    const selectedPath = (
      seriesRows.find((item) => normalizeForCompare(item.path) === selectedNorm)?.path ||
      requestedPath ||
      seriesRows.find((item) => item.path)?.path ||
      selectors.selectedTvSeries?.path ||
      state.selectedTvDirPath ||
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
    if (nextPage < 1 || nextPage > totalPages) {
      return;
    }
    void loadMovieVideos({ page: nextPage });
  }

  function setTvPage(nextPage: number) {
    const totalPages = Math.max(1, selectors.tvPager.totalPages || 1);
    if (nextPage < 1 || nextPage > totalPages) {
      return;
    }
    void loadTvSeriesPage({ page: nextPage });
  }

  function toggleMovieYearSort() {
    setters.setMovieYearSortOrder((prev) => (prev === "desc" ? "asc" : "desc"));
  }

  function toggleTvSeriesYearSort() {
    setters.setTvSeriesYearSortOrder((prev) => (prev === "desc" ? "asc" : "desc"));
  }

  function selectMovieVideo(video: Video) {
    setters.setSelectedVideoIdByType((prev) => ({ ...prev, movie: video.id }));
  }

  function selectTvVideo(video: Video) {
    setters.setSelectedVideoIdByType((prev) => ({ ...prev, tv: video.id }));
  }

  function selectTvDirectory(path: string) {
    const nextNorm = normalizeForCompare(path);
    const currentNorm = normalizeForCompare(state.selectedTvDirPath);

    if (nextNorm === currentNorm) {
      setters.setSelectedTvSeason("all");
      return;
    }

    setters.setSelectedTvDirPath(path);
    setters.setSelectedTvSeason("all");
    setters.setSelectedVideoIdByType((prev) => (prev.tv ? { ...prev, tv: "" } : prev));
  }

  async function refreshAfterSubtitleMutation(video: Video) {
    if (video.mediaType === "tv") {
      const targetDir =
        selectors.selectedTvSeries?.path ||
        state.selectedTvDirPath ||
        video.directory ||
        state.tvEpisodesPath ||
        selectors.tvRootPath ||
        state.directoryScan.tvRoot;
      await Promise.all([loadTvSeriesPage({ page: state.tvSeriesPager.page || 1 }), refreshTvVideosForPath(targetDir || ""), loadLogs()]);
      return;
    }

    await Promise.all([loadMovieVideos({ page: selectors.moviePager.page || 1 }), loadLogs()]);
  }

  async function uploadSubtitle(video: Video, file: File, label: string) {
    const body = new FormData();
    body.append("file", file);
    body.append("label", label || "");

    setSubtitleActionPending({
      kind: "upload",
      videoId: video.id
    });
    beginUpload("status.uploadingSubtitleFile");
    try {
      await requestPayload(`/api/videos/${video.id}/subtitles`, { method: "POST", body });
      await refreshAfterSubtitleMutation(video);
      setTranslatedMessage("status.uploadedSubtitleFor", { title: video.title || video.fileName });
      notifySuccess(t("toast.subtitleUploadedTitle"), video.title || video.fileName, file.name);
      return true;
    } catch (error) {
      reportRequestError("error.uploadFailed", error);
      return false;
    } finally {
      endUpload();
      setSubtitleActionPending(null);
    }
  }

  async function replaceSubtitle(video: Video, subtitle: Subtitle, file: File) {
    const body = new FormData();
    body.append("file", file);
    body.append("replaceId", subtitle.id);

    setSubtitleActionPending({
      kind: "replace",
      videoId: video.id,
      subtitleId: subtitle.id,
      subtitleFileName: subtitle.fileName
    });
    beginUpload("status.uploadingSubtitleFile");
    try {
      await requestPayload(`/api/videos/${video.id}/subtitles`, { method: "POST", body });
      await refreshAfterSubtitleMutation(video);
      setTranslatedMessage("status.replacedSubtitle", { name: subtitle.fileName });
      notifySuccess(t("toast.subtitleReplacedTitle"), subtitle.fileName, file.name);
      return true;
    } catch (error) {
      reportRequestError("error.replaceFailed", error);
      return false;
    } finally {
      endUpload();
      setSubtitleActionPending(null);
    }
  }

  async function removeSubtitle(video: Video, subtitle: Subtitle) {
    setSubtitleActionPending({
      kind: "delete",
      videoId: video.id,
      subtitleId: subtitle.id,
      subtitleFileName: subtitle.fileName
    });
    try {
      await requestPayload(`/api/videos/${video.id}/subtitles/${subtitle.id}`, { method: "DELETE" });
      await refreshAfterSubtitleMutation(video);
      setTranslatedMessage("status.deletedSubtitle", { name: subtitle.fileName });
      notifySuccess(t("toast.subtitleDeletedTitle"), subtitle.fileName, video.title || video.fileName);
      return true;
    } catch (error) {
      reportRequestError("error.deleteFailed", error);
      return false;
    } finally {
      setSubtitleActionPending(null);
    }
  }

  async function previewSubtitle(video: Video, subtitle: Subtitle) {
    try {
      return await requestBinary(`/api/videos/${video.id}/subtitles/${subtitle.id}/content`);
    } catch (error) {
      reportRequestError("error.previewFailed", error);
      throw error;
    }
  }

  async function loadTvBatchCandidates() {
    const targetDir = (
      selectors.selectedTvSeries?.path ||
      state.selectedTvDirPath ||
      state.tvEpisodesPath ||
      selectors.tvRootPath ||
      state.directoryScan.tvRoot ||
      ""
    ).trim();

    if (!targetDir) {
      setTranslatedMessage("status.tvBatchNeedsSeries");
      notifyInfo(t("toast.selectTvSeriesTitle"), t("toast.selectTvSeriesMessage"));
      return [];
    }

    return requestTvVideosForPath(targetDir);
  }

  async function uploadBatchSubtitles(items: BatchSubtitleUploadItem[]): Promise<BatchSubtitleUploadResult> {
    if (items.length === 0) {
      return { total: 0, success: 0, failed: 0, errors: [] };
    }

    setSubtitleActionPending({
      kind: "batch",
      videoId: items[0]?.video.id || ""
    });
    beginLoading();
    beginUpload("status.uploadingSubtitleFilesProgress", { current: 0, total: items.length });
    const errors: string[] = [];
    let success = 0;

    try {
      for (const [index, item] of items.entries()) {
        updateUploadMessage("status.uploadingSubtitleFilesProgress", { current: index + 1, total: items.length });
        const body = new FormData();
        body.append("file", item.file);
        body.append("label", item.label || "");

        try {
          await requestPayload(`/api/videos/${item.video.id}/subtitles`, { method: "POST", body });
          success += 1;
        } catch (error) {
          const errorText = error instanceof Error ? error.message : String(error);
          const source = item.sourceName || item.file.name;
          errors.push(`${source} -> ${item.video.fileName}: ${errorText}`);
        }
      }
    } finally {
      try {
        await Promise.all([
          loadTvSeriesPage({ page: state.tvSeriesPager.page || 1 }),
          refreshTvVideosForPath(
            selectors.selectedTvSeries?.path ||
              state.selectedTvDirPath ||
              state.tvEpisodesPath ||
              selectors.tvRootPath ||
              state.directoryScan.tvRoot ||
              ""
          ),
          loadLogs()
        ]);
      } catch (error) {
        const errorText = error instanceof Error ? error.message : String(error);
        errors.push(`refresh after batch upload failed: ${errorText}`);
      }
      endUpload();
      endLoading();
    }

    const total = items.length;
    const failed = total - success;
    if (failed > 0) {
      setTranslatedMessage("status.batchFinishedWarnings", { success, total, failed });
      notifyInfo(
        t("toast.batchWarningsTitle"),
        t("toast.batchWarningsMessage", { success, total }),
        t("toast.batchWarningsDetail", { failed })
      );
    } else {
      setTranslatedMessage("status.batchFinishedSuccess", { success, total });
      notifySuccess(t("toast.batchSuccessTitle"), t("toast.batchSuccessMessage", { success, total }));
    }
    setSubtitleActionPending(null);

    return {
      total,
      success,
      failed,
      errors
    };
  }

  function setMovieQuery(value: string) {
    setters.setQueryByType((prev) => ({ ...prev, movie: value }));
  }

  function setTvQuery(value: string) {
    setters.setQueryByType((prev) => ({ ...prev, tv: value }));
  }

  function setSelectedTvSeason(value: string) {
    setters.setSelectedTvSeason(value);
  }

  return {
    finishBootstrapping,
    loadScanStatus,
    loadDirectoryScanResult,
    loadLogs,
    loadMovieVideos,
    loadTvSeriesPage,
    refreshTvVideosForPath,
    switchTab,
    triggerScan,
    refreshActiveTab,
    loadMovieWorkspace,
    loadTvWorkspace,
    selectMovieVideo,
    selectTvVideo,
    selectTvDirectory,
    setMoviePage,
    setTvPage,
    toggleMovieYearSort,
    toggleTvSeriesYearSort,
    uploadSubtitle,
    replaceSubtitle,
    removeSubtitle,
    previewSubtitle,
    loadTvBatchCandidates,
    uploadBatchSubtitles,
    setMovieQuery,
    setTvQuery,
    setSelectedTvSeason
  };
}
