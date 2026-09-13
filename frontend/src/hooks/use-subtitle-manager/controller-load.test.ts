import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { TranslateFn } from "@/lib/i18n";
import type { ActiveTab } from "@/lib/types";
import { createLoadActions } from "./controller-load";
import { createControllerRuntime } from "./controller-runtime";
import { createWorkspaceActions } from "./controller-workspace";
import { createInitialState, createStateSetters, reducer } from "./state";
import type { SubtitleManagerSelectors, SubtitleManagerStateApi } from "./types";

function harness() {
  let state = createInitialState();
  const setters = createStateSetters((action) => { state = reducer(state, action); });
  const stateApi: SubtitleManagerStateApi = {
    get state() { return state; },
    getState: () => state,
    setters,
    refs: {
      pendingUploadsRef: { current: 0 },
      pendingLoadChannelsRef: { current: { movieList: 0, tvSeriesList: 0, tvEpisodes: 0, logs: 0 } },
      logsDialogOpenRef: { current: false }
    }
  };
  const selectors = (): SubtitleManagerSelectors => ({
    movieVideos: state.movieVideos, moviePager: state.moviePager, tvPager: state.tvSeriesPager,
    tvRootPath: "/tv", selectedTvSeries: null, selectedTvSeriesVideos: state.tvEpisodes,
    tvSeasonOptions: [], sortedTvVideos: state.tvEpisodes, selectedMovie: null, selectedTvVideo: null,
    showTvScanPrompt: false
  });
  const runtime = createControllerRuntime({ stateApi, getState: () => state, getSelectors: selectors, getT: () => ((key) => key) as TranslateFn });
  const errors: unknown[] = [];
  const successes: string[] = [];
  runtime.reportRequestError = (_prefix, error) => { errors.push(error); };
  runtime.notifySuccess = (message) => { successes.push(message); };
  const load = createLoadActions(runtime);
  const workspace = createWorkspaceActions(runtime, load);
  return { get state() { return state; }, setters, load, workspace, errors, successes };
}

interface PendingFetch {
  url: string;
  method: string;
  signal: AbortSignal | null | undefined;
  reply: (body: unknown, status?: number) => void;
}
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
function deferredFetch() {
  const requests: PendingFetch[] = [];
  const mockFetch = (input: RequestInfo | URL, options?: RequestInit) => new Promise<Response>((resolve) => {
    // Deliberately deliver even after abort, to exercise commit guards as well as cancellation.
    requests.push({
      url: String(input), method: options?.method || "GET", signal: options?.signal,
      reply: (body, status = 200) => resolve(Response.json(body, { status }))
    });
  });
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(Object.assign(mockFetch, { preconnect: globalThis.fetch.preconnect }));
  return requests;
}
afterEach(() => { fetchSpy?.mockRestore(); });
const page = (id: string, number = 1) => ({ items: [{ id, key: id, path: `/tv/${id}` }], page: number, pageSize: 30, total: 90, totalPages: 3 });

describe("library request ordering", () => {
  for (const domain of ["movie", "tv"] as const) {
    test(`${domain}: A -> B -> cached A cancels B without committing its response`, async () => {
      const h = harness();
      const requests = deferredFetch();
      const load = domain === "movie" ? h.load.loadMovieVideos : h.load.loadTvSeriesPage;
      const setQuery = (query: string) => h.setters.setQueryByType((prev) => ({ ...prev, [domain]: query }));

      setQuery("A");
      const first = load(); requests[0].reply(page("A")); await first;
      setQuery("B"); const stale = load();
      setQuery("A"); expect((await load()).status).toBe("success");
      expect(requests).toHaveLength(2);
      expect(requests[1].signal?.aborted).toBe(true);
      requests[1].reply(page("B"));
      expect((await stale).status).toBe("cancelled");
      expect(domain === "movie" ? h.state.movieVideos[0].id : h.state.tvSeriesRows[0].key).toBe("A");
      expect(h.errors).toHaveLength(0);
    });

    test(`${domain}: duplicate loads coalesce, forced loads replace in-flight requests`, async () => {
      const h = harness(); const requests = deferredFetch();
      const load = domain === "movie" ? h.load.loadMovieVideos : h.load.loadTvSeriesPage;
      const first = load(); const duplicate = load();
      expect(requests).toHaveLength(1);
      const forced = load({ force: true });
      expect(requests).toHaveLength(2);
      expect(requests[0].signal?.aborted).toBe(true);
      requests[0].reply(page("old")); await first; await duplicate;
      expect(domain === "movie" ? h.state.pending.movieList : h.state.pending.tvSeriesList).toBe(true);
      const joinNew = load();
      expect(requests).toHaveLength(2);
      requests[1].reply(page("new"));
      expect((await forced).status).toBe("success"); await joinNew;
      expect(domain === "movie" ? h.state.pending.movieList : h.state.pending.tvSeriesList).toBe(false);
    });

    test(`${domain}: newest page wins when responses arrive out of order`, async () => {
      const h = harness(); const requests = deferredFetch();
      const load = domain === "movie" ? h.load.loadMovieVideos : h.load.loadTvSeriesPage;
      const first = load({ page: 1 }); const second = load({ page: 2 });
      requests[1].reply(page("new", 2)); await second;
      requests[0].reply(page("old", 1)); await first;
      expect(domain === "movie" ? h.state.moviePager.page : h.state.tvSeriesPager.page).toBe(2);
    });
  }

  test("episodes: returning to cached series cancels the other series", async () => {
    const h = harness(); const requests = deferredFetch();
    const first = h.load.requestTvVideosForPath("/tv/A");
    requests[0].reply({ ...page("A"), totalPages: 1 }); await first;
    const stale = h.load.requestTvVideosForPath("/tv/B");
    await h.load.requestTvVideosForPath("/tv/A");
    expect(requests[1].signal?.aborted).toBe(true);
    requests[1].reply({ ...page("B"), totalPages: 1 }); await stale;
    expect(h.state.tvEpisodesPath).toBe("/tv/A");
    expect(h.state.tvEpisodes[0].id).toBe("A");
  });

  test("failed force refresh invalidates the old cache and allows retry", async () => {
    const h = harness(); const requests = deferredFetch();
    const first = h.load.loadMovieVideos(); requests[0].reply(page("old")); await first;
    const forced = h.load.loadMovieVideos({ force: true }); requests[1].reply({ error: "offline" }, 503);
    expect((await forced).status).toBe("failed");
    const retry = h.load.loadMovieVideos(); expect(requests).toHaveLength(3);
    requests[2].reply(page("new")); await retry;
    expect(h.state.movieVideos[0].id).toBe("new");
  });

  test("cleanup cancels loads and ignores responses delivered after disposal", async () => {
    const h = harness(); const requests = deferredFetch();
    const tasks = [h.load.loadMovieVideos(), h.load.loadTvSeriesPage(), h.load.loadLogs()];
    h.load.cancelMovieLoads(); h.load.cancelTvLoads(); h.load.cancelMiscLoads();
    for (const request of requests) { expect(request.signal?.aborted).toBe(true); request.reply(page("stale")); }
    expect((await Promise.all(tasks)).every((result) => result.status === "cancelled")).toBe(true);
    expect(h.state.movieVideos).toEqual([]); expect(h.state.tvSeriesRows).toEqual([]); expect(h.state.logs).toEqual([]);
  });
});

