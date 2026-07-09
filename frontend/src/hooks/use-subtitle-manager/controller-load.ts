import type { VersionInfo, Video } from "@/lib/types";
import { requestPayload } from "@/lib/subtitle-manager/api-client";
import {
  normalizeDirectoryScanResult,
  normalizeLogsPage,
  normalizePagedVideosResponse,
  normalizeScanStatus,
  normalizeTvSeriesPage
} from "@/lib/subtitle-manager/normalizers";
import { normalizeForCompare, pickDefaultTvDirectory } from "@/lib/subtitle-manager/tv-tree";

import { DEFAULT_LOG_PAGE_SIZE, DEFAULT_PAGE_SIZE } from "./state";
import { buildRequestSignature, type ControllerRuntime } from "./controller-runtime";

export function createLoadActions(runtime: ControllerRuntime) {
  const {
    state,
    setters,
    refs,
    beginLoadChannel,
    endLoadChannel,
    beginLoading,
    endLoading,
    reportRequestError
  } = runtime;

  async function loadMovieVideos(options: { page?: number; force?: boolean } = {}) {
    const page = options.page || state.paginationByType.movie.page || 1;
    const pageSize = state.paginationByType.movie.pageSize || DEFAULT_PAGE_SIZE;
    const query = state.queryByType.movie || "";
    const signature = buildRequestSignature(["movie", page, pageSize, state.movieYearSortOrder, query.trim()]);

    if (!options.force && refs.loadedMovieListSignatureRef.current === signature) {
      return;
    }

    const pendingRequest = refs.pendingMovieListRequestRef.current;
    if (pendingRequest && pendingRequest.signature === signature) {
      return pendingRequest.promise;
    }

    refs.requestedMovieListSignatureRef.current = signature;

    const promise = (async () => {
      beginLoadChannel("movieList");
      beginLoading();
      try {
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
        if (refs.requestedMovieListSignatureRef.current !== signature) {
          return;
        }

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
        refs.loadedMovieListSignatureRef.current = signature;
      } catch (error) {
        if (refs.requestedMovieListSignatureRef.current === signature) {
          reportRequestError("error.loadMovieVideos", error);
        }
      } finally {
        if (refs.pendingMovieListRequestRef.current?.signature === signature) {
          refs.pendingMovieListRequestRef.current = null;
        }
        endLoading();
        endLoadChannel("movieList");
      }
    })();

    refs.pendingMovieListRequestRef.current = { signature, promise };
    return promise;
  }

  async function loadVersionInfo() {
    try {
      const payload = await requestPayload<VersionInfo>("/api/version");
      setters.setVersionInfo(payload);
    } catch (error) {
      reportRequestError("error.loadVersionInfo", error);
    }
  }

  async function loadTvSeriesPage(options: { page?: number; force?: boolean } = {}) {
    const page = options.page || state.tvSeriesPager.page || 1;
    const pageSize = state.tvSeriesPager.pageSize || DEFAULT_PAGE_SIZE;
    const query = state.queryByType.tv || "";
    const signature = buildRequestSignature(["tv-series", page, pageSize, state.tvSeriesYearSortOrder, query.trim()]);

    if (!options.force && refs.loadedTvSeriesSignatureRef.current === signature) {
      return state.tvSeriesRows;
    }

    const pendingRequest = refs.pendingTvSeriesRequestRef.current;
    if (pendingRequest && pendingRequest.signature === signature) {
      return pendingRequest.promise;
    }

    refs.requestedTvSeriesSignatureRef.current = signature;

    const promise = (async () => {
      beginLoadChannel("tvSeriesList");
      beginLoading();
      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("pageSize", String(pageSize));
        params.set("sortYear", "year");
        params.set("sortOrder", state.tvSeriesYearSortOrder);
        if (query.trim()) {
          params.set("q", query.trim());
        }

        const payload = await requestPayload<unknown>(`/api/tv/series?${params.toString()}`);
        if (refs.requestedTvSeriesSignatureRef.current !== signature) {
          return [];
        }

        const pageData = normalizeTvSeriesPage(payload, page, pageSize);
        setters.setTvSeriesRows(pageData.items);
        setters.setTvSeriesPager({
          page: pageData.page,
          pageSize: pageData.pageSize,
          total: pageData.total,
          totalPages: pageData.totalPages
        });
        refs.loadedTvSeriesSignatureRef.current = signature;
        return pageData.items;
      } catch (error) {
        if (refs.requestedTvSeriesSignatureRef.current === signature) {
          reportRequestError("error.loadTvSeries", error);
        }
        return [];
      } finally {
        if (refs.pendingTvSeriesRequestRef.current?.signature === signature) {
          refs.pendingTvSeriesRequestRef.current = null;
        }
        endLoading();
        endLoadChannel("tvSeriesList");
      }
    })();

    refs.pendingTvSeriesRequestRef.current = { signature, promise };
    return promise;
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

  async function loadLogs(options: { page?: number } = {}) {
    const page = options.page || state.logsPager.page || 1;
    const pageSize = state.logsPager.pageSize || DEFAULT_LOG_PAGE_SIZE;

    beginLoadChannel("logs");
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));

      const payload = await requestPayload<unknown>(`/api/logs?${params.toString()}`);
      const pageData = normalizeLogsPage(payload, page, pageSize);
      setters.setLogs(pageData.items);
      setters.setLogsPager({
        page: pageData.page,
        pageSize: pageData.pageSize,
        total: pageData.total,
        totalPages: pageData.totalPages
      });
    } catch (error) {
      reportRequestError("error.loadLogs", error);
    } finally {
      endLoadChannel("logs");
    }
  }

  return {
    loadMovieVideos,
    loadVersionInfo,
    loadTvSeriesPage,
    listAllTvVideos,
    loadTvEpisodesForSeries,
    requestTvVideosForPath,
    shouldRefreshTvVideosForPath,
    refreshTvVideosForPath,
    loadScanStatus,
    loadDirectoryScanResult,
    loadLogs
  };
}

export type LoadActions = ReturnType<typeof createLoadActions>;
