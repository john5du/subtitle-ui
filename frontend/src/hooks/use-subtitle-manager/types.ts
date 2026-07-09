import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type {
  ActiveTab,
  BatchSubtitleUploadItem,
  BatchSubtitleUploadResult,
  DirectoryScanResult,
  MediaType,
  OperationLog,
  Pager,
  ScanStatus,
  Subtitle,
  SubtitleSourceEncoding,
  SubtitleUploadOptions,
  TvSeasonOption,
  TvSeriesSummary,
  UiPendingState,
  VersionInfo,
  Video
} from "@/lib/types";
import type { LocalizedText } from "@/lib/subtitle-manager/messages";

export type SortOrder = "asc" | "desc";
export type LoadChannel = "movieList" | "tvSeriesList" | "tvEpisodes" | "logs";

export interface SubtitleManagerState {
  activeTab: ActiveTab;
  movieVideos: Video[];
  selectedVideoIdByType: Record<MediaType, string>;
  tvEpisodes: Video[];
  tvEpisodesPath: string;
  tvVideosRequestedPath: string;
  selectedTvDirPath: string;
  selectedTvSeason: string;
  tvSeriesRows: TvSeriesSummary[];
  tvSeriesPager: Pager;
  queryByType: Record<MediaType, string>;
  moviePager: Pager;
  movieYearSortOrder: SortOrder;
  tvSeriesYearSortOrder: SortOrder;
  loading: boolean;
  pending: UiPendingState;
  uploading: boolean;
  uploadingMessageState: LocalizedText;
  messageState: LocalizedText;
  scanStatus: ScanStatus | null;
  logs: OperationLog[];
  logsPager: Pager;
  directoryScan: DirectoryScanResult;
  versionInfo: VersionInfo | null;
  loadedTabs: Record<ActiveTab, boolean>;
}

export interface SubtitleManagerRefs {
  pendingLoadsRef: MutableRefObject<number>;
  pendingUploadsRef: MutableRefObject<number>;
  pendingLoadChannelsRef: MutableRefObject<Record<LoadChannel, number>>;
  loadedMovieListSignatureRef: MutableRefObject<string>;
  requestedMovieListSignatureRef: MutableRefObject<string>;
  pendingMovieListRequestRef: MutableRefObject<{ signature: string; promise: Promise<void>; controller: AbortController } | null>;
  pendingTvEpisodesPathRef: MutableRefObject<string>;
  pendingTvEpisodesRequestRef: MutableRefObject<{ path: string; promise: Promise<Video[]>; controller: AbortController } | null>;
  loadedTvSeriesSignatureRef: MutableRefObject<string>;
  requestedTvSeriesSignatureRef: MutableRefObject<string>;
  pendingTvSeriesRequestRef: MutableRefObject<{ signature: string; promise: Promise<TvSeriesSummary[]>; controller: AbortController } | null>;
  skipMovieQueryRef: MutableRefObject<boolean>;
  skipTvQueryRef: MutableRefObject<boolean>;
  skipMovieSortRef: MutableRefObject<boolean>;
  skipTvSortRef: MutableRefObject<boolean>;
  logsDialogOpenRef: MutableRefObject<boolean>;
}

export interface SubtitleManagerSetters {
  setActiveTab: Dispatch<SetStateAction<ActiveTab>>;
  setMovieVideos: Dispatch<SetStateAction<Video[]>>;
  patchMovieVideo: (video: Video) => void;
  setSelectedVideoIdByType: Dispatch<SetStateAction<Record<MediaType, string>>>;
  setTvEpisodes: Dispatch<SetStateAction<Video[]>>;
  patchTvEpisode: (video: Video) => void;
  setTvEpisodesPath: Dispatch<SetStateAction<string>>;
  setTvVideosRequestedPath: Dispatch<SetStateAction<string>>;
  setSelectedTvDirPath: Dispatch<SetStateAction<string>>;
  setSelectedTvSeason: Dispatch<SetStateAction<string>>;
  setTvSeriesRows: Dispatch<SetStateAction<TvSeriesSummary[]>>;
  setTvSeriesPager: Dispatch<SetStateAction<Pager>>;
  setQueryByType: Dispatch<SetStateAction<Record<MediaType, string>>>;
  setMoviePager: Dispatch<SetStateAction<Pager>>;
  setMovieYearSortOrder: Dispatch<SetStateAction<SortOrder>>;
  setTvSeriesYearSortOrder: Dispatch<SetStateAction<SortOrder>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setPending: Dispatch<SetStateAction<UiPendingState>>;
  setUploading: Dispatch<SetStateAction<boolean>>;
  setUploadingMessageState: Dispatch<SetStateAction<LocalizedText>>;
  setMessageState: Dispatch<SetStateAction<LocalizedText>>;
  setScanStatus: Dispatch<SetStateAction<ScanStatus | null>>;
  setLogs: Dispatch<SetStateAction<OperationLog[]>>;
  setLogsPager: Dispatch<SetStateAction<Pager>>;
  setDirectoryScan: Dispatch<SetStateAction<DirectoryScanResult>>;
  setVersionInfo: Dispatch<SetStateAction<VersionInfo | null>>;
  setLoadedTabs: Dispatch<SetStateAction<Record<ActiveTab, boolean>>>;
}

