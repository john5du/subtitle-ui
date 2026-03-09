export type MediaType = "movie" | "tv";
export type ActiveTab = "dashboard" | "movie" | "tv" | "logs";

export interface Subtitle {
  id: string;
  path: string;
  fileName: string;
  language: string;
  format: string;
  size: number;
  modTime: string;
}

export interface Video {
  id: string;
  path: string;
  directory: string;
  fileName: string;
  title: string;
  year?: string;
  mediaType: MediaType;
  metadataSource: string;
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
  latestEpisodeYear?: string;
  updatedAt: string;
  videoCount: number;
  noSubtitleCount: number;
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

