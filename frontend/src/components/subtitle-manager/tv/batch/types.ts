import type {
  BatchSubtitleUploadItem,
  BatchSubtitleUploadResult,
  SubHDSeasonInstallOptions,
  SubHDSeasonPacksResult,
  SubHDSeasonPrepareOptions,
  SubHDSeasonPrepareResult,
  TvSeriesSummary,
  Video
} from "@/lib/types";

export type BatchSourceMode = "local" | "subhd";

export interface TvSeasonBatchUploadWorkspaceProps {
  busy: boolean;
  uploading: boolean;
  uploadingMessage: string;
  onLoadBatchCandidates: () => Promise<Video[]>;
  onUploadBatch: (items: BatchSubtitleUploadItem[]) => Promise<BatchSubtitleUploadResult>;
  selectedSeries?: TvSeriesSummary | null;
  selectedSeason?: string;
  seasonVideos?: Video[];
  onSearchSubHDSeasonPacks?: (video: Video, opts?: { query?: string; season?: number }) => Promise<SubHDSeasonPacksResult>;
  onPrepareSubHDSeason?: (options: SubHDSeasonPrepareOptions) => Promise<SubHDSeasonPrepareResult>;
  onInstallSubHDSeason?: (options: SubHDSeasonInstallOptions) => Promise<BatchSubtitleUploadResult>;
  /** Called after mapped install/upload finishes (success or partial failure). */
  onComplete?: (result?: BatchSubtitleUploadResult) => void;
  className?: string;
  /** Start SubHD season-pack search when the workspace mounts. */
  autoSearchOnMount?: boolean;
}

export const ROW_SELECT_PENDING = "__PENDING__";
export const ROW_SELECT_SKIPPED = "__SKIPPED__";
