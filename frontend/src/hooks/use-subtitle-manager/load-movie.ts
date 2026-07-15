import { requestPayload } from "@/lib/subtitle-manager/api-client";
import { normalizePagedVideosResponse } from "@/lib/subtitle-manager/normalizers";

import { DEFAULT_PAGE_SIZE } from "./state";
import { buildRequestSignature, type ControllerRuntime } from "./controller-runtime";
import { isAbortError } from "./load-utils";

export function createMovieLoadActions(runtime: ControllerRuntime) {
  const { setters, refs, beginLoadChannel, endLoadChannel, beginLoading, endLoading, reportRequestError } = runtime;

  async function loadMovieVideos(options: { page?: number; pageSize?: number; force?: boolean; quiet?: boolean } = {}) {
    const state = runtime.state;
    const page = options.page || state.moviePager.page || 1;
    const pageSize = options.pageSize || state.moviePager.pageSize || DEFAULT_PAGE_SIZE;
    const query = state.queryByType.movie || "";
    const signature = buildRequestSignature(["movie", page, pageSize, state.movieSortBy, state.movieSortOrder, query.trim()]);
    const quiet = Boolean(options.quiet) && state.movieVideos.length > 0;

    if (!options.force && refs.loadedMovieListSignatureRef.current === signature) {
      return;
    }

    const pendingRequest = refs.pendingMovieListRequestRef.current;
    if (pendingRequest && pendingRequest.signature === signature) {
      return pendingRequest.promise;
    }

    if (pendingRequest) {
      pendingRequest.controller.abort();
    }

    refs.requestedMovieListSignatureRef.current = signature;
    const controller = new AbortController();

    const promise = (async () => {
      if (!quiet) {
        beginLoadChannel("movieList");
        beginLoading();
      }
      try {
        const params = new URLSearchParams();
        params.set("mediaType", "movie");
        params.set("page", String(page));
        params.set("pageSize", String(pageSize));
        params.set("sortBy", state.movieSortBy);
        params.set("sortOrder", state.movieSortOrder);
        if (query.trim()) {
          params.set("q", query.trim());
        }

        const payload = await requestPayload<unknown>(`/api/videos?${params.toString()}`, { signal: controller.signal });
        if (refs.requestedMovieListSignatureRef.current !== signature) {
          return;
        }

        const pageData = normalizePagedVideosResponse(payload, page, pageSize);
        setters.setMovieVideos(pageData.items);
        setters.setMoviePager({
          page: pageData.page,
          pageSize: pageData.pageSize,
          total: pageData.total,
          totalPages: pageData.totalPages
        });
        refs.loadedMovieListSignatureRef.current = signature;
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        if (refs.requestedMovieListSignatureRef.current === signature) {
          reportRequestError("error.loadMovieVideos", error);
        }
      } finally {
        if (refs.pendingMovieListRequestRef.current?.signature === signature) {
          refs.pendingMovieListRequestRef.current = null;
        }
        if (!quiet) {
          endLoading();
          endLoadChannel("movieList");
        }
      }
    })();

    refs.pendingMovieListRequestRef.current = { signature, promise, controller };
    return promise;
  }

  return { loadMovieVideos };
}
