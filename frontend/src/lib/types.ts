export type MediaType = "movie" | "tv";
export type ActiveTab = "dashboard" | "movie" | "tv";
export type SubtitleOperationKind = "upload" | "replace" | "delete" | "convert" | "offset" | "batch" | "download";
export type SubtitleSourceEncoding = "auto" | "utf-8" | "utf-16le" | "utf-16be" | "gb18030" | "big5";
export type SubtitleSource = "directory" | "upload" | "generated" | "download";

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
  archiveEntry?: string;
}

export interface SubtitleUploadOptions {
  convertToAss?: boolean;
  sourceEncoding?: SubtitleSourceEncoding;
  archiveEntry?: string;
}

export interface SubtitleReplaceOptions {
  archiveEntry?: string;
}

export interface SubtitleConversionConfig {
  assTemplate: string;
  defaultAssTemplate: string;
  sourceEncodingDefault: SubtitleSourceEncoding;
  updatedAt: string;
}

export interface SubHDConfig {
  enabled: boolean;
  baseUrl: string;
  proxy: string;
  defaultBaseUrl: string;
  updatedAt?: string;
}

export interface BatchSubtitleUploadResult {
  total: number;
  success: number;
  failed: number;
  errors: string[];
}

export interface ArchiveEntryMeta {
  path: string;
  fileName: string;
  size: number;
}

export interface SubHDSeasonPrepareOptions {
  sid: string;
  videoIds: string[];
  languagePreference?: string;
  formatPreference?: string;
  skipExisting?: boolean;
  label?: string;
}

export interface SubHDSeasonSuggestedMapping {
  videoId: string;
  archiveEntry: string;
  label?: string;
  skipped?: boolean;
  reason?: string;
}

export interface SubHDSeasonPrepareResult {
  cacheToken: string;
  sid: string;
  fileName: string;
  entries: ArchiveEntryMeta[];
  suggestedMappings: SubHDSeasonSuggestedMapping[];
  notices?: string[];
}

export interface SubHDSeasonInstallMapping {
  videoId: string;
  archiveEntry: string;
  label?: string;
}

export interface SubHDSeasonInstallOptions {
  cacheToken: string;
  mappings: SubHDSeasonInstallMapping[];
}

export interface SubHDSeasonInstallResult {
  results: Array<{
    videoId: string;
    archiveEntry: string;
    ok: boolean;
    error?: string;
  }>;
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
  databaseType: "sqlite" | "postgres" | string;
}

export interface SubHDSearchResult {
  sid: string;
  title: string;
  version: string;
  langs?: string[];
  format?: string;
  sourceTag?: string;
  size?: string;
  downloads?: string;
  publisher?: string;
  doubanId?: string;
  installable: boolean;
}

export interface SubHDSearchPage {
  query: string;
  page: number;
  total?: string;
  items: SubHDSearchResult[];
}

export interface SubHDSeasonPacksResult {
  query: string;
  season: number;
  doubanId?: string;
  titlePageUrl?: string;
  title?: string;
  items: SubHDSearchResult[];
  message?: string;
}

export interface SubHDDownloadOptions {
  label?: string;
  replaceId?: string;
  archiveEntry?: string;
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
