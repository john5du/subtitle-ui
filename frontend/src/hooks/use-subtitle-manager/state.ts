"use client";

import { useRef, useState } from "react";

import type {
  ActiveTab,
  DirectoryScanResult,
  MediaType,
  OperationLog,
  Pager,
  ScanStatus,
  TvSeriesSummary,
  UiPendingState,
  Video
} from "@/lib/types";
import type { LocalizedText } from "@/lib/subtitle-manager/messages";

import type { SubtitleManagerStateApi } from "./types";

export const DEFAULT_PAGE_SIZE = 30;

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
} as const;

function createDefaultPager(): Pager {
  return {
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    total: 0,
    totalPages: 0
  };
}

function createDefaultVideosByType(): Record<MediaType, Video[]> {
  return {
    movie: [],
    tv: []
  };
}

function createDefaultSelectedVideoIds(): Record<MediaType, string> {
  return {
    movie: "",
    tv: ""
  };
}

function createDefaultQueryByType(): Record<MediaType, string> {
  return {
    movie: "",
    tv: ""
  };
}

function createDefaultPaginationByType(): Record<MediaType, Pager> {
  return {
    movie: createDefaultPager(),
    tv: createDefaultPager()
  };
}

function createDefaultLoadedTabs(): Record<ActiveTab, boolean> {
  return {
    dashboard: false,
    movie: false,
    tv: false,
    logs: false
  };
}

export function useSubtitleManagerState(): SubtitleManagerStateApi {
  const [activeTab, setActiveTab] = useState<ActiveTab>("dashboard");
  const [videosByType, setVideosByType] = useState<Record<MediaType, Video[]>>(createDefaultVideosByType);
  const [selectedVideoIdByType, setSelectedVideoIdByType] = useState<Record<MediaType, string>>(createDefaultSelectedVideoIds);
  const [tvEpisodes, setTvEpisodes] = useState<Video[]>([]);
  const [tvEpisodesPath, setTvEpisodesPath] = useState("");
  const [tvVideosRequestedPath, setTvVideosRequestedPath] = useState("");
  const [selectedTvDirPath, setSelectedTvDirPath] = useState("");
  const [selectedTvSeason, setSelectedTvSeason] = useState("");
  const [tvSeriesRows, setTvSeriesRows] = useState<TvSeriesSummary[]>([]);
  const [tvSeriesPager, setTvSeriesPager] = useState<Pager>(createDefaultPager);
  const [queryByType, setQueryByType] = useState<Record<MediaType, string>>(createDefaultQueryByType);
  const [paginationByType, setPaginationByType] = useState<Record<MediaType, Pager>>(createDefaultPaginationByType);
  const [movieYearSortOrder, setMovieYearSortOrder] = useState<"asc" | "desc">("desc");
  const [tvSeriesYearSortOrder, setTvSeriesYearSortOrder] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<UiPendingState>(EMPTY_PENDING_STATE);
  const [uploading, setUploading] = useState(false);
  const [uploadingMessageState, setUploadingMessageState] = useState<LocalizedText>(null);
  const [messageState, setMessageState] = useState<LocalizedText>(null);
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [directoryScan, setDirectoryScan] = useState<DirectoryScanResult>(EMPTY_DIRECTORY_SCAN);
  const [loadedTabs, setLoadedTabs] = useState<Record<ActiveTab, boolean>>(createDefaultLoadedTabs);

  const pendingLoadsRef = useRef(0);
  const pendingUploadsRef = useRef(0);
  const pendingLoadChannelsRef = useRef({
    movieList: 0,
    tvSeriesList: 0,
    tvEpisodes: 0,
    logs: 0
  });
  const loadedMovieListSignatureRef = useRef("");
  const requestedMovieListSignatureRef = useRef("");
  const pendingMovieListRequestRef = useRef<{ signature: string; promise: Promise<void> } | null>(null);
  const pendingTvEpisodesPathRef = useRef("");
  const pendingTvEpisodesRequestRef = useRef<{ path: string; promise: Promise<Video[]> } | null>(null);
  const loadedTvSeriesSignatureRef = useRef("");
  const requestedTvSeriesSignatureRef = useRef("");
  const pendingTvSeriesRequestRef = useRef<{ signature: string; promise: Promise<TvSeriesSummary[]> } | null>(null);
  const skipMovieQueryRef = useRef(true);
  const skipTvQueryRef = useRef(true);
  const skipMovieSortRef = useRef(true);
  const skipTvSortRef = useRef(true);

  return {
    state: {
      activeTab,
      videosByType,
      selectedVideoIdByType,
      tvEpisodes,
      tvEpisodesPath,
      tvVideosRequestedPath,
      selectedTvDirPath,
      selectedTvSeason,
      tvSeriesRows,
      tvSeriesPager,
      queryByType,
      paginationByType,
      movieYearSortOrder,
      tvSeriesYearSortOrder,
      loading,
      pending,
      uploading,
      uploadingMessageState,
      messageState,
      scanStatus,
      logs,
      directoryScan,
      loadedTabs
    },
    setters: {
      setActiveTab,
      setVideosByType,
      setSelectedVideoIdByType,
      setTvEpisodes,
      setTvEpisodesPath,
      setTvVideosRequestedPath,
      setSelectedTvDirPath,
      setSelectedTvSeason,
      setTvSeriesRows,
      setTvSeriesPager,
      setQueryByType,
      setPaginationByType,
      setMovieYearSortOrder,
      setTvSeriesYearSortOrder,
      setLoading,
      setPending,
      setUploading,
      setUploadingMessageState,
      setMessageState,
      setScanStatus,
      setLogs,
      setDirectoryScan,
      setLoadedTabs
    },
    refs: {
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
      skipTvSortRef
    }
  };
}
