export type MediaType = "movie" | "tv";
export type ActiveTab = "dashboard" | "movie" | "tv" | "settings";
export type SubtitleOperationKind = "upload" | "replace" | "delete" | "convert" | "batch";
export type SubtitleSourceEncoding = "auto" | "utf-8" | "utf-16le" | "utf-16be" | "gb18030" | "big5";
export type SubtitleSource = "directory" | "upload" | "generated";

export interface Subtitle {
  id: string;
  path: string;
  fileName: string;
  language: string;
  format: string;
  size: number;
  modTime: string;
  source: SubtitleSource;
  sourceDetail?: string;
}

export interface Video {
  id: string;
  path: string;
  directory: string;
  fileName: string;
  title: string;
  originalTitle?: string;
  year?: string;
  imdbId?: string;
  tmdbId?: string;
  mediaType: MediaType;
  metadataSource: string;
  seriesTitle?: string;
  seriesOriginalTitle?: string;
  seriesImdbId?: string;
  seriesTmdbId?: string;
  posterUrl?: string;
  subtitles: Subtitle[];
  updatedAt: string;
}

export interface VideoPage {
  items: Video[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ScanStatus {
  running: boolean;
  lastStartedAt?: string;
  lastFinishedAt?: string;
  videoCount: number;
  error?: string;
}

export interface OperationLog {
  id: string;
  timestamp: string;
  action: string;
  videoId: string;
  targetPath?: string;
  backupPath?: string;
  status: string;
  message?: string;
}

export interface OperationLogPage {
  items: OperationLog[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ScanDirectory {
  id: string;
  path: string;
  mediaType: MediaType;
  videoFileCount: number;
  metadataFileCount: number;
  hasVideo: boolean;
  hasMetadata: boolean;
}

export interface DirectoryScanResult {
  generatedAt: string;
  movieRoot: string;
  tvRoot: string;
  movieCount: number;
  tvSeriesCount: number;
  movie: ScanDirectory[];
  tv: ScanDirectory[];
  errors: string[];
}

export interface Pager {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface TreeNode {
  path: string;
  label: string;
  videoCount: number;
  metadataCount: number;
  children: TreeNode[];
}

export interface VisibleTreeNode {
  path: string;
  label: string;
  depth: number;
  hasChildren: boolean;
  videoCount: number;
  metadataCount: number;
  expanded: boolean;
}

export interface BatchSubtitleUploadItem {
  video: Video;
  file: File;
  label: string;
  sourceName?: string;
}

export interface SubtitleUploadOptions {
  convertToAss?: boolean;
  sourceEncoding?: SubtitleSourceEncoding;
}

export interface SubtitleConversionConfig {
  assTemplate: string;
  defaultAssTemplate: string;
  sourceEncodingDefault: SubtitleSourceEncoding;
  updatedAt: string;
}

export interface BatchSubtitleUploadResult {
  total: number;
  success: number;
  failed: number;
  errors: string[];
}

export interface TvSeriesSummary {
  key: string;
  path: string;
  title: string;
  originalTitle?: string;
  imdbId?: string;
  tmdbId?: string;
  latestEpisodeYear?: string;
  updatedAt: string;
  videoCount: number;
  noSubtitleCount: number;
  posterUrl?: string;
}

export interface TvSeriesPage {
  items: TvSeriesSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface TvSeasonOption {
  value: string;
  label: string;
  season?: number;
}

export interface VersionInfo {
  version: string;
}

export interface PendingSubtitleAction {
  kind: SubtitleOperationKind;
  videoId: string;
  subtitleId?: string;
  subtitleFileName?: string;
}

export interface UiPendingState {
  bootstrapping: boolean;
  tabSwitch: boolean;
  scan: boolean;
  refreshTab: ActiveTab | null;
  movieList: boolean;
  tvSeriesList: boolean;
  tvEpisodes: boolean;
  logs: boolean;
  subtitleAction: PendingSubtitleAction | null;
}
