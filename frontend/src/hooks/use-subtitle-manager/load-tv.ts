import type { Video } from "@/lib/types";
import { requestPayload } from "@/lib/subtitle-manager/api-client";
import { normalizePagedVideosResponse, normalizeTvSeriesPage } from "@/lib/subtitle-manager/normalizers";
import { normalizeForCompare } from "@/lib/subtitle-manager/tv-tree";

import { DEFAULT_PAGE_SIZE } from "./state";
import { buildRequestSignature, type ControllerRuntime } from "./controller-runtime";
import { isAbortError } from "./load-utils";

export function createTvLoadActions(runtime: ControllerRuntime) {
  const { setters, refs, beginLoadChannel, endLoadChannel, beginLoading, endLoading, reportRequestError } = runtime;

  async function loadTvSeriesPage(options: { page?: number; pageSize?: number; force?: boolean; quiet?: boolean } = {}) {
    const state = runtime.state;
    const page = options.page || state.tvSeriesPager.page || 1;
    const pageSize = options.pageSize || state.tvSeriesPager.pageSize || DEFAULT_PAGE_SIZE;
    const query = state.queryByType.tv || "";
    const signature = buildRequestSignature(["tv-series", page, pageSize, state.tvSeriesSortBy, state.tvSeriesSortOrder, query.trim()]);
    const quiet = Boolean(options.quiet) && state.tvSeriesRows.length > 0;

    if (!options.force && refs.loadedTvSeriesSignatureRef.current === signature) {
      return state.tvSeriesRows;
    }

    const pendingRequest = refs.pendingTvSeriesRequestRef.current;
    if (pendingRequest && pendingRequest.signature === signature) {
      return pendingRequest.promise;
    }

    if (pendingRequest) {
      pendingRequest.controller.abort();
    }

    refs.requestedTvSeriesSignatureRef.current = signature;
    const controller = new AbortController();

    const promise = (async () => {
      if (!quiet) {
        beginLoadChannel("tvSeriesList");
        beginLoading();
      }
      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("pageSize", String(pageSize));
        params.set("sortBy", state.tvSeriesSortBy);
        params.set("sortOrder", state.tvSeriesSortOrder);
        if (query.trim()) {
          params.set("q", query.trim());
        }

        const payload = await requestPayload<unknown>(`/api/tv/series?${params.toString()}`, { signal: controller.signal });
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
        if (isAbortError(error)) {
          return [];
        }
        if (refs.requestedTvSeriesSignatureRef.current === signature) {
          reportRequestError("error.loadTvSeries", error);
        }
        return [];
      } finally {
        if (refs.pendingTvSeriesRequestRef.current?.signature === signature) {
          refs.pendingTvSeriesRequestRef.current = null;
        }
        if (!quiet) {
          endLoading();
          endLoadChannel("tvSeriesList");
        }
      }
    })();

    refs.pendingTvSeriesRequestRef.current = { signature, promise, controller };
    return promise;
  }

  async function listAllTvVideos(directoryPath = "", signal?: AbortSignal) {
    const directory = directoryPath.trim();
    const videos: Video[] = [];
    let page = 1;
    let totalPages = 1;
    const pageSize = 200;

    while (page <= totalPages) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      const params = new URLSearchParams();
      params.set("mediaType", "tv");
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      if (directory) {
        params.set("dir", directory);
      }

      const payload = await requestPayload<unknown>(`/api/videos?${params.toString()}`, { signal });
      const pageData = normalizePagedVideosResponse(payload, page, pageSize);
      videos.push(...pageData.items);
      totalPages = Math.max(1, pageData.totalPages || 1);
      page += 1;
    }

    return videos;
  }

  async function loadTvEpisodesForSeries(seriesPath: string, signal?: AbortSignal) {
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
      const videos = await listAllTvVideos(directory, signal);
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      setters.setTvEpisodes(videos);
      setters.setTvEpisodesPath(directory);
      setters.setSelectedVideoIdByType((prev) => ({
        ...prev,
        tv: videos.some((video) => video.id === prev.tv) ? prev.tv : videos.length > 0 ? videos[0].id : ""
      }));
      return videos;
    } catch (error) {
      if (isAbortError(error)) {
        return [];
      }
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
    const state = runtime.state;
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

    if (pendingRequest) {
      pendingRequest.controller.abort();
    }

    const controller = new AbortController();
    const promise = loadTvEpisodesForSeries(directory, controller.signal).finally(() => {
      const current = refs.pendingTvEpisodesRequestRef.current;
      if (current && normalizeForCompare(current.path) === targetNorm) {
        refs.pendingTvEpisodesRequestRef.current = null;
      }
    });
    refs.pendingTvEpisodesRequestRef.current = { path: directory, promise, controller };
    return promise;
  }

  function shouldRefreshTvVideosForPath(seriesPath: string) {
    const state = runtime.state;
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

  return {
    loadTvSeriesPage,
    listAllTvVideos,
    loadTvEpisodesForSeries,
    requestTvVideosForPath,
    shouldRefreshTvVideosForPath,
    refreshTvVideosForPath
  };
}
