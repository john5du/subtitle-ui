import type { PendingSubtitleAction, Subtitle, Video } from "@/lib/types";
import type { ZipSubtitleEntry } from "@/lib/subtitle-zip";

export interface SeasonEpisodeInfo {
  season: number;
  episode: number;
}

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
  panelTitle: string;
  selectedVideo: Video | null;
  emptyText: string;
  showBack: boolean;
  onBack: () => void;
  infoRows: SubtitleDetailsInfoRow[];
  onUpload: (video: Video, file: File, label: string) => Promise<boolean>;
  onReplace: (video: Video, subtitle: Subtitle, file: File) => Promise<boolean>;
  onRemove: (video: Video, subtitle: Subtitle) => Promise<boolean>;
  onPreviewSubtitle: (video: Video, subtitle: Subtitle) => Promise<ArrayBuffer>;
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
  showSubtitleListCaption?: boolean;
}

export interface SubtitleDetailsPanelHandle {
  openUploadPicker: () => void;
}