describe("logs and refresh outcomes", () => {
  test("logs: late page cannot replace a newer page", async () => {
    const h = harness(); const requests = deferredFetch();
    const first = h.load.loadLogs({ page: 1 }); const second = h.load.loadLogs({ page: 2 });
    requests[1].reply(page("new", 2)); await second;
    requests[0].reply(page("old", 1)); await first;
    expect(h.state.logsPager.page).toBe(2); expect(h.state.logs[0].id).toBe("new");
    expect(h.state.pending.logs).toBe(false);
  });

  for (const deleteSucceeds of [true, false]) {
    test(`logs: DELETE ${deleteSucceeds ? "success" : "failure"} blocks in-flight loads and permits subsequent refresh`, async () => {
      const h = harness(); const requests = deferredFetch();
      const initial = h.load.loadLogs(); requests[0].reply(page("existing")); await initial;
      const stale = h.load.loadLogs(); const clear = h.workspace.clearLogs();
      expect(requests[1].signal?.aborted).toBe(true);
      expect((await h.load.loadLogs()).status).toBe("cancelled");
      expect(requests).toHaveLength(3); expect(requests[2].method).toBe("DELETE");
      requests[2].reply(deleteSucceeds ? {} : { error: "offline" }, deleteSucceeds ? 200 : 503);
      expect(await clear).toBe(deleteSucceeds);
      requests[1].reply(page("stale")); await stale;
      expect(h.state.logs.map((log) => log.id)).toEqual(deleteSucceeds ? [] : ["existing"]);
      const refreshed = h.load.loadLogs(); requests[3].reply(page("fresh")); await refreshed;
      expect(h.state.logs[0].id).toBe("fresh"); expect(h.state.pending.logs).toBe(false);
    });
  }

  for (const tab of ["movie", "tv", "dashboard"] satisfies ActiveTab[]) {
    for (const ok of [true, false]) {
      test(`${tab} refresh ${ok ? "reports success" : "does not report success on failure"}`, async () => {
        const h = harness(); const requests = deferredFetch(); h.setters.setActiveTab(tab);
        const refresh = h.workspace.refreshActiveTab();
        requests.forEach((request, index) => request.reply(ok || index > 0 ? page("fresh") : { error: "offline" }, ok || index > 0 ? 200 : 503));
        await refresh;
        expect(h.successes).toHaveLength(ok ? 1 : 0); expect(h.errors).toHaveLength(ok ? 0 : 1);
        expect(h.state.pending.refreshTab).toBeNull();
      });
    }
  }

  test("a superseded refresh stays silent while its replacement reports success", async () => {
    const h = harness(); const requests = deferredFetch(); h.setters.setActiveTab("movie");
    const first = h.workspace.refreshActiveTab();
    const second = h.workspace.refreshActiveTab();
    requests[0].reply({ error: "obsolete failure" }, 503); await first;
    expect(h.errors).toHaveLength(0); expect(h.successes).toHaveLength(0);
    expect(h.state.pending.refreshTab).toBe("movie");
    requests[1].reply(page("fresh")); await second;
    expect(h.successes).toHaveLength(1);
  });

  test("loads can restart after effect cleanup while the cancelled response is still pending", async () => {
    const h = harness(); const requests = deferredFetch();
    const first = h.load.loadTvSeriesPage(); h.load.cancelTvLoads();
    const restarted = h.load.loadTvSeriesPage();
    requests[1].reply(page("fresh")); await restarted;
    requests[0].reply(page("stale")); await first;
    expect(h.state.tvSeriesRows[0].key).toBe("fresh");
    expect(h.state.pending.tvSeriesList).toBe(false);
  });

  test("TV refresh does not report success if episode loading fails", async () => {
    const h = harness(); const requests = deferredFetch();
    h.setters.setSelectedTvDirPath("/tv/A"); h.setters.setTvVideosRequestedPath("/tv/A");
    const refresh = h.workspace.refreshActiveTab();
    requests[0].reply(page("A")); requests[1].reply({ error: "offline" }, 503);
    await refresh; expect(h.successes).toHaveLength(0); expect(h.errors).toHaveLength(1);
  });
});
