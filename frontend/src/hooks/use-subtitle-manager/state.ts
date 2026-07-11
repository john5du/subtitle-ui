"use client";

import { useMemo, useReducer, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type {
  ActiveTab,
  DirectoryScanResult,
  MediaType,
  OperationLog,
  Pager,
  ScanStatus,
  TvSeriesSummary,
  UiPendingState,
  VersionInfo,
  Video
} from "@/lib/types";
import type { LocalizedText } from "@/lib/subtitle-manager/messages";

import type {
  LoadChannel,
  MovieSortBy,
  SortOrder,
  SubtitleManagerRefs,
  SubtitleManagerState,
  SubtitleManagerStateApi,
  TvSeriesSortBy
} from "./types";

export const DEFAULT_PAGE_SIZE = 30;
export const DEFAULT_LOG_PAGE_SIZE = 8;

const EMPTY_DIRECTORY_SCAN: DirectoryScanResult = {
  generatedAt: "",
  movieRoot: "",
  tvRoot: "",
  movieCount: 0,
  tvSeriesCount: 0,
  movie: [],
  tv: [],
  errors: []
};

const EMPTY_PENDING_STATE: UiPendingState = {
  bootstrapping: true,
  tabSwitch: false,
  scan: false,
  refreshTab: null,
  movieList: false,
  tvSeriesList: false,
  tvEpisodes: false,
  logs: false,
  subtitleAction: null
};

function createDefaultPager(pageSize = DEFAULT_PAGE_SIZE): Pager {
  return {
    page: 1,
    pageSize,
    total: 0,
    totalPages: 0
  };
}

function createInitialState(): SubtitleManagerState {
  return {
    activeTab: "tv",
    movieVideos: [],
    selectedVideoIdByType: { movie: "", tv: "" },
    tvEpisodes: [],
    tvEpisodesPath: "",
    tvVideosRequestedPath: "",
    selectedTvDirPath: "",
    selectedTvSeason: "",
    tvSeriesRows: [],
    tvSeriesPager: createDefaultPager(),
    queryByType: { movie: "", tv: "" },
    moviePager: createDefaultPager(),
    movieSortBy: "year",
    movieSortOrder: "desc",
    tvSeriesSortBy: "year",
    tvSeriesSortOrder: "desc",
    loading: false,
    pending: EMPTY_PENDING_STATE,
    uploading: false,
    uploadingMessageState: null,
    messageState: null,
    scanStatus: null,
    logs: [],
    logsPager: createDefaultPager(DEFAULT_LOG_PAGE_SIZE),
    directoryScan: EMPTY_DIRECTORY_SCAN,
    versionInfo: null,
    loadedTabs: {
      dashboard: false,
      movie: false,
      tv: false
    }
  };
}

type StateAction =
  | { type: "setActiveTab"; value: SetStateAction<ActiveTab> }
  | { type: "setMovieVideos"; value: SetStateAction<Video[]> }
  | { type: "patchMovieVideo"; video: Video }
  | { type: "setSelectedVideoIdByType"; value: SetStateAction<Record<MediaType, string>> }
  | { type: "setTvEpisodes"; value: SetStateAction<Video[]> }
  | { type: "patchTvEpisode"; video: Video }
  | { type: "setTvEpisodesPath"; value: SetStateAction<string> }
  | { type: "setTvVideosRequestedPath"; value: SetStateAction<string> }
  | { type: "setSelectedTvDirPath"; value: SetStateAction<string> }
  | { type: "setSelectedTvSeason"; value: SetStateAction<string> }
  | { type: "setTvSeriesRows"; value: SetStateAction<TvSeriesSummary[]> }
  | { type: "setTvSeriesPager"; value: SetStateAction<Pager> }
  | { type: "setQueryByType"; value: SetStateAction<Record<MediaType, string>> }
  | { type: "setMoviePager"; value: SetStateAction<Pager> }
  | { type: "setMovieSortBy"; value: SetStateAction<MovieSortBy> }
  | { type: "setMovieSortOrder"; value: SetStateAction<SortOrder> }
  | { type: "setTvSeriesSortBy"; value: SetStateAction<TvSeriesSortBy> }
  | { type: "setTvSeriesSortOrder"; value: SetStateAction<SortOrder> }
  | { type: "setLoading"; value: SetStateAction<boolean> }
  | { type: "setPending"; value: SetStateAction<UiPendingState> }
  | { type: "setUploading"; value: SetStateAction<boolean> }
  | { type: "setUploadingMessageState"; value: SetStateAction<LocalizedText> }
  | { type: "setMessageState"; value: SetStateAction<LocalizedText> }
  | { type: "setScanStatus"; value: SetStateAction<ScanStatus | null> }
  | { type: "setLogs"; value: SetStateAction<OperationLog[]> }
  | { type: "setLogsPager"; value: SetStateAction<Pager> }
  | { type: "setDirectoryScan"; value: SetStateAction<DirectoryScanResult> }
  | { type: "setVersionInfo"; value: SetStateAction<VersionInfo | null> }
  | { type: "setLoadedTabs"; value: SetStateAction<Record<ActiveTab, boolean>> };

function resolveUpdate<T>(prev: T, value: SetStateAction<T>): T {
  return typeof value === "function" ? (value as (previous: T) => T)(prev) : value;
}

function applyVideoPatch(list: Video[], video: Video) {
  const index = list.findIndex((item) => item.id === video.id);
  if (index < 0) {
    return list;
  }
  if (list[index] === video) {
    return list;
  }
  const next = list.slice();
  next[index] = video;
  return next;
}

function reducer(state: SubtitleManagerState, action: StateAction): SubtitleManagerState {
  switch (action.type) {
    case "setActiveTab": {
      const activeTab = resolveUpdate(state.activeTab, action.value);
      return activeTab === state.activeTab ? state : { ...state, activeTab };
    }
    case "setMovieVideos": {
      const movieVideos = resolveUpdate(state.movieVideos, action.value);
      return movieVideos === state.movieVideos ? state : { ...state, movieVideos };
    }
    case "patchMovieVideo": {
      const movieVideos = applyVideoPatch(state.movieVideos, action.video);
      return movieVideos === state.movieVideos ? state : { ...state, movieVideos };
    }
    case "setSelectedVideoIdByType": {
      const selectedVideoIdByType = resolveUpdate(state.selectedVideoIdByType, action.value);
      return selectedVideoIdByType === state.selectedVideoIdByType ? state : { ...state, selectedVideoIdByType };
    }
    case "setTvEpisodes": {
      const tvEpisodes = resolveUpdate(state.tvEpisodes, action.value);
      return tvEpisodes === state.tvEpisodes ? state : { ...state, tvEpisodes };
    }
    case "patchTvEpisode": {
      const tvEpisodes = applyVideoPatch(state.tvEpisodes, action.video);
      return tvEpisodes === state.tvEpisodes ? state : { ...state, tvEpisodes };
    }
    case "setTvEpisodesPath": {
      const tvEpisodesPath = resolveUpdate(state.tvEpisodesPath, action.value);
      return tvEpisodesPath === state.tvEpisodesPath ? state : { ...state, tvEpisodesPath };
    }
    case "setTvVideosRequestedPath": {
      const tvVideosRequestedPath = resolveUpdate(state.tvVideosRequestedPath, action.value);
      return tvVideosRequestedPath === state.tvVideosRequestedPath ? state : { ...state, tvVideosRequestedPath };
    }
    case "setSelectedTvDirPath": {
      const selectedTvDirPath = resolveUpdate(state.selectedTvDirPath, action.value);
      return selectedTvDirPath === state.selectedTvDirPath ? state : { ...state, selectedTvDirPath };
    }
    case "setSelectedTvSeason": {
      const selectedTvSeason = resolveUpdate(state.selectedTvSeason, action.value);
      return selectedTvSeason === state.selectedTvSeason ? state : { ...state, selectedTvSeason };
    }
    case "setTvSeriesRows": {
      const tvSeriesRows = resolveUpdate(state.tvSeriesRows, action.value);
      return tvSeriesRows === state.tvSeriesRows ? state : { ...state, tvSeriesRows };
    }
    case "setTvSeriesPager": {
      const tvSeriesPager = resolveUpdate(state.tvSeriesPager, action.value);
      return tvSeriesPager === state.tvSeriesPager ? state : { ...state, tvSeriesPager };
    }
    case "setQueryByType": {
      const queryByType = resolveUpdate(state.queryByType, action.value);
      return queryByType === state.queryByType ? state : { ...state, queryByType };
    }
    case "setMoviePager": {
      const moviePager = resolveUpdate(state.moviePager, action.value);
      return moviePager === state.moviePager ? state : { ...state, moviePager };
    }
    case "setMovieSortBy": {
      const movieSortBy = resolveUpdate(state.movieSortBy, action.value);
      return movieSortBy === state.movieSortBy ? state : { ...state, movieSortBy };
    }
    case "setMovieSortOrder": {
      const movieSortOrder = resolveUpdate(state.movieSortOrder, action.value);
      return movieSortOrder === state.movieSortOrder ? state : { ...state, movieSortOrder };
    }
    case "setTvSeriesSortBy": {
      const tvSeriesSortBy = resolveUpdate(state.tvSeriesSortBy, action.value);
      return tvSeriesSortBy === state.tvSeriesSortBy ? state : { ...state, tvSeriesSortBy };
    }
    case "setTvSeriesSortOrder": {
      const tvSeriesSortOrder = resolveUpdate(state.tvSeriesSortOrder, action.value);
      return tvSeriesSortOrder === state.tvSeriesSortOrder ? state : { ...state, tvSeriesSortOrder };
    }
    case "setLoading": {
      const loading = resolveUpdate(state.loading, action.value);
      return loading === state.loading ? state : { ...state, loading };
    }
    case "setPending": {
      const pending = resolveUpdate(state.pending, action.value);
      return pending === state.pending ? state : { ...state, pending };
    }
    case "setUploading": {
      const uploading = resolveUpdate(state.uploading, action.value);
      return uploading === state.uploading ? state : { ...state, uploading };
    }
    case "setUploadingMessageState": {
      const uploadingMessageState = resolveUpdate(state.uploadingMessageState, action.value);
      return uploadingMessageState === state.uploadingMessageState ? state : { ...state, uploadingMessageState };
    }
    case "setMessageState": {
      const messageState = resolveUpdate(state.messageState, action.value);
      return messageState === state.messageState ? state : { ...state, messageState };
    }
    case "setScanStatus": {
      const scanStatus = resolveUpdate(state.scanStatus, action.value);
      return scanStatus === state.scanStatus ? state : { ...state, scanStatus };
    }
    case "setLogs": {
      const logs = resolveUpdate(state.logs, action.value);
      return logs === state.logs ? state : { ...state, logs };
    }
    case "setLogsPager": {
      const logsPager = resolveUpdate(state.logsPager, action.value);
      return logsPager === state.logsPager ? state : { ...state, logsPager };
    }
    case "setDirectoryScan": {
      const directoryScan = resolveUpdate(state.directoryScan, action.value);
      return directoryScan === state.directoryScan ? state : { ...state, directoryScan };
    }
    case "setVersionInfo": {
      const versionInfo = resolveUpdate(state.versionInfo, action.value);
      return versionInfo === state.versionInfo ? state : { ...state, versionInfo };
    }
    case "setLoadedTabs": {
      const loadedTabs = resolveUpdate(state.loadedTabs, action.value);
      return loadedTabs === state.loadedTabs ? state : { ...state, loadedTabs };
    }
    default:
      return state;
  }
}

function createSetter<T>(dispatch: Dispatch<StateAction>, type: StateAction["type"]): Dispatch<SetStateAction<T>> {
  return (value) => {
    dispatch({ type, value } as StateAction);
  };
}

export function useSubtitleManagerState(): SubtitleManagerStateApi {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const pendingLoadsRef = useRef(0);
  const pendingUploadsRef = useRef(0);
  const pendingLoadChannelsRef = useRef<Record<LoadChannel, number>>({
    movieList: 0,
    tvSeriesList: 0,
    tvEpisodes: 0,
    logs: 0
  });
  const loadedMovieListSignatureRef = useRef("");
  const requestedMovieListSignatureRef = useRef("");
  const pendingMovieListRequestRef = useRef<{ signature: string; promise: Promise<void>; controller: AbortController } | null>(null);
  const pendingTvEpisodesPathRef = useRef("");
  const pendingTvEpisodesRequestRef = useRef<{ path: string; promise: Promise<Video[]>; controller: AbortController } | null>(null);
  const loadedTvSeriesSignatureRef = useRef("");
  const requestedTvSeriesSignatureRef = useRef("");
  const pendingTvSeriesRequestRef = useRef<{ signature: string; promise: Promise<TvSeriesSummary[]>; controller: AbortController } | null>(
    null
  );
  const skipMovieQueryRef = useRef(true);
  const skipTvQueryRef = useRef(true);
  const skipMovieSortRef = useRef(true);
  const skipTvSortRef = useRef(true);
  const logsDialogOpenRef = useRef(false);

  const refs = useMemo<SubtitleManagerRefs>(
    () => ({
      pendingLoadsRef,
      pendingUploadsRef,
      pendingLoadChannelsRef,
      loadedMovieListSignatureRef,
      requestedMovieListSignatureRef,
      pendingMovieListRequestRef,
      pendingTvEpisodesPathRef,
      pendingTvEpisodesRequestRef,
      loadedTvSeriesSignatureRef,
      requestedTvSeriesSignatureRef,
      pendingTvSeriesRequestRef,
      skipMovieQueryRef,
      skipTvQueryRef,
      skipMovieSortRef,
      skipTvSortRef,
      logsDialogOpenRef
    }),
    []
  );

  const setters = useMemo(
    () => ({
      setActiveTab: createSetter<ActiveTab>(dispatch, "setActiveTab"),
      setMovieVideos: createSetter<Video[]>(dispatch, "setMovieVideos"),
      patchMovieVideo: (video: Video) => dispatch({ type: "patchMovieVideo", video }),
      setSelectedVideoIdByType: createSetter<Record<MediaType, string>>(dispatch, "setSelectedVideoIdByType"),
      setTvEpisodes: createSetter<Video[]>(dispatch, "setTvEpisodes"),
      patchTvEpisode: (video: Video) => dispatch({ type: "patchTvEpisode", video }),
      setTvEpisodesPath: createSetter<string>(dispatch, "setTvEpisodesPath"),
      setTvVideosRequestedPath: createSetter<string>(dispatch, "setTvVideosRequestedPath"),
      setSelectedTvDirPath: createSetter<string>(dispatch, "setSelectedTvDirPath"),
      setSelectedTvSeason: createSetter<string>(dispatch, "setSelectedTvSeason"),
      setTvSeriesRows: createSetter<TvSeriesSummary[]>(dispatch, "setTvSeriesRows"),
      setTvSeriesPager: createSetter<Pager>(dispatch, "setTvSeriesPager"),
      setQueryByType: createSetter<Record<MediaType, string>>(dispatch, "setQueryByType"),
      setMoviePager: createSetter<Pager>(dispatch, "setMoviePager"),
      setMovieSortBy: createSetter<MovieSortBy>(dispatch, "setMovieSortBy"),
      setMovieSortOrder: createSetter<SortOrder>(dispatch, "setMovieSortOrder"),
      setTvSeriesSortBy: createSetter<TvSeriesSortBy>(dispatch, "setTvSeriesSortBy"),
      setTvSeriesSortOrder: createSetter<SortOrder>(dispatch, "setTvSeriesSortOrder"),
      setLoading: createSetter<boolean>(dispatch, "setLoading"),
      setPending: createSetter<UiPendingState>(dispatch, "setPending"),
      setUploading: createSetter<boolean>(dispatch, "setUploading"),
      setUploadingMessageState: createSetter<LocalizedText>(dispatch, "setUploadingMessageState"),
      setMessageState: createSetter<LocalizedText>(dispatch, "setMessageState"),
      setScanStatus: createSetter<ScanStatus | null>(dispatch, "setScanStatus"),
      setLogs: createSetter<OperationLog[]>(dispatch, "setLogs"),
      setLogsPager: createSetter<Pager>(dispatch, "setLogsPager"),
      setDirectoryScan: createSetter<DirectoryScanResult>(dispatch, "setDirectoryScan"),
      setVersionInfo: createSetter<VersionInfo | null>(dispatch, "setVersionInfo"),
      setLoadedTabs: createSetter<Record<ActiveTab, boolean>>(dispatch, "setLoadedTabs")
    }),
    []
  );

  return {
    state,
    stateRef: stateRef as MutableRefObject<SubtitleManagerState>,
    setters,
    refs
  };
}