export interface SubtitleManagerStateApi {
  state: SubtitleManagerState;
  stateRef: MutableRefObject<SubtitleManagerState>;
  setters: SubtitleManagerSetters;
  refs: SubtitleManagerRefs;
}

export interface SubtitleManagerSelectors {
  movieVideos: Video[];
  moviePager: Pager;
  tvPager: Pager;
  tvRootPath: string;
  selectedTvSeries: TvSeriesSummary | null;
  selectedTvSeriesVideos: Video[];
  tvSeasonOptions: TvSeasonOption[];
  sortedTvVideos: Video[];
  selectedMovie: Video | null;
  selectedTvVideo: Video | null;
  showTvScanPrompt: boolean;
}

export interface SubtitleManagerCore {
  activeTab: ActiveTab;
  loading: boolean;
  pending: UiPendingState;
  uploading: boolean;
  uploadingMessage: string;
  message: string;
  formatTime: (value: string | undefined | null) => string;
}

export interface SubtitleManagerDashboardDomain {
  scanStatus: ScanStatus | null;
  directoryScan: DirectoryScanResult;
  logs: OperationLog[];
  logsPager: Pager;
  versionInfo: VersionInfo | null;
  setLogsPage: (nextPage: number) => void;
  refreshLogs: (page?: number) => Promise<void>;
  clearLogs: () => Promise<boolean>;
  setLogsDialogOpen: (open: boolean) => void;
}

export interface SubtitleManagerMovieDomain {
  query: string;
  setQuery: (value: string) => void;
  videos: Video[];
  pager: Pager;
  yearSortOrder: SortOrder;
  selectedVideo: Video | null;
  selectedVideoId: string;
  selectVideo: (video: Video) => void;
  setPage: (nextPage: number) => void;
  toggleYearSort: () => void;
  loadWorkspace: () => Promise<void>;
}

export interface SubtitleManagerTvDomain {
  query: string;
  setQuery: (value: string) => void;
  rows: TvSeriesSummary[];
  pager: Pager;
  yearSortOrder: SortOrder;
  selectedSeries: TvSeriesSummary | null;
  selectedSeason: string;
  seasonOptions: TvSeasonOption[];
  videos: Video[];
  selectedVideo: Video | null;
  selectedVideoId: string;
  showScanPrompt: boolean;
  selectSeries: (path: string) => void;
  selectVideo: (video: Video) => void;
  setSelectedSeason: (value: string) => void;
  setPage: (nextPage: number) => void;
  toggleYearSort: () => void;
  loadWorkspace: (seriesPath?: string) => Promise<Video[]>;
  loadBatchCandidates: () => Promise<Video[]>;
}

export interface SubtitleManagerActions {
  switchTab: (tab: ActiveTab) => Promise<void>;
  triggerScan: () => Promise<void>;
  refreshActiveTab: () => Promise<void>;
  uploadSubtitle: (video: Video, file: File, label: string, options?: SubtitleUploadOptions) => Promise<boolean>;
  replaceSubtitle: (video: Video, subtitle: Subtitle, file: File) => Promise<boolean>;
  convertSubtitleToAss: (video: Video, subtitle: Subtitle, sourceEncoding?: SubtitleSourceEncoding) => Promise<boolean>;
  offsetSubtitleTiming: (video: Video, subtitle: Subtitle, offsetMs: number) => Promise<boolean>;
  removeSubtitle: (video: Video, subtitle: Subtitle) => Promise<boolean>;
  previewSubtitle: (video: Video, subtitle: Subtitle) => Promise<ArrayBuffer>;
  uploadBatchSubtitles: (items: BatchSubtitleUploadItem[]) => Promise<BatchSubtitleUploadResult>;
}

export interface SubtitleManagerResult {
  core: SubtitleManagerCore;
  dashboard: SubtitleManagerDashboardDomain;
  movie: SubtitleManagerMovieDomain;
  tv: SubtitleManagerTvDomain;
  actions: SubtitleManagerActions;
}

export interface SubtitleManagerController extends SubtitleManagerActions {
  finishBootstrapping: () => void;
  loadVersionInfo: () => Promise<void>;
  loadScanStatus: () => Promise<void>;
  loadDirectoryScanResult: () => Promise<string>;
  loadLogs: (options?: { page?: number }) => Promise<void>;
  clearLogs: () => Promise<boolean>;
  loadMovieVideos: (options?: { page?: number; force?: boolean }) => Promise<void>;
  loadTvSeriesPage: (options?: { page?: number; force?: boolean }) => Promise<TvSeriesSummary[]>;
  refreshTvVideosForPath: (seriesPath: string) => Promise<Video[]>;
  loadMovieWorkspace: () => Promise<void>;
  loadTvWorkspace: (seriesPath?: string) => Promise<Video[]>;
  selectMovieVideo: (video: Video) => void;
  selectTvVideo: (video: Video) => void;
  selectTvDirectory: (path: string) => void;
  setMoviePage: (nextPage: number) => void;
  setTvPage: (nextPage: number) => void;
  setLogsPage: (nextPage: number) => void;
  setLogsDialogOpen: (open: boolean) => void;
  toggleMovieYearSort: () => void;
  toggleTvSeriesYearSort: () => void;
  loadTvBatchCandidates: () => Promise<Video[]>;
  setMovieQuery: (value: string) => void;
  setTvQuery: (value: string) => void;
  setSelectedTvSeason: (value: string) => void;
}
