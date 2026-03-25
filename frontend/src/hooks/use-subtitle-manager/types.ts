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
  TvSeasonOption,
  TvSeriesSummary,
  UiPendingState,
  Video
} from "@/lib/types";
import type { LocalizedText } from "@/lib/subtitle-manager/messages";

export type SortOrder = "asc" | "desc";
export type LoadChannel = "movieList" | "tvSeriesList" | "tvEpisodes" | "logs";

export interface SubtitleManagerState {
  activeTab: ActiveTab;
  videosByType: Record<MediaType, Video[]>;
  selectedVideoIdByType: Record<MediaType, string>;
  tvEpisodes: Video[];
  tvEpisodesPath: string;
  tvVideosRequestedPath: string;
  selectedTvDirPath: string;
  selectedTvSeason: string;
  tvSeriesRows: TvSeriesSummary[];
  tvSeriesPager: Pager;
  queryByType: Record<MediaType, string>;
  paginationByType: Record<MediaType, Pager>;
  movieYearSortOrder: SortOrder;
  tvSeriesYearSortOrder: SortOrder;
  loading: boolean;
  pending: UiPendingState;
  uploading: boolean;
  uploadingMessageState: LocalizedText;
  messageState: LocalizedText;
  scanStatus: ScanStatus | null;
  logs: OperationLog[];
  directoryScan: DirectoryScanResult;
  loadedTabs: Record<ActiveTab, boolean>;
}

export interface SubtitleManagerRefs {
  pendingLoadsRef: MutableRefObject<number>;
  pendingUploadsRef: MutableRefObject<number>;
  pendingLoadChannelsRef: MutableRefObject<Record<LoadChannel, number>>;
  pendingTvEpisodesPathRef: MutableRefObject<string>;
  pendingTvEpisodesRequestRef: MutableRefObject<{ path: string; promise: Promise<Video[]> } | null>;
  skipMovieQueryRef: MutableRefObject<boolean>;
  skipTvQueryRef: MutableRefObject<boolean>;
  skipMovieSortRef: MutableRefObject<boolean>;
  skipTvSortRef: MutableRefObject<boolean>;
}

export interface SubtitleManagerSetters {
  setActiveTab: Dispatch<SetStateAction<ActiveTab>>;
  setVideosByType: Dispatch<SetStateAction<Record<MediaType, Video[]>>>;
  setSelectedVideoIdByType: Dispatch<SetStateAction<Record<MediaType, string>>>;
  setTvEpisodes: Dispatch<SetStateAction<Video[]>>;
  setTvEpisodesPath: Dispatch<SetStateAction<string>>;
  setTvVideosRequestedPath: Dispatch<SetStateAction<string>>;
  setSelectedTvDirPath: Dispatch<SetStateAction<string>>;
  setSelectedTvSeason: Dispatch<SetStateAction<string>>;
  setTvSeriesRows: Dispatch<SetStateAction<TvSeriesSummary[]>>;
  setTvSeriesPager: Dispatch<SetStateAction<Pager>>;
  setQueryByType: Dispatch<SetStateAction<Record<MediaType, string>>>;
  setPaginationByType: Dispatch<SetStateAction<Record<MediaType, Pager>>>;
  setMovieYearSortOrder: Dispatch<SetStateAction<SortOrder>>;
  setTvSeriesYearSortOrder: Dispatch<SetStateAction<SortOrder>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setPending: Dispatch<SetStateAction<UiPendingState>>;
  setUploading: Dispatch<SetStateAction<boolean>>;
  setUploadingMessageState: Dispatch<SetStateAction<LocalizedText>>;
  setMessageState: Dispatch<SetStateAction<LocalizedText>>;
  setScanStatus: Dispatch<SetStateAction<ScanStatus | null>>;
  setLogs: Dispatch<SetStateAction<OperationLog[]>>;
  setDirectoryScan: Dispatch<SetStateAction<DirectoryScanResult>>;
  setLoadedTabs: Dispatch<SetStateAction<Record<ActiveTab, boolean>>>;
}

export interface SubtitleManagerStateApi {
  state: SubtitleManagerState;
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
  uploadSubtitle: (video: Video, file: File, label: string) => Promise<boolean>;
  replaceSubtitle: (video: Video, subtitle: Subtitle, file: File) => Promise<boolean>;
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
  loadScanStatus: () => Promise<void>;
  loadDirectoryScanResult: () => Promise<string>;
  loadLogs: () => Promise<void>;
  loadMovieVideos: (options?: { page?: number }) => Promise<void>;
  loadTvSeriesPage: (options?: { page?: number }) => Promise<TvSeriesSummary[]>;
  refreshTvVideosForPath: (seriesPath: string) => Promise<Video[]>;
  loadMovieWorkspace: () => Promise<void>;
  loadTvWorkspace: (seriesPath?: string) => Promise<Video[]>;
  selectMovieVideo: (video: Video) => void;
  selectTvVideo: (video: Video) => void;
  selectTvDirectory: (path: string) => void;
  setMoviePage: (nextPage: number) => void;
  setTvPage: (nextPage: number) => void;
  toggleMovieYearSort: () => void;
  toggleTvSeriesYearSort: () => void;
  loadTvBatchCandidates: () => Promise<Video[]>;
  setMovieQuery: (value: string) => void;
  setTvQuery: (value: string) => void;
  setSelectedTvSeason: (value: string) => void;
}
