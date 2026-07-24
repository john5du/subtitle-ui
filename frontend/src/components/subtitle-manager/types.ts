import type {
  PendingSubtitleAction,
  SubHDSearchPage,
  SubHDDownloadOptions,
  Subtitle,
  SubtitleReplaceOptions,
  SubtitleSourceEncoding,
  SubtitleUploadOptions,
  Video
} from "@/lib/types";
import type { ZipSubtitleEntry } from "@/lib/subtitle-zip";

export type DetectedBatchLanguageType =
  | "bilingual"
  | "simplified"
  | "traditional"
  | "english"
  | "japanese"
  | "korean"
  | "unknown";

export type BatchLanguagePreference = "any" | DetectedBatchLanguageType;
export type LibraryViewMode = "list" | "card";
export type TvDrawerMode = "manage" | "batch";
export type SeasonBatchMappingStatus = "auto" | "manual" | "unassigned" | "skipped";
export type SeasonBatchMappingFilter = "all" | "pending" | "mapped" | "skipped";

export interface SeasonBatchMappingRow {
  id: string;
  entry: ZipSubtitleEntry;
  season: number | null;
  episode: number | null;
  autoVideoId: string;
  selectedVideoId: string;
  skipped?: boolean;
}

export interface SeasonBatchRowView extends SeasonBatchMappingRow {
  status: SeasonBatchMappingStatus;
  candidateCount: number;
  languageType: DetectedBatchLanguageType;
  format: string;
  targetVideo: Video | null;
}

export interface RowActionItem {
  label: string;
  href?: string;
  onSelect?: () => void;
  disabled?: boolean;
  external?: boolean;
}

export interface SubtitleDetailsInfoRow {
  label: string;
  value: string;
}

export interface SubtitleDetailsPanelProps {
  panelTitle?: string;
  selectedVideo: Video | null;
  emptyText: string;
  showBack: boolean;
  onBack: () => void;
  infoRows: SubtitleDetailsInfoRow[];
  onUpload: (video: Video, file: File, label: string, options?: SubtitleUploadOptions) => Promise<boolean>;
  onReplace: (video: Video, subtitle: Subtitle, file: File, options?: SubtitleReplaceOptions) => Promise<boolean>;
  onConvertSubtitle: (video: Video, subtitle: Subtitle, sourceEncoding?: SubtitleSourceEncoding) => Promise<boolean>;
  onOffsetSubtitle: (video: Video, subtitle: Subtitle, offsetMs: number) => Promise<boolean>;
  onRemove: (video: Video, subtitle: Subtitle) => Promise<boolean>;
  onPreviewSubtitle: (video: Video, subtitle: Subtitle) => Promise<ArrayBuffer>;
  onSearchSubHD?: (video: Video, opts?: { query?: string; page?: number }) => Promise<SubHDSearchPage>;
  onDownloadSubHD?: (video: Video, sid: string, options?: SubHDDownloadOptions) => Promise<boolean>;
  formatTime: (value: string | undefined | null) => string;
  busy: boolean;
  uploading: boolean;
  uploadingMessage: string;
  subtitleAction: PendingSubtitleAction | null;
  showSearchLinks: boolean;
  searchKeyword?: string;
  showMediaType?: boolean;
  showMetadata?: boolean;
  showUploadButton?: boolean;
  compactMeta?: boolean;
  metaCollapsedByDefault?: boolean;
  showMetaSection?: boolean;
  showPanelTitle?: boolean;
  showSubtitleListCaption?: boolean;
  embedded?: boolean;
}

export interface SubtitleDetailsPanelHandle {
  openUploadPicker: () => void;
}
