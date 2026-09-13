import { requestPayload } from "@/lib/subtitle-manager/api-client";
import { normalizePagedVideosResponse } from "@/lib/subtitle-manager/normalizers";

import { DEFAULT_PAGE_SIZE } from "./state";
import { buildRequestSignature, type ControllerRuntime } from "./controller-runtime";
import { createLatestLoad } from "./latest-load";

export function createMovieLoadActions(runtime: ControllerRuntime) {
  const { setters, beginLoadChannel, endLoadChannel, reportRequestError } = runtime;

  const requests = createLatestLoad<ReturnType<typeof normalizePagedVideosResponse>>();

  async function loadMovieVideos(options: { page?: number; pageSize?: number; force?: boolean; quiet?: boolean } = {}) {
    const state = runtime.state;
    const page = options.page || state.moviePager.page || 1;
    const pageSize = options.pageSize || state.moviePager.pageSize || DEFAULT_PAGE_SIZE;
    const query = state.queryByType.movie || "";
    const signature = buildRequestSignature(["movie", page, pageSize, state.movieSortBy, state.movieSortOrder, query.trim()]);
    const quiet = Boolean(options.quiet) && state.movieVideos.length > 0;

    return requests.run({
      key: signature,
      force: options.force,
      cached: () => ({ items: runtime.state.movieVideos, ...runtime.state.moviePager }),
      onStart: () => { if (!quiet) beginLoadChannel("movieList"); },
      onEnd: () => { if (!quiet) endLoadChannel("movieList"); },
      onError: (error) => reportRequestError("error.loadMovieVideos", error),
      fetch: async (signal) => {
        const params = new URLSearchParams();
        params.set("mediaType", "movie");
        params.set("page", String(page));
        params.set("pageSize", String(pageSize));
        params.set("sortBy", state.movieSortBy);
        params.set("sortOrder", state.movieSortOrder);
        if (query.trim()) {
          params.set("q", query.trim());
        }

        const payload = await requestPayload<unknown>(`/api/videos?${params.toString()}`, { signal });
        return normalizePagedVideosResponse(payload, page, pageSize);
      },
      commit: (pageData) => {
        setters.setMovieVideos(pageData.items);
        setters.setMoviePager({
          page: pageData.page,
          pageSize: pageData.pageSize,
          total: pageData.total,
          totalPages: pageData.totalPages
        });
      }
    });
  }

  return { loadMovieVideos, cancelMovieLoads: requests.invalidate };
}
