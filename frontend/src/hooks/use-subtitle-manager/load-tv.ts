import type { Video } from "@/lib/types";
import { requestPayload } from "@/lib/subtitle-manager/api-client";
import { normalizePagedVideosResponse, normalizeTvSeriesPage } from "@/lib/subtitle-manager/normalizers";
import { normalizeForCompare } from "@/lib/subtitle-manager/path-utils";

import { DEFAULT_PAGE_SIZE } from "./state";
import { buildRequestSignature, type ControllerRuntime } from "./controller-runtime";
import { createLatestLoad, loaded } from "./latest-load";

export function createTvLoadActions(runtime: ControllerRuntime) {
  const { setters, beginLoadChannel, endLoadChannel, reportRequestError } = runtime;

  const seriesRequests = createLatestLoad<ReturnType<typeof normalizeTvSeriesPage>>();
  const episodeRequests = createLatestLoad<Video[]>();

  async function loadTvSeriesPage(options: { page?: number; pageSize?: number; force?: boolean; quiet?: boolean } = {}) {
    const state = runtime.state;
    const page = options.page || state.tvSeriesPager.page || 1;
    const pageSize = options.pageSize || state.tvSeriesPager.pageSize || DEFAULT_PAGE_SIZE;
    const query = state.queryByType.tv || "";
    const signature = buildRequestSignature(["tv-series", page, pageSize, state.tvSeriesSortBy, state.tvSeriesSortOrder, query.trim()]);
    const quiet = Boolean(options.quiet) && state.tvSeriesRows.length > 0;

    return seriesRequests.run({
      key: signature,
      force: options.force,
      cached: () => ({ items: runtime.state.tvSeriesRows, ...runtime.state.tvSeriesPager }),
      onStart: () => { if (!quiet) beginLoadChannel("tvSeriesList"); },
      onEnd: () => { if (!quiet) endLoadChannel("tvSeriesList"); },
      onError: (error) => reportRequestError("error.loadTvSeries", error),
      fetch: async (signal) => {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("pageSize", String(pageSize));
        params.set("sortBy", state.tvSeriesSortBy);
        params.set("sortOrder", state.tvSeriesSortOrder);
        if (query.trim()) {
          params.set("q", query.trim());
        }

        const payload = await requestPayload<unknown>(`/api/tv/series?${params.toString()}`, { signal });
        return normalizeTvSeriesPage(payload, page, pageSize);
      },
      commit: (pageData) => {
        setters.setTvSeriesRows(pageData.items);
        setters.setTvSeriesPager({
          page: pageData.page,
          pageSize: pageData.pageSize,
          total: pageData.total,
          totalPages: pageData.totalPages
        });
      }
    });
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

  async function requestTvVideosForPath(seriesPath: string, options: { force?: boolean } = {}) {
    const directory = seriesPath.trim();
    setters.setTvVideosRequestedPath(directory);
    if (!directory) {
      episodeRequests.invalidate();
      setters.setTvEpisodes([]);
      setters.setTvEpisodesPath("");
      setters.setSelectedVideoIdByType((prev) => ({ ...prev, tv: "" }));
      return loaded<Video[]>([]);
    }

    return episodeRequests.run({
      key: normalizeForCompare(directory),
      force: options.force,
      cached: () => runtime.state.tvEpisodes,
      onStart: () => beginLoadChannel("tvEpisodes"),
      onEnd: () => endLoadChannel("tvEpisodes"),
      onError: (error) => reportRequestError("error.loadTvEpisodes", error),
      fetch: (signal) => listAllTvVideos(directory, signal),
      commit: (videos) => {
        setters.setTvEpisodes(videos);
        setters.setTvEpisodesPath(directory);
        setters.setSelectedVideoIdByType((prev) => ({
          ...prev,
          tv: videos.some((video) => video.id === prev.tv) ? prev.tv : videos[0]?.id || ""
        }));
      }
    });
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
      return loaded<Video[]>([]);
    }

    return requestTvVideosForPath(directory, { force: true });
  }

  return {
    loadTvSeriesPage,
    listAllTvVideos,
    requestTvVideosForPath,
    shouldRefreshTvVideosForPath,
    refreshTvVideosForPath,
    cancelTvLoads: () => { seriesRequests.invalidate(); episodeRequests.invalidate(); }
  };
}
