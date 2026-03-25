"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Eye,
  ExternalLink,
  Film,
  FileText,
  FolderTree,
  Languages,
  LayoutDashboard,
  LayoutGrid,
  List,
  Monitor,
  MoreHorizontal,
  Moon,
  RefreshCw,
  Search,
  Sun,
  Tv
} from "lucide-react";
import Image from "next/image";
import { useTheme } from "next-themes";
import { createPortal } from "react-dom";

import { useI18n, type TranslateFn } from "@/lib/i18n";
import { useSubtitleManager } from "@/hooks/use-subtitle-manager";
import type {
  ActiveTab,
  BatchSubtitleUploadItem,
  BatchSubtitleUploadResult,
  DirectoryScanResult,
  OperationLog,
  PendingSubtitleAction,
  Pager,
  ScanStatus,
  Subtitle,
  TvSeasonOption,
  TvSeriesSummary,
  UiPendingState,
  Video,
} from "@/lib/types";
import { buildSubtitleSearchLinks, buildSubtitleSearchLinksByKeyword } from "@/lib/subtitle-search";
import { emitToast } from "@/lib/toast";
import {
  extractSubtitleEntriesFromArchiveFile,
  isArchiveFileName,
  isSubtitleFileName,
  toSubtitleFile,
  type ZipSubtitleEntry
} from "@/lib/subtitle-zip";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
interface SeasonEpisodeInfo {
  season: number;
  episode: number;
}

type DetectedBatchLanguageType =
  | "bilingual"
  | "simplified"
  | "traditional"
  | "english"
  | "japanese"
  | "korean"
  | "unknown";

type BatchLanguagePreference = "any" | DetectedBatchLanguageType;
type LibraryViewMode = "list" | "card";

const LIBRARY_VIEW_STORAGE_KEY = "subtitle-ui:library-view";

const BATCH_LANGUAGE_LABEL_KEYS: Record<DetectedBatchLanguageType, Parameters<TranslateFn>[0]> = {
  bilingual: "batch.language.bilingual",
  simplified: "batch.language.simplified",
  traditional: "batch.language.traditional",
  english: "batch.language.english",
  japanese: "batch.language.japanese",
  korean: "batch.language.korean",
  unknown: "batch.language.unknown"
};

const BATCH_LANGUAGE_ORDER: DetectedBatchLanguageType[] = [
  "bilingual",
  "simplified",
  "traditional",
  "english",
  "japanese",
  "korean",
  "unknown"
];

const BATCH_FORMAT_ORDER = [".ass", ".ssa", ".srt", ".vtt", ".sub"];

function compareSubtitleFormats(a: string, b: string) {
  const ia = BATCH_FORMAT_ORDER.indexOf(a);
  const ib = BATCH_FORMAT_ORDER.indexOf(b);
  const aa = ia < 0 ? Number.MAX_SAFE_INTEGER : ia;
  const bb = ib < 0 ? Number.MAX_SAFE_INTEGER : ib;
  if (aa !== bb) {
    return aa - bb;
  }
  return a.localeCompare(b);
}

function compareLanguageTypes(a: DetectedBatchLanguageType, b: DetectedBatchLanguageType) {
  const ia = BATCH_LANGUAGE_ORDER.indexOf(a);
  const ib = BATCH_LANGUAGE_ORDER.indexOf(b);
  const aa = ia < 0 ? Number.MAX_SAFE_INTEGER : ia;
  const bb = ib < 0 ? Number.MAX_SAFE_INTEGER : ib;
  if (aa !== bb) {
    return aa - bb;
  }
  return a.localeCompare(b);
}

function formatLanguageTypeLabel(value: DetectedBatchLanguageType, t: TranslateFn) {
  return t(BATCH_LANGUAGE_LABEL_KEYS[value]);
}

function formatSubtitleExtLabel(ext: string) {
  return ext.replace(".", "").toUpperCase();
}

function isLibraryViewMode(value: string | null | undefined): value is LibraryViewMode {
  return value === "list" || value === "card";
}

function normalizeSubtitleFormat(value: string) {
  return value.toLowerCase();
}

function getLanguageTypesFromEntries(entries: ZipSubtitleEntry[]) {
  const set = new Set<DetectedBatchLanguageType>();
  for (const entry of entries) {
    set.add(detectSubtitleLanguageType(`${entry.path} ${entry.fileName}`));
  }
  return Array.from(set).sort(compareLanguageTypes);
}

function getSubtitleFormatsFromEntries(entries: ZipSubtitleEntry[]) {
  const set = new Set<string>();
  for (const entry of entries) {
    const ext = normalizeSubtitleFormat(subtitleExtension(entry.fileName || entry.path));
    if (ext) {
      set.add(ext);
    }
  }
  return Array.from(set).sort(compareSubtitleFormats);
}

interface SeasonBatchMappingRow {
  id: string;
  entry: ZipSubtitleEntry;
  season: number | null;
  episode: number | null;
  autoVideoId: string;
  selectedVideoId: string;
}

function parseSeasonEpisode(text: string): SeasonEpisodeInfo | null {
  const patterns = [
    /\bs(\d{1,2})e(\d{1,3})\b/i,
    /\b(\d{1,2})x(\d{1,3})\b/i,
    /\bseason[\s._-]*(\d{1,2})[\s._-]*episode[\s._-]*(\d{1,3})\b/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }
    return {
      season: Number.parseInt(match[1], 10),
      episode: Number.parseInt(match[2], 10)
    };
  }

  return null;
}

function parseVideoSeasonEpisode(video: Video): SeasonEpisodeInfo | null {
  return parseSeasonEpisode(`${video.fileName ?? ""} ${video.title ?? ""}`);
}

function formatSeasonEpisodeText(season: number | null, episode: number | null) {
  if (season === null || episode === null) {
    return "-";
  }
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

function PosterPlaceholder({ className }: { className?: string }) {
  return (
    <div
      className={cn("rounded-md border border-border/60 bg-muted/45 shadow-inner", className ?? "h-[72px] w-[48px]")}
      aria-hidden
    />
  );
}

interface PosterThumbnailProps {
  src?: string;
  className?: string;
  imageClassName?: string;
  sizes?: string;
}

function PosterThumbnail({ src = "", className, imageClassName, sizes = "48px" }: PosterThumbnailProps) {
  const [failed, setFailed] = useState(false);
  const frameClassName = className ?? "h-[72px] w-[48px]";
  const resolvedImageClassName = imageClassName ?? "h-full w-full";

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return <PosterPlaceholder className={frameClassName} />;
  }

  return (
    <div className={cn("overflow-hidden rounded-md border border-border/60 bg-muted/30 shadow-sm", frameClassName)}>
      <Image
        src={src}
        alt=""
        width={480}
        height={720}
        unoptimized
        sizes={sizes}
        className={cn("object-cover align-middle", resolvedImageClassName)}
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function compareTvVideosByEpisode(a: Video, b: Video) {
  const aa = parseVideoSeasonEpisode(a);
  const bb = parseVideoSeasonEpisode(b);

  const seasonA = aa?.season ?? Number.MAX_SAFE_INTEGER;
  const seasonB = bb?.season ?? Number.MAX_SAFE_INTEGER;
  if (seasonA !== seasonB) {
    return seasonA - seasonB;
  }

  const episodeA = aa?.episode ?? Number.MAX_SAFE_INTEGER;
  const episodeB = bb?.episode ?? Number.MAX_SAFE_INTEGER;
  if (episodeA !== episodeB) {
    return episodeA - episodeB;
  }

  const byName = (a.fileName ?? "").localeCompare(b.fileName ?? "");
  if (byName !== 0) {
    return byName;
  }

  return (a.title ?? "").localeCompare(b.title ?? "");
}

function buildSeasonBatchRows(videos: Video[], entries: ZipSubtitleEntry[]) {
  const byEpisode = new Map<string, Video[]>();
  for (const video of videos) {
    const parsed = parseVideoSeasonEpisode(video);
    if (!parsed) {
      continue;
    }
    const key = `${parsed.season}-${parsed.episode}`;
    const list = byEpisode.get(key) ?? [];
    list.push(video);
    byEpisode.set(key, list);
  }

  const rows = entries.map((entry) => {
    const parsed = parseSeasonEpisode(`${entry.path} ${entry.fileName}`);
    const season = parsed?.season ?? null;
    const episode = parsed?.episode ?? null;
    let autoVideoId = "";
    if (season !== null && episode !== null) {
      const key = `${season}-${episode}`;
      const candidates = byEpisode.get(key) ?? [];
      if (candidates.length === 1) {
        autoVideoId = candidates[0].id;
      }
    }

    return {
      id: entry.id,
      entry,
      season,
      episode,
      autoVideoId,
      selectedVideoId: autoVideoId
    } satisfies SeasonBatchMappingRow;
  });

  rows.sort((a, b) => {
    const seasonA = a.season ?? Number.MAX_SAFE_INTEGER;
    const seasonB = b.season ?? Number.MAX_SAFE_INTEGER;
    if (seasonA !== seasonB) {
      return seasonA - seasonB;
    }

    const episodeA = a.episode ?? Number.MAX_SAFE_INTEGER;
    const episodeB = b.episode ?? Number.MAX_SAFE_INTEGER;
    if (episodeA !== episodeB) {
      return episodeA - episodeB;
    }

    return a.entry.path.localeCompare(b.entry.path);
  });

  return rows;
}

function candidateVideosForBatchRow(row: SeasonBatchMappingRow, videos: Video[]) {
  const allSorted = [...videos].sort(compareTvVideosByEpisode);
  if (row.season === null) {
    return allSorted;
  }

  const sameSeason = allSorted.filter((video) => parseVideoSeasonEpisode(video)?.season === row.season);
  if (sameSeason.length > 0) {
    const sameSeasonIds = new Set(sameSeason.map((video) => video.id));
    const otherSeasons = allSorted.filter((video) => !sameSeasonIds.has(video.id));
    return [...sameSeason, ...otherSeasons];
  }

  return allSorted;
}

function subtitleExtension(fileName: string) {
  const lower = fileName.toLowerCase();
  const index = lower.lastIndexOf(".");
  if (index < 0) {
    return "";
  }
  return lower.slice(index);
}

function detectSubtitleLanguageType(fileNameOrPath: string): DetectedBatchLanguageType {
  const text = fileNameOrPath.toLowerCase();

  if (/双语|bilingual|中英|简英|繁英|chs[._\-\s&+]*eng|eng[._\-\s&+]*chs|zh[._\-\s&+]*en|en[._\-\s&+]*zh/.test(text)) {
    return "bilingual";
  }

  if (/简体|简中|chs|gb|zh[-_.\s]?hans|sc\b/.test(text)) {
    return "simplified";
  }

  if (/繁体|繁中|cht|big5|zh[-_.\s]?hant|tc\b/.test(text)) {
    return "traditional";
  }

  if (/英文|english|\beng\b/.test(text)) {
    return "english";
  }

  if (/日语|日文|japanese|\bjpn\b/.test(text)) {
    return "japanese";
  }

  if (/韩语|韩文|korean|\bkor\b/.test(text)) {
    return "korean";
  }

  return "unknown";
}

function choosePreferredEntry(
  entries: ZipSubtitleEntry[],
  languagePreference: BatchLanguagePreference,
  formatPreference: string
) {
  let pool = [...entries];

  if (formatPreference !== "any") {
    const byFormat = pool.filter((entry) => subtitleExtension(entry.fileName) === formatPreference);
    if (byFormat.length > 0) {
      pool = byFormat;
    }
  }

  if (languagePreference !== "any") {
    const byLanguage = pool.filter(
      (entry) => detectSubtitleLanguageType(`${entry.path} ${entry.fileName}`) === languagePreference
    );
    if (byLanguage.length > 0) {
      pool = byLanguage;
    }
  }

  pool.sort((a, b) => a.path.localeCompare(b.path));
  return pool[0];
}

function applyBatchEntryPreferences(
  entries: ZipSubtitleEntry[],
  languagePreference: BatchLanguagePreference,
  formatPreference: string
) {
  const byEpisode = new Map<string, ZipSubtitleEntry[]>();
  const passthrough: ZipSubtitleEntry[] = [];

  for (const entry of entries) {
    const parsed = parseSeasonEpisode(`${entry.path} ${entry.fileName}`);
    if (!parsed) {
      passthrough.push(entry);
      continue;
    }
    const key = `${parsed.season}-${parsed.episode}`;
    const list = byEpisode.get(key) ?? [];
    list.push(entry);
    byEpisode.set(key, list);
  }

  const picked: ZipSubtitleEntry[] = [];
  let duplicateGroups = 0;
  for (const list of byEpisode.values()) {
    if (list.length > 1) {
      duplicateGroups += 1;
    }
    picked.push(choosePreferredEntry(list, languagePreference, formatPreference));
  }

  const merged = [...picked, ...passthrough];
  merged.sort((a, b) => a.path.localeCompare(b.path));

  return {
    entries: merged,
    duplicateGroups,
    reducedCount: Math.max(0, entries.length - merged.length)
  };
}

function countSummaryLabel(
  count: number,
  t: TranslateFn,
  singularKey: Parameters<TranslateFn>[0],
  pluralKey: Parameters<TranslateFn>[0]
) {
  return t(count === 1 ? singularKey : pluralKey, { count });
}

function summarizeBatchInputs(files: File[], entryCount: number, t: TranslateFn) {
  const archiveCount = files.filter((file) => isArchiveFileName(file.name)).length;
  const subtitleCount = files.filter((file) => isSubtitleFileName(file.name)).length;
  const unsupportedCount = files.length - archiveCount - subtitleCount;
  const parts: string[] = [];
  if (archiveCount > 0) {
    parts.push(countSummaryLabel(archiveCount, t, "batch.summary.archive.one", "batch.summary.archive.other"));
  }
  if (subtitleCount > 0) {
    parts.push(countSummaryLabel(subtitleCount, t, "batch.summary.subtitle.one", "batch.summary.subtitle.other"));
  }
  if (unsupportedCount > 0) {
    parts.push(countSummaryLabel(unsupportedCount, t, "batch.summary.unsupported.one", "batch.summary.unsupported.other"));
  }

  const inputs = countSummaryLabel(files.length, t, "batch.summary.input.one", "batch.summary.input.other");
  const entries = countSummaryLabel(entryCount, t, "batch.summary.entry.one", "batch.summary.entry.other");
  return t("batch.summary.total", { inputs, parts: parts.join(", "), entries });
}

function summarizeFileNames(names: string[], t: TranslateFn, maxVisible = 3) {
  if (names.length <= maxVisible) {
    return names.join(", ");
  }
  return `${names.slice(0, maxVisible).join(", ")} ${t("batch.summary.more", { count: names.length - maxVisible })}`;
}

function SpinnerIcon({ className }: { className?: string }) {
  return <RefreshCw className={cn("animate-spin", className)} />;
}

function InlinePending({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-2.5 py-1 text-xs text-muted-foreground">
      <SpinnerIcon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

function PanelLoadingOverlay({ label }: { label: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-start justify-end rounded-xl bg-background/40 p-3 backdrop-blur-[1px]">
      <div className="animate-scale-in inline-flex items-center gap-2 rounded-full border border-border/75 bg-card/95 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-lg">
        <SpinnerIcon className="h-3.5 w-3.5" />
        {label}
      </div>
    </div>
  );
}

function LibraryViewToggle({
  value,
  onChange
}: {
  value: LibraryViewMode;
  onChange: (value: LibraryViewMode) => void;
}) {
  const { t } = useI18n();
  const items: Array<{
    value: LibraryViewMode;
    icon: React.ReactNode;
    label: string;
    ariaLabel: string;
  }> = [
    {
      value: "list",
      icon: <List className="h-4 w-4" />,
      label: t("common.listView"),
      ariaLabel: t("common.switchToListView")
    },
    {
      value: "card",
      icon: <LayoutGrid className="h-4 w-4" />,
      label: t("common.cardView"),
      ariaLabel: t("common.switchToCardView")
    }
  ];

  return (
    <div className="inline-flex items-center rounded-xl border border-border/70 bg-background/80 p-1 shadow-sm">
      {items.map((item) => {
        const active = item.value === value;
        return (
          <Button
            key={item.value}
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 gap-2 rounded-lg px-3 text-xs font-medium",
              active
                ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
            aria-pressed={active}
            aria-label={item.ariaLabel}
            title={item.ariaLabel}
            onClick={() => onChange(item.value)}
          >
            {item.icon}
            <span className="hidden sm:inline">{item.label}</span>
          </Button>
        );
      })}
    </div>
  );
}

async function collectBatchEntriesFromFiles(files: File[]) {
  const entries: ZipSubtitleEntry[] = [];
  const unsupported: string[] = [];
  const archiveErrors: string[] = [];
  let index = 0;

  for (const file of files) {
    if (isArchiveFileName(file.name)) {
      let archiveEntries: ZipSubtitleEntry[] = [];
      try {
        archiveEntries = await extractSubtitleEntriesFromArchiveFile(file);
      } catch (error) {
        const errText = error instanceof Error ? error.message : String(error);
        archiveErrors.push(`${file.name} (${errText})`);
        continue;
      }

      if (archiveEntries.length === 0) {
        archiveErrors.push(`${file.name} (no subtitle files in archive)`);
        continue;
      }

      for (const entry of archiveEntries) {
        entries.push({
          id: `batch-${index}-${entry.id}`,
          path: `${file.name}/${entry.path}`,
          fileName: entry.fileName,
          size: entry.size,
          data: entry.data
        });
        index += 1;
      }
      continue;
    }

    if (isSubtitleFileName(file.name)) {
      const data = await file.arrayBuffer();
      entries.push({
        id: `batch-${index}-${file.name.toLowerCase()}`,
        path: file.name,
        fileName: file.name,
        size: data.byteLength,
        data
      });
      index += 1;
      continue;
    }

    unsupported.push(file.name);
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { entries, unsupported, archiveErrors };
}

const SUBTITLE_PREVIEW_CHAR_LIMIT = 100000;
const SUBTITLE_PREVIEW_ENCODINGS = ["utf-8", "utf-16le", "utf-16be", "gb18030", "big5"] as const;

function orderedSubtitlePreviewEncodings(bytes: Uint8Array) {
  const out: string[] = [];
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      out.push("utf-16le");
    } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      out.push("utf-16be");
    }
  }
  for (const encoding of SUBTITLE_PREVIEW_ENCODINGS) {
    if (!out.includes(encoding)) {
      out.push(encoding);
    }
  }
  return out;
}

function decodeSubtitleBytes(bytes: Uint8Array, encoding: string, fatal: boolean) {
  try {
    const decoder = new TextDecoder(encoding, { fatal });
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

function trimSubtitlePreviewText(text: string) {
  if (text.length <= SUBTITLE_PREVIEW_CHAR_LIMIT) {
    return { text, truncated: false };
  }
  return {
    text: text.slice(0, SUBTITLE_PREVIEW_CHAR_LIMIT),
    truncated: true
  };
}

function decodeSubtitlePreviewContent(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length === 0) {
    return { text: "", encoding: "utf-8", truncated: false };
  }

  for (const encoding of orderedSubtitlePreviewEncodings(bytes)) {
    const decoded = decodeSubtitleBytes(bytes, encoding, true);
    if (decoded === null) {
      continue;
    }
    const normalized = trimSubtitlePreviewText(decoded);
    return {
      text: normalized.text,
      encoding,
      truncated: normalized.truncated
    };
  }

  const fallback = decodeSubtitleBytes(bytes, "utf-8", false);
  if (fallback !== null) {
    const normalized = trimSubtitlePreviewText(fallback);
    return {
      text: normalized.text,
      encoding: "utf-8",
      truncated: normalized.truncated
    };
  }

  throw new Error("unable to decode subtitle content");
}

export function SubtitleManagerApp() {
  const { t } = useI18n();
  const {
    activeTab,
    movieQuery,
    tvQuery,
    movieVideos,
    tvSeriesRows,
    selectedTvSeries,
    sortedTvVideos,
    tvSeasonOptions,
    selectedTvSeason,
    selectedVideoIdByType,
    moviePager,
    tvPager,
    movieYearSortOrder,
    tvSeriesYearSortOrder,
    logs,
    scanStatus,
    directoryScan,
    loading,
    pending,
    uploading,
    uploadingMessage,
    message,
    switchTab,
    triggerScan,
    refreshActiveTab,
    loadMovieWorkspaceOnDemand,
    loadTvWorkspaceOnDemand,
    selectMovieVideo,
    selectTvVideo,
    selectTvDirectory,
    setMoviePage,
    setTvPage,
    toggleMovieYearSort,
    toggleTvSeriesYearSort,
    uploadSubtitle,
    replaceSubtitle,
    removeSubtitle,
    previewSubtitle,
    loadTvBatchCandidates,
    uploadBatchSubtitles,
    setMovieQuery,
    setTvQuery,
    setSelectedTvSeason,
    formatTime
  } = useSubtitleManager();

  const operationLocked = pending.scan || uploading || Boolean(pending.refreshTab);
  const scanPending = pending.scan;
  const refreshPending = pending.refreshTab === activeTab;

  const [movieManagerOpen, setMovieManagerOpen] = useState(false);
  const [tvManagerOpen, setTvManagerOpen] = useState(false);
  const [tvBatchOpen, setTvBatchOpen] = useState(false);
  const [pendingMovieUploadPick, setPendingMovieUploadPick] = useState(false);
  const [libraryViewMode, setLibraryViewMode] = useState<LibraryViewMode>(() => {
    if (typeof window === "undefined") {
      return "card";
    }
    try {
      const bootstrapView = window.__subtitleUiLibraryView;
      if (isLibraryViewMode(bootstrapView)) {
        return bootstrapView;
      }
      const storedView = window.localStorage.getItem(LIBRARY_VIEW_STORAGE_KEY);
      return isLibraryViewMode(storedView) ? storedView : "card";
    } catch {
      return "card";
    }
  });
  const movieDetailsRef = useRef<SubtitleDetailsPanelHandle | null>(null);

  const navItems: Array<{ key: ActiveTab; icon: React.ReactNode; label: string }> = [
    { key: "dashboard", icon: <LayoutDashboard className="h-5 w-5" />, label: t("nav.overview") },
    { key: "movie", icon: <Film className="h-5 w-5" />, label: t("nav.movie") },
    { key: "tv", icon: <Tv className="h-5 w-5" />, label: t("nav.tv") },
    { key: "logs", icon: <FileText className="h-5 w-5" />, label: t("nav.logs") }
  ];
  const activeTabLabel = navItems.find((item) => item.key === activeTab)?.label || activeTab;

  const selectedMovie = useMemo(() => {
    return movieVideos.find((video) => video.id === selectedVideoIdByType.movie) ?? null;
  }, [movieVideos, selectedVideoIdByType.movie]);

  const selectedTvVideo = useMemo(() => {
    return sortedTvVideos.find((video) => video.id === selectedVideoIdByType.tv) ?? null;
  }, [selectedVideoIdByType.tv, sortedTvVideos]);

  const showTvScanPrompt = useMemo(() => {
    const noSeries = tvSeriesRows.length === 0;
    const noScan = !(scanStatus?.lastFinishedAt) && !directoryScan.generatedAt;
    return noSeries && noScan;
  }, [directoryScan.generatedAt, scanStatus?.lastFinishedAt, tvSeriesRows.length]);

  const statusBadgeClass = useMemo(() => {
    if (scanPending) {
      return "border-amber-300/80 bg-amber-50 text-amber-800 dark:border-amber-800/80 dark:bg-amber-950/40 dark:text-amber-200";
    }
    if (refreshPending) {
      return "border-blue-300/80 bg-blue-50 text-blue-800 dark:border-blue-800/80 dark:bg-blue-950/40 dark:text-blue-200";
    }
    if (uploading) {
      return "border-primary/30 bg-primary/10 text-primary";
    }
    if (pending.tabSwitch || pending.bootstrapping || loading) {
      return "border-border bg-muted/60 text-muted-foreground";
    }
    return "border-emerald-300/80 bg-emerald-50 text-emerald-800 dark:border-emerald-800/80 dark:bg-emerald-950/40 dark:text-emerald-200";
  }, [loading, pending.bootstrapping, pending.tabSwitch, refreshPending, scanPending, uploading]);

  const statusBadgeText = scanPending
    ? t("status.scanningLibrary")
    : refreshPending
      ? t("status.refreshingTab", { tab: activeTabLabel })
      : uploading
        ? uploadingMessage || t("status.uploadingSubtitles")
        : pending.tabSwitch
          ? t("status.loadingWorkspace")
          : message || t("status.ready");

  function handleMovieSelect(video: Video) {
    selectMovieVideo(video);
  }

  function handleTvSelect(video: Video) {
    selectTvVideo(video);
  }

  function openMovieUploadPicker(video?: Video) {
    const targetVideo = video || selectedMovie;
    if (!targetVideo) return;
    selectMovieVideo(targetVideo);
    setPendingMovieUploadPick(true);
    setMovieManagerOpen(true);
    void loadMovieWorkspaceOnDemand();
  }

  function openMovieManager(video?: Video) {
    const targetVideo = video || selectedMovie;
    if (!targetVideo) return;
    selectMovieVideo(targetVideo);
    setMovieManagerOpen(true);
    void loadMovieWorkspaceOnDemand();
  }

  function openTvManager(series?: TvSeriesSummary) {
    const targetSeries = series || selectedTvSeries;
    if (!targetSeries) return;
    selectTvDirectory(targetSeries.path);
    setTvManagerOpen(true);
    void loadTvWorkspaceOnDemand(targetSeries.path);
  }

  function openTvBatchDialog(series?: TvSeriesSummary) {
    const targetSeries = series || selectedTvSeries;
    if (!targetSeries) return;
    selectTvDirectory(targetSeries.path);
    setTvBatchOpen(true);
    void loadTvWorkspaceOnDemand(targetSeries.path);
  }

  useEffect(() => {
    if (!movieManagerOpen || !pendingMovieUploadPick) {
      return;
    }

    const timer = window.setTimeout(() => {
      movieDetailsRef.current?.openUploadPicker();
      setPendingMovieUploadPick(false);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [movieManagerOpen, pendingMovieUploadPick]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(LIBRARY_VIEW_STORAGE_KEY, libraryViewMode);
      window.__subtitleUiLibraryView = libraryViewMode;
    } catch {
      window.__subtitleUiLibraryView = libraryViewMode;
    }
  }, [libraryViewMode]);

  return (
    <div className="relative h-full w-full px-3 py-3 md:px-6 md:py-5">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-20 -top-24 h-72 w-72 rounded-full bg-cyan-500/12 blur-3xl" />
        <div className="absolute -right-20 bottom-0 h-80 w-80 rounded-full bg-orange-500/12 blur-3xl" />
      </div>
      <div className="mx-auto grid h-full w-full max-w-[1620px] gap-4 lg:grid-cols-[268px_minmax(0,1fr)]">
        <Card className="animate-fade-in-up border border-border/75 bg-card/90 lg:h-full">
          <CardContent className="flex h-full flex-col gap-5 p-5">
            <div>
              <Image
                src="/icon.svg"
                alt=""
                aria-hidden
                width={56}
                height={56}
                className="mb-2 h-14 w-14 rounded-2xl border border-primary/25 bg-background/80 p-2 shadow-[0_14px_28px_-20px_rgba(8,145,178,0.85)]"
              />
              <p className="text-display text-sm font-semibold uppercase tracking-[0.26em] text-primary/80">Subtitle UI</p>
              <p className="mt-2 max-w-[22ch] text-xs leading-relaxed text-muted-foreground">{t("sidebar.tagline")}</p>
            </div>

            <div className="grid gap-1.5">
              {navItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={cn(
                    "group surface-transition flex items-center rounded-xl border px-3.5 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-60",
                    activeTab === item.key
                      ? "border-primary/45 bg-gradient-to-r from-primary/16 to-primary/8 text-foreground shadow-[0_14px_32px_-24px_hsl(var(--primary))]"
                      : "border-transparent text-muted-foreground hover:border-border/80 hover:bg-accent/70 hover:text-foreground"
                  )}
                  disabled={uploading || pending.tabSwitch}
                  onClick={() => void switchTab(item.key)}
                >
                  <span className="flex items-center gap-3 text-sm font-semibold">
                    <span className={cn("text-primary/70 group-hover:text-primary", activeTab === item.key && "text-primary")}>{item.icon}</span>
                    {item.label}
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-auto space-y-3">
              <Badge variant="outline" className={cn("surface-transition flex w-full items-center justify-center rounded-xl px-3 py-1.5 text-center text-xs", statusBadgeClass)}>
                {statusBadgeText}
              </Badge>
              <div className="flex items-center justify-center gap-2 rounded-xl border border-border/70 bg-background/65 p-1.5">
                <LocaleSelect />
                <ThemeModeSelect />
                <Button
                  type="button"
                  size="icon"
                  onClick={() => void triggerScan()}
                  disabled={operationLocked}
                  className="h-10 w-10 rounded-xl"
                  aria-label={scanPending ? t("sidebar.scanningMediaLibrary") : t("sidebar.scanMediaLibrary")}
                  title={scanPending ? t("sidebar.scanningMediaLibrary") : t("sidebar.scanMediaLibrary")}
                >
                  {scanPending ? <SpinnerIcon className="h-5 w-5" /> : <Search className="h-5 w-5" />}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => void refreshActiveTab()}
                  disabled={operationLocked}
                  className="h-10 w-10 rounded-xl"
                  aria-label={
                    refreshPending
                      ? t("sidebar.refreshingTab", { tab: activeTabLabel })
                      : t("sidebar.refreshTab", { tab: activeTabLabel })
                  }
                  title={
                    refreshPending
                      ? t("sidebar.refreshingTab", { tab: activeTabLabel })
                      : t("sidebar.refreshTab", { tab: activeTabLabel })
                  }
                >
                  {refreshPending ? <SpinnerIcon className="h-5 w-5" /> : <RefreshCw className="h-5 w-5" />}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="min-h-0 min-w-0 lg:flex lg:h-full lg:flex-col">
          <div key={activeTab} className="animate-fade-in-up min-h-0 rounded-2xl border border-border/65 bg-card/55 p-2 shadow-[0_24px_64px_-44px_rgba(15,23,42,0.7)] lg:flex-1">
            {activeTab === "dashboard" && (
              <div className="lg:h-full lg:overflow-auto lg:pr-1">
                <DashboardPanel
                  scanStatus={scanStatus}
                  directoryScan={directoryScan}
                  message={message}
                  logs={logs}
                  pending={pending}
                  formatTime={formatTime}
                />
              </div>
            )}

            {activeTab === "movie" && (
              <div className="min-h-[430px] lg:h-full">
                <MovieListPanel
                  query={movieQuery}
                  onQueryChange={setMovieQuery}
                  videos={movieVideos}
                  pager={moviePager}
                  viewMode={libraryViewMode}
                  yearSortOrder={movieYearSortOrder}
                  onToggleYearSort={toggleMovieYearSort}
                  onViewModeChange={setLibraryViewMode}
                  onSelectVideo={handleMovieSelect}
                  onSetPage={setMoviePage}
                  onOpenUploadPicker={openMovieUploadPicker}
                  onOpenManager={openMovieManager}
                  operationLocked={operationLocked}
                  pending={pending.movieList}
                  formatTime={formatTime}
                />
              </div>
            )}

            {activeTab === "tv" && (
              <div className="min-h-[520px] lg:h-full">
                <TvSeriesListPanel
                  query={tvQuery}
                  onQueryChange={setTvQuery}
                  rows={tvSeriesRows}
                  pager={tvPager}
                  viewMode={libraryViewMode}
                  yearSortOrder={tvSeriesYearSortOrder}
                  onSelectSeries={selectTvDirectory}
                  onSetPage={setTvPage}
                  onToggleYearSort={toggleTvSeriesYearSort}
                  onViewModeChange={setLibraryViewMode}
                  onOpenManager={openTvManager}
                  onOpenBatch={openTvBatchDialog}
                  operationLocked={operationLocked}
                  showScanPrompt={showTvScanPrompt}
                  onTriggerScan={triggerScan}
                  loading={scanPending}
                  pending={pending.tvSeriesList}
                  formatTime={formatTime}
                />
              </div>
            )}

            {activeTab === "logs" && (
              <div className="min-h-[420px] lg:h-full">
                <LogsPanel logs={logs} pending={pending.logs} formatTime={formatTime} />
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog
        open={movieManagerOpen}
        onOpenChange={(open) => {
          if (!open && uploading) {
            return;
          }
          setMovieManagerOpen(open);
          if (open) {
            void loadMovieWorkspaceOnDemand();
          }
        }}
      >
        <DialogContent className="flex h-[90vh] max-h-[90vh] w-[min(1100px,96vw)] max-w-none overflow-hidden p-0">
          <SubtitleDetailsPanel
            ref={movieDetailsRef}
            panelTitle={t("details.movieManagementTitle")}
            selectedVideo={selectedMovie}
            emptyText={t("details.movieEmpty")}
            showBack={false}
            onBack={() => {}}
            infoRows={[]}
            onUpload={uploadSubtitle}
            onReplace={replaceSubtitle}
            onRemove={removeSubtitle}
            onPreviewSubtitle={previewSubtitle}
            formatTime={formatTime}
            busy={operationLocked}
            uploading={uploading}
            uploadingMessage={uploadingMessage}
            subtitleAction={pending.subtitleAction}
            showSearchLinks={false}
            showUploadButton={false}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={tvManagerOpen}
        onOpenChange={(open) => {
          if (!open && uploading) {
            return;
          }
          setTvManagerOpen(open);
          if (open) {
            void loadTvWorkspaceOnDemand();
          }
        }}
      >
        <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none overflow-hidden rounded-none p-0 sm:h-[90vh] sm:max-h-[90vh] sm:w-[min(1280px,96vw)] sm:rounded-lg [&>button]:right-3 [&>button]:top-3 [&>button]:z-50">
          <TvSubtitleManagementPanel
            selectedSeries={selectedTvSeries}
            selectedSeason={selectedTvSeason}
            seasonOptions={tvSeasonOptions}
            videos={sortedTvVideos}
            selectedVideo={selectedTvVideo}
            selectedVideoId={selectedVideoIdByType.tv}
            onSelectVideo={handleTvSelect}
            onSeasonChange={setSelectedTvSeason}
            onUpload={uploadSubtitle}
            onReplace={replaceSubtitle}
            onRemove={removeSubtitle}
            onPreviewSubtitle={previewSubtitle}
            formatTime={formatTime}
            busy={operationLocked}
            uploading={uploading}
            uploadingMessage={uploadingMessage}
            episodesPending={pending.tvEpisodes}
            subtitleAction={pending.subtitleAction}
          />
        </DialogContent>
      </Dialog>

      <TvSeasonBatchUploadDialog
        open={tvBatchOpen}
        onOpenChange={(open) => {
          if (!open && uploading) {
            return;
          }
          setTvBatchOpen(open);
          if (open) {
            void loadTvWorkspaceOnDemand();
          }
        }}
        busy={operationLocked}
        uploading={uploading}
        uploadingMessage={uploadingMessage}
        onLoadBatchCandidates={loadTvBatchCandidates}
        onUploadBatch={uploadBatchSubtitles}
      />

      {uploading && <UploadBlockingOverlay message={uploadingMessage} />}
    </div>
  );
}

function DashboardPanel({
  scanStatus,
  directoryScan,
  message,
  logs,
  pending,
  formatTime
}: {
  scanStatus: ScanStatus | null;
  directoryScan: DirectoryScanResult;
  message: string;
  logs: OperationLog[];
  pending: UiPendingState;
  formatTime: (value: string | undefined | null) => string;
}) {
  const recentLogs = logs.slice(0, 8);
  const movieCount = directoryScan.movieCount || 0;
  const tvSeriesCount = directoryScan.tvSeriesCount || 0;
  const discoveredDirCount = movieCount + tvSeriesCount;
  const { t } = useI18n();

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <QuickStatCard
          icon={<Activity className="h-5 w-5" />}
          label={t("dashboard.lastScanVideos")}
          value={String(scanStatus?.videoCount ?? 0)}
          hint={scanStatus?.running ? t("dashboard.scanInProgress") : t("dashboard.scannerIdle")}
          tone="emerald"
          pending={pending.scan || pending.bootstrapping}
          className="animate-fade-in-up"
        />
        <QuickStatCard
          icon={<FolderTree className="h-5 w-5" />}
          label={t("dashboard.discoveredDirs")}
          value={String(discoveredDirCount)}
          hint={t("dashboard.movieTvCount", { movie: movieCount, tv: tvSeriesCount })}
          tone="blue"
          pending={pending.scan || pending.bootstrapping}
          className="animate-fade-in-up"
        />
        <QuickStatCard
          icon={<AlertTriangle className="h-5 w-5" />}
          label={t("dashboard.directoryWarnings")}
          value={String(directoryScan.errors.length)}
          hint={directoryScan.errors.length > 0 ? t("dashboard.needsReview") : t("dashboard.allClear")}
          tone={directoryScan.errors.length > 0 ? "rose" : "amber"}
          pending={pending.scan || pending.bootstrapping}
          className="animate-fade-in-up"
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.2fr_1fr]">
        <Card className="animate-fade-in-up border bg-card">
          <CardHeader className="p-4">
            <CardTitle className="text-lg">{t("dashboard.scanStatusTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0">
            <div className="rounded-lg border bg-muted/20 p-3 text-sm">
              <p role="status" aria-live="polite" className="font-medium">
                {message || t("status.ready")}
              </p>
              {pending.scan && <p className="mt-2"><InlinePending label={t("dashboard.scannerWorking")} /></p>}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("dashboard.directoryWarningsTitle")}</p>
              {directoryScan.errors.length > 0 ? (
                <ul className="space-y-2">
                  {directoryScan.errors.slice(0, 6).map((error) => (
                    <li key={error} className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-200">
                      {error}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">{t("dashboard.noDirectoryWarnings")}</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up border bg-card">
          <CardHeader className="flex flex-row items-center justify-between p-4">
            <CardTitle className="text-lg">{t("dashboard.recentOperationsTitle")}</CardTitle>
            <Badge variant="secondary">{pending.logs ? t("logs.refreshing") : t("dashboard.recentCount", { count: recentLogs.length })}</Badge>
          </CardHeader>
          <CardContent className="relative p-4 pt-0">
            <ScrollArea className={cn("h-[300px] rounded-md border bg-background", pending.logs && "animate-pulse-soft")}>
              <ul className="divide-y divide-border">
                {recentLogs.map((log) => (
                  <li key={log.id} className="animate-fade-in-up space-y-1 p-3 text-xs">
                    <p className="font-medium">{log.action}</p>
                    <p className="text-muted-foreground">{formatTime(log.timestamp)}</p>
                    <p className="break-all text-muted-foreground">{log.targetPath || "-"}</p>
                    <p className="text-muted-foreground">{t("dashboard.logStatus", { status: log.status })}</p>
                    {log.message && <p className="break-all text-muted-foreground">{t("dashboard.logDetails", { details: log.message })}</p>}
                  </li>
                ))}
                {recentLogs.length === 0 && (
                  <li className="p-6 text-center text-sm text-muted-foreground">{t("dashboard.logsEmpty")}</li>
                )}
              </ul>
            </ScrollArea>
            {pending.logs && <PanelLoadingOverlay label={t("logs.refreshing")} />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
function ThemeModeSelect({ disabled = false }: { disabled?: boolean }) {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const value = mounted ? theme || "system" : "system";
  const icon =
    value === "dark" ? <Moon className="h-5 w-5" /> : value === "light" ? <Sun className="h-5 w-5" /> : <Monitor className="h-5 w-5" />;

  return (
    <RowActionsMenu
      label={t("sidebar.changeTheme")}
      disabled={disabled}
      triggerIcon={icon}
      triggerClassName="h-10 w-10"
      menuDirection="up"
      items={[
        { label: t("theme.system"), onSelect: () => setTheme("system"), disabled: value === "system" },
        { label: t("theme.light"), onSelect: () => setTheme("light"), disabled: value === "light" },
        { label: t("theme.dark"), onSelect: () => setTheme("dark"), disabled: value === "dark" }
      ]}
    />
  );
}

function LocaleSelect() {
  const { locale, setLocale, t } = useI18n();

  return (
    <RowActionsMenu
      label={`${t("locale.label")}: ${locale === "en" ? t("locale.english") : t("locale.zh-CN")}`}
      triggerIcon={<Languages className="h-5 w-5" />}
      triggerClassName="h-10 w-10"
      menuDirection="up"
      items={[
        { label: t("locale.english"), onSelect: () => setLocale("en"), disabled: locale === "en" },
        { label: t("locale.zh-CN"), onSelect: () => setLocale("zh-CN"), disabled: locale === "zh-CN" }
      ]}
    />
  );
}

interface RowActionItem {
  label: string;
  href?: string;
  onSelect?: () => void;
  disabled?: boolean;
  external?: boolean;
}

function RowActionsMenu({
  label,
  items,
  triggerIcon,
  triggerClassName,
  menuDirection = "down",
  disabled = false
}: {
  label: string;
  items: RowActionItem[];
  triggerIcon?: React.ReactNode;
  triggerClassName?: string;
  menuDirection?: "up" | "down";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [withinDialog, setWithinDialog] = useState(false);
  const [resolvedDirection, setResolvedDirection] = useState<"up" | "down">(menuDirection);
  const [menuMaxHeight, setMenuMaxHeight] = useState(240);
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    width: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!containerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (disabled && open) {
      setOpen(false);
    }
  }, [disabled, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function updateMenuPlacement() {
      const triggerRect = triggerRef.current?.getBoundingClientRect();
      if (!triggerRect) {
        return;
      }
      const isWithinDialog = Boolean(
        containerRef.current?.closest("[data-dialog-content='true'],[data-alert-dialog-content='true']")
      );
      setWithinDialog(isWithinDialog);

      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const margin = 12;
      const gap = 6;
      const minPreferredHeight = 150;
      const spaceAbove = Math.max(0, triggerRect.top - margin);
      const spaceBelow = Math.max(0, viewportHeight - triggerRect.bottom - margin);

      let nextDirection = menuDirection;
      if (nextDirection === "up" && spaceAbove < minPreferredHeight && spaceBelow > spaceAbove) {
        nextDirection = "down";
      }
      if (nextDirection === "down" && spaceBelow < minPreferredHeight && spaceAbove > spaceBelow) {
        nextDirection = "up";
      }

      const targetSpace = nextDirection === "up" ? spaceAbove : spaceBelow;
      const menuWidth = Math.min(
        Math.max(210, triggerRect.width, menuRef.current?.offsetWidth ?? 0),
        Math.max(210, viewportWidth - margin * 2)
      );
      const left = Math.min(
        Math.max(triggerRect.right - menuWidth, margin),
        viewportWidth - menuWidth - margin
      );
      const maxHeight = Math.max(120, Math.floor(targetSpace - gap));
      const top = nextDirection === "down" ? Math.max(margin, triggerRect.bottom + gap) : undefined;
      const bottom = nextDirection === "up" ? Math.max(margin, viewportHeight - triggerRect.top + gap) : undefined;

      setResolvedDirection(nextDirection);
      setMenuMaxHeight(maxHeight);
      setMenuPosition({
        left,
        top,
        bottom,
        width: menuWidth
      });
    }

    updateMenuPlacement();
    const raf = window.requestAnimationFrame(updateMenuPlacement);
    window.addEventListener("resize", updateMenuPlacement);
    window.addEventListener("scroll", updateMenuPlacement, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", updateMenuPlacement);
      window.removeEventListener("scroll", updateMenuPlacement, true);
    };
  }, [open, menuDirection, items.length]);

  const menuItems = items.map((item, index) => {
    const showDivider = item.external && index > 0 && !items[index - 1]?.external;
    if (item.href && !item.disabled) {
      return (
        <a
          key={item.label}
          href={item.href}
          target={item.external ? "_blank" : undefined}
          rel={item.external ? "noreferrer" : undefined}
          className={cn(
            "surface-transition flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-[13px] font-medium text-popover-foreground hover:bg-accent/90 hover:text-accent-foreground",
            showDivider && "mt-1 border-t border-border/80 pt-3"
          )}
          onClick={() => setOpen(false)}
        >
          <span>{item.label}</span>
          {item.external && <ExternalLink className="h-4 w-4 text-popover-foreground/70" />}
        </a>
      );
    }

    return (
      <button
        key={item.label}
        type="button"
        role="menuitem"
        disabled={item.disabled}
        className={cn(
          "surface-transition flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-[13px] font-medium text-popover-foreground hover:bg-accent/90 hover:text-accent-foreground disabled:cursor-not-allowed disabled:text-muted-foreground disabled:opacity-60",
          showDivider && "mt-1 border-t border-border/80 pt-3"
        )}
        onClick={() => {
          if (item.disabled) {
            return;
          }
          setOpen(false);
          item.onSelect?.();
        }}
      >
        <span>{item.label}</span>
      </button>
    );
  });

  const inlineMenu = open && withinDialog ? (
    <div
      ref={menuRef}
      role="menu"
      style={{ maxHeight: `${menuMaxHeight}px` }}
      className={cn(
        "animate-fade-in-fast absolute right-0 z-[90] min-w-[210px] overflow-y-auto overscroll-contain rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-[0_24px_48px_-24px_rgba(15,23,42,0.45)]",
        resolvedDirection === "up" ? "bottom-full mb-1" : "top-full mt-1"
      )}
    >
      {menuItems}
    </div>
  ) : null;

  const portalMenu = open && !withinDialog && menuPosition ? (
    <div
      ref={menuRef}
      role="menu"
      style={{
        left: `${menuPosition.left}px`,
        width: `${menuPosition.width}px`,
        maxHeight: `${menuMaxHeight}px`,
        top: menuPosition.top !== undefined ? `${menuPosition.top}px` : undefined,
        bottom: menuPosition.bottom !== undefined ? `${menuPosition.bottom}px` : undefined
      }}
      className={cn(
        "animate-fade-in-fast fixed z-[130] min-w-[210px] overflow-y-auto overscroll-contain rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-[0_24px_48px_-24px_rgba(15,23,42,0.45)]",
        resolvedDirection === "up" ? "origin-bottom-right" : "origin-top-right"
      )}
    >
      {menuItems}
    </div>
  ) : null;

  return (
    <div
      ref={containerRef}
      className="relative flex justify-end"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <Button
        type="button"
        variant="outline"
        size="icon"
        ref={triggerRef}
        className={cn("h-9 w-9 rounded-xl", triggerClassName)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
      >
        {triggerIcon ?? <MoreHorizontal className="h-4 w-4" />}
      </Button>
      {inlineMenu}
      {mounted && portalMenu ? createPortal(portalMenu, document.body) : null}
    </div>
  );
}

interface MovieListPanelProps {
  query: string;
  onQueryChange: (value: string) => void;
  videos: Video[];
  pager: Pager;
  viewMode: LibraryViewMode;
  yearSortOrder: "asc" | "desc";
  onToggleYearSort: () => void;
  onViewModeChange: (value: LibraryViewMode) => void;
  onSelectVideo: (video: Video) => void;
  onSetPage: (page: number) => void;
  onOpenUploadPicker: (video: Video) => void;
  onOpenManager: (video: Video) => void;
  operationLocked: boolean;
  pending: boolean;
  formatTime: (value: string | undefined | null) => string;
}

function MoviePosterCard({
  video,
  onSelectVideo,
  onOpenUploadPicker,
  onOpenManager,
  operationLocked
}: {
  video: Video;
  onSelectVideo: (video: Video) => void;
  onOpenUploadPicker: (video: Video) => void;
  onOpenManager: (video: Video) => void;
  operationLocked: boolean;
}) {
  const { t } = useI18n();
  const links = buildSubtitleSearchLinks(video);

  return (
    <div
      className="relative flex w-full self-start flex-col rounded-[1.35rem] border border-border/70 bg-card shadow-sm"
    >
      <div className="absolute right-3 top-3 z-10">
        <RowActionsMenu
          label={t("movie.actionsFor", { name: video.title || video.fileName || t("info.movie") })}
          triggerClassName="h-8 w-8 rounded-lg border-border bg-popover text-popover-foreground shadow-md hover:bg-popover hover:text-popover-foreground"
          items={[
            {
              label: t("movie.uploadSubtitleArchive"),
              onSelect: () => onOpenUploadPicker(video),
              disabled: operationLocked
            },
            {
              label: t("movie.openSubtitleManager"),
              onSelect: () => onOpenManager(video),
              disabled: operationLocked
            },
            { label: "Zimuku", href: links.zimuku, external: true },
            { label: "SubHD", href: links.subhd, external: true }
          ]}
        />
      </div>

      <button
        type="button"
        className="flex flex-col text-left"
        aria-label={video.title || video.fileName || t("info.movie")}
        onClick={() => onSelectVideo(video)}
      >
        <div className="p-3 pb-0">
          <PosterThumbnail
            src={video.posterUrl}
            className="aspect-[2/3] w-full rounded-[1.1rem]"
            imageClassName="h-full w-full"
            sizes="(min-width: 1024px) 18vw, (min-width: 640px) 44vw, 92vw"
          />
        </div>
        <div className="flex items-start gap-3 p-3">
          <p className="line-clamp-2 min-w-0 flex-1 text-base font-semibold leading-6 text-foreground">
            {video.title || video.fileName || "-"}
          </p>
          <span className="shrink-0 pt-0.5 text-xs font-medium text-muted-foreground">{video.year || "-"}</span>
        </div>
      </button>
    </div>
  );
}

function MovieListPanel({
  query,
  onQueryChange,
  videos,
  pager,
  viewMode,
  yearSortOrder,
  onToggleYearSort,
  onViewModeChange,
  onSelectVideo,
  onSetPage,
  onOpenUploadPicker,
  onOpenManager,
  operationLocked,
  pending,
  formatTime
}: MovieListPanelProps) {
  const { t } = useI18n();
  return (
    <Card className="animate-fade-in-up flex h-full flex-col border bg-card">
      <CardHeader className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-lg">{t("movie.listTitle")}</CardTitle>
          <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap">
            <Input
              className="h-9 w-full min-w-0 sm:w-[240px]"
              value={query}
              aria-label={t("movie.filterAria")}
              placeholder={t("movie.filterPlaceholder")}
              onChange={(event) => onQueryChange(event.target.value)}
            />
            {viewMode === "card" && (
              <Button type="button" variant="outline" size="sm" className="h-9 gap-2 px-3" onClick={onToggleYearSort}>
                {t("info.year")}
                <span className="text-[10px]">{yearSortOrder === "desc" ? "↓" : "↑"}</span>
              </Button>
            )}
            <LibraryViewToggle value={viewMode} onChange={onViewModeChange} />
          </div>
        </div>
        {pending && <InlinePending label={t("movie.updatingResults")} />}
      </CardHeader>

      <CardContent className="relative flex min-h-0 flex-1 flex-col gap-3 p-4 pt-0">
        <ScrollArea className={cn("min-h-0 flex-1 rounded-md border bg-background", pending && "animate-pulse-soft")}>
          {viewMode === "list" ? (
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[76px]">{t("info.poster")}</TableHead>
                  <TableHead>{t("info.title")}</TableHead>
                  <TableHead className="w-[90px]">
                    <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={onToggleYearSort}>
                      {t("info.year")}
                      <span className="text-[10px]">{yearSortOrder === "desc" ? "↓" : "↑"}</span>
                    </button>
                  </TableHead>
                  <TableHead className="w-[170px]">{t("movie.updatedTime")}</TableHead>
                  <TableHead className="w-[100px] text-right">{t("movie.subtitles")}</TableHead>
                  <TableHead className="w-[360px]">{t("movie.fileName")}</TableHead>
                  <TableHead className="w-[120px] text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {videos.map((video) => {
                  const links = buildSubtitleSearchLinks(video);
                  return (
                    <TableRow
                      key={video.id}
                      className="surface-transition cursor-pointer hover:bg-accent"
                      onClick={() => onSelectVideo(video)}
                    >
                      <TableCell className="w-[76px] py-2">
                        <PosterThumbnail src={video.posterUrl} />
                      </TableCell>
                      <TableCell className="max-w-[240px] truncate font-medium" title={video.title}>
                        {video.title || "-"}
                      </TableCell>
                      <TableCell>{video.year || "-"}</TableCell>
                      <TableCell>{formatTime(video.updatedAt)}</TableCell>
                      <TableCell className="text-right">{video.subtitles.length}</TableCell>
                      <TableCell className="max-w-[360px] truncate" title={video.fileName}>
                        {video.fileName || "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <RowActionsMenu
                          label={t("movie.actionsFor", { name: video.title || video.fileName || t("info.movie") })}
                          items={[
                            {
                              label: t("movie.uploadSubtitleArchive"),
                              onSelect: () => onOpenUploadPicker(video),
                              disabled: operationLocked
                            },
                            {
                              label: t("movie.openSubtitleManager"),
                              onSelect: () => onOpenManager(video),
                              disabled: operationLocked
                            },
                            { label: "Zimuku", href: links.zimuku, external: true },
                            { label: "SubHD", href: links.subhd, external: true }
                          ]}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}

                {videos.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      {t("movie.empty")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          ) : videos.length === 0 ? (
            <div className="flex min-h-[320px] items-center justify-center p-6 text-center text-sm text-muted-foreground">
              {t("movie.empty")}
            </div>
          ) : (
            <div className="p-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                {videos.map((video) => (
                  <MoviePosterCard
                    key={video.id}
                    video={video}
                    onSelectVideo={onSelectVideo}
                    onOpenUploadPicker={onOpenUploadPicker}
                    onOpenManager={onOpenManager}
                    operationLocked={operationLocked}
                  />
                ))}
              </div>
            </div>
          )}
        </ScrollArea>
        {pending && <PanelLoadingOverlay label={t("movie.updatingResults")} />}

        <PagerView pager={pager} onSetPage={onSetPage} disabled={pending} />
      </CardContent>
    </Card>
  );
}

interface TvSeriesListPanelProps {
  query: string;
  onQueryChange: (value: string) => void;
  rows: TvSeriesSummary[];
  pager: Pager;
  viewMode: LibraryViewMode;
  yearSortOrder: "asc" | "desc";
  onSelectSeries: (path: string) => void;
  onSetPage: (page: number) => void;
  onToggleYearSort: () => void;
  onViewModeChange: (value: LibraryViewMode) => void;
  onOpenManager: (series: TvSeriesSummary) => void;
  onOpenBatch: (series: TvSeriesSummary) => void;
  operationLocked: boolean;
  showScanPrompt: boolean;
  onTriggerScan: () => void;
  loading: boolean;
  pending: boolean;
  formatTime: (value: string | undefined | null) => string;
}

function TvSeriesPosterCard({
  row,
  onSelectSeries,
  onOpenManager,
  onOpenBatch,
  operationLocked
}: {
  row: TvSeriesSummary;
  onSelectSeries: (path: string) => void;
  onOpenManager: (series: TvSeriesSummary) => void;
  onOpenBatch: (series: TvSeriesSummary) => void;
  operationLocked: boolean;
}) {
  const { t } = useI18n();
  const links = buildSubtitleSearchLinksByKeyword(row.title);

  return (
    <div
      className="relative flex w-full self-start flex-col rounded-[1.35rem] border border-border/70 bg-card shadow-sm"
    >
      <div className="absolute right-3 top-3 z-10">
        <RowActionsMenu
          label={t("tv.actionsFor", { name: row.title || t("nav.tv") })}
          triggerClassName="h-8 w-8 rounded-lg border-border bg-popover text-popover-foreground shadow-md hover:bg-popover hover:text-popover-foreground"
          items={[
            {
              label: t("tv.seasonBatchUpload"),
              onSelect: () => onOpenBatch(row),
              disabled: operationLocked
            },
            {
              label: t("tv.openSubtitleManager"),
              onSelect: () => onOpenManager(row),
              disabled: operationLocked
            },
            { label: "Zimuku", href: links.zimuku, external: true },
            { label: "SubHD", href: links.subhd, external: true }
          ]}
        />
      </div>

      <button
        type="button"
        className="flex flex-col text-left"
        aria-label={row.title || t("nav.tv")}
        onClick={() => onSelectSeries(row.path)}
      >
        <div className="p-3 pb-0">
          <PosterThumbnail
            src={row.posterUrl}
            className="aspect-[2/3] w-full rounded-[1.1rem]"
            imageClassName="h-full w-full"
            sizes="(min-width: 1024px) 18vw, (min-width: 640px) 44vw, 92vw"
          />
        </div>
        <div className="flex items-start gap-3 p-3">
          <p className="line-clamp-2 min-w-0 flex-1 text-base font-semibold leading-6 text-foreground">
            {row.title || "-"}
          </p>
          <span className="shrink-0 pt-0.5 text-xs font-medium text-muted-foreground">{row.latestEpisodeYear || "-"}</span>
        </div>
      </button>
    </div>
  );
}

function TvSeriesListPanel({
  query,
  onQueryChange,
  rows,
  pager,
  viewMode,
  yearSortOrder,
  onSelectSeries,
  onSetPage,
  onToggleYearSort,
  onViewModeChange,
  onOpenManager,
  onOpenBatch,
  operationLocked,
  showScanPrompt,
  onTriggerScan,
  loading,
  pending,
  formatTime
}: TvSeriesListPanelProps) {
  const { t } = useI18n();
  return (
    <Card className="animate-fade-in-up flex h-full flex-col border bg-card">
      <CardHeader className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-lg">{t("tv.listTitle")}</CardTitle>
          <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap">
            <Input
              className="h-9 w-full min-w-0 sm:w-[240px]"
              value={query}
              aria-label={t("tv.filterAria")}
              placeholder={t("tv.filterPlaceholder")}
              onChange={(event) => onQueryChange(event.target.value)}
            />
            {viewMode === "card" && (
              <Button type="button" variant="outline" size="sm" className="h-9 gap-2 px-3" onClick={onToggleYearSort}>
                {t("tv.latestYear")}
                <span className="text-[10px]">{yearSortOrder === "desc" ? "↓" : "↑"}</span>
              </Button>
            )}
            <LibraryViewToggle value={viewMode} onChange={onViewModeChange} />
          </div>
        </div>
        {pending && <InlinePending label={t("tv.updatingResults")} />}
      </CardHeader>

      <CardContent className="relative flex min-h-0 flex-1 flex-col gap-3 p-4 pt-0">
        <ScrollArea className={cn("min-h-0 flex-1 rounded-md border bg-background", pending && "animate-pulse-soft")}>
          {viewMode === "list" ? (
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[76px]">{t("info.poster")}</TableHead>
                  <TableHead>{t("info.title")}</TableHead>
                  <TableHead className="w-[110px]">
                    <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={onToggleYearSort}>
                      {t("tv.latestYear")}
                      <span className="text-[10px]">{yearSortOrder === "desc" ? "↓" : "↑"}</span>
                    </button>
                  </TableHead>
                  <TableHead className="w-[170px]">{t("movie.updatedTime")}</TableHead>
                  <TableHead className="w-[100px] text-right">{t("tv.videos")}</TableHead>
                  <TableHead className="w-[120px] text-right">{t("tv.noSubtitles")}</TableHead>
                  <TableHead className="w-[120px] text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const links = buildSubtitleSearchLinksByKeyword(row.title);
                  return (
                    <TableRow
                      key={row.key}
                      className="surface-transition cursor-pointer hover:bg-accent"
                      onClick={() => onSelectSeries(row.path)}
                    >
                      <TableCell className="w-[76px] py-2">
                        <PosterThumbnail src={row.posterUrl} />
                      </TableCell>
                      <TableCell className="max-w-[240px] truncate font-medium" title={row.title}>
                        {row.title || "-"}
                      </TableCell>
                      <TableCell>{row.latestEpisodeYear || "-"}</TableCell>
                      <TableCell className="truncate" title={formatTime(row.updatedAt)}>{formatTime(row.updatedAt)}</TableCell>
                      <TableCell className="text-right">{row.videoCount}</TableCell>
                      <TableCell className="text-right">{row.noSubtitleCount}</TableCell>
                      <TableCell className="text-right">
                        <RowActionsMenu
                          label={t("tv.actionsFor", { name: row.title || t("nav.tv") })}
                          items={[
                            {
                              label: t("tv.seasonBatchUpload"),
                              onSelect: () => onOpenBatch(row),
                              disabled: operationLocked
                            },
                            {
                              label: t("tv.openSubtitleManager"),
                              onSelect: () => onOpenManager(row),
                              disabled: operationLocked
                            },
                            { label: "Zimuku", href: links.zimuku, external: true },
                            { label: "SubHD", href: links.subhd, external: true }
                          ]}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}

                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      {showScanPrompt ? (
                        <div className="flex flex-col items-center gap-3 text-center">
                          <p className="max-w-[320px] text-sm text-muted-foreground">
                            {t("tv.scanPrompt")}
                          </p>
                          <Button type="button" variant="outline" className="gap-2" onClick={() => void onTriggerScan()} disabled={loading}>
                            <Search className="h-4 w-4" />
                            {t("tv.scanMediaLibrary")}
                          </Button>
                        </div>
                      ) : (
                        t("tv.empty")
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          ) : rows.length === 0 ? (
            <div className="flex min-h-[320px] items-center justify-center p-6 text-center text-sm text-muted-foreground">
              {showScanPrompt ? (
                <div className="flex flex-col items-center gap-3 text-center">
                  <p className="max-w-[320px] text-sm text-muted-foreground">
                    {t("tv.scanPrompt")}
                  </p>
                  <Button type="button" variant="outline" className="gap-2" onClick={() => void onTriggerScan()} disabled={loading}>
                    <Search className="h-4 w-4" />
                    {t("tv.scanMediaLibrary")}
                  </Button>
                </div>
              ) : (
                t("tv.empty")
              )}
            </div>
          ) : (
            <div className="p-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                {rows.map((row) => (
                  <TvSeriesPosterCard
                    key={row.key}
                    row={row}
                    onSelectSeries={onSelectSeries}
                    onOpenManager={onOpenManager}
                    onOpenBatch={onOpenBatch}
                    operationLocked={operationLocked}
                  />
                ))}
              </div>
            </div>
          )}
        </ScrollArea>
        {pending && <PanelLoadingOverlay label={t("tv.refreshingSeries")} />}

        <PagerView pager={pager} onSetPage={onSetPage} disabled={pending} />
      </CardContent>
    </Card>
  );
}

interface TvSeasonBatchUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  uploading: boolean;
  uploadingMessage: string;
  onLoadBatchCandidates: () => Promise<Video[]>;
  onUploadBatch: (items: BatchSubtitleUploadItem[]) => Promise<BatchSubtitleUploadResult>;
}

function TvSeasonBatchUploadDialog({
  open,
  onOpenChange,
  busy,
  uploading,
  uploadingMessage,
  onLoadBatchCandidates,
  onUploadBatch
}: TvSeasonBatchUploadDialogProps) {
  const { t } = useI18n();
  const batchInputRef = useRef<HTMLInputElement | null>(null);
  const [batchPreparing, setBatchPreparing] = useState(false);
  const [batchSourceSummary, setBatchSourceSummary] = useState("");
  const [batchRawEntries, setBatchRawEntries] = useState<ZipSubtitleEntry[]>([]);
  const [batchRows, setBatchRows] = useState<SeasonBatchMappingRow[]>([]);
  const [batchCandidates, setBatchCandidates] = useState<Video[]>([]);
  const [batchLanguagePreference, setBatchLanguagePreference] = useState<BatchLanguagePreference>("any");
  const [batchFormatPreference, setBatchFormatPreference] = useState("any");
  const [batchPreferenceSummary, setBatchPreferenceSummary] = useState("");
  const [batchLabel, setBatchLabel] = useState("zh");
  const [batchError, setBatchError] = useState("");
  const [batchResult, setBatchResult] = useState<BatchSubtitleUploadResult | null>(null);

  const batchPreferenceEntries = useMemo(() => {
    const archiveEntries = batchRawEntries.filter((entry) => /\.(zip|7z|rar)\//i.test(entry.path));
    return archiveEntries.length > 0 ? archiveEntries : batchRawEntries;
  }, [batchRawEntries]);

  const batchLanguageOptions = useMemo(() => getLanguageTypesFromEntries(batchPreferenceEntries), [batchPreferenceEntries]);
  const batchFormatOptions = useMemo(() => {
    return getSubtitleFormatsFromEntries(batchPreferenceEntries);
  }, [batchPreferenceEntries]);
  const showBatchLanguageSelector = batchLanguageOptions.length > 1;
  const showBatchFormatSelector = batchFormatOptions.length > 1;

  function resetBatchState() {
    setBatchPreparing(false);
    setBatchSourceSummary("");
    setBatchRawEntries([]);
    setBatchRows([]);
    setBatchCandidates([]);
    setBatchLanguagePreference("any");
    setBatchFormatPreference("any");
    setBatchPreferenceSummary("");
    setBatchLabel("zh");
    setBatchError("");
    setBatchResult(null);
  }

  useEffect(() => {
    if (!open) {
      resetBatchState();
    }
  }, [open]);

  useEffect(() => {
    if (batchLanguageOptions.length <= 1) {
      if (batchLanguagePreference !== "any") {
        setBatchLanguagePreference("any");
      }
      return;
    }

    if (batchLanguagePreference === "any" || !batchLanguageOptions.includes(batchLanguagePreference)) {
      setBatchLanguagePreference(batchLanguageOptions[0]);
    }
  }, [batchLanguageOptions, batchLanguagePreference]);

  useEffect(() => {
    if (batchFormatOptions.length <= 1) {
      if (batchFormatPreference !== "any") {
        setBatchFormatPreference("any");
      }
      return;
    }

    const normalized = normalizeSubtitleFormat(batchFormatPreference);
    if (batchFormatPreference === "any" || !batchFormatOptions.includes(normalized)) {
      setBatchFormatPreference(batchFormatOptions[0]);
      return;
    }

    if (normalized !== batchFormatPreference) {
      setBatchFormatPreference(normalized);
    }
  }, [batchFormatOptions, batchFormatPreference]);

  useEffect(() => {
    if (batchCandidates.length === 0 || batchRawEntries.length === 0) {
      setBatchRows([]);
      setBatchPreferenceSummary("");
      return;
    }

    const effectiveLanguagePreference = showBatchLanguageSelector ? batchLanguagePreference : "any";
    const effectiveFormatPreference = showBatchFormatSelector ? normalizeSubtitleFormat(batchFormatPreference) : "any";

    const preferred = applyBatchEntryPreferences(batchRawEntries, effectiveLanguagePreference, effectiveFormatPreference);
    const rows = buildSeasonBatchRows(batchCandidates, preferred.entries);
    setBatchRows(rows);

    const summaryParts: string[] = [];
    if (showBatchLanguageSelector && effectiveLanguagePreference !== "any") {
      summaryParts.push(t("batch.preference.language", { value: formatLanguageTypeLabel(effectiveLanguagePreference, t) }));
    }
    if (showBatchFormatSelector && effectiveFormatPreference !== "any") {
      summaryParts.push(t("batch.preference.format", { value: formatSubtitleExtLabel(effectiveFormatPreference) }));
    }
    summaryParts.push(t("batch.preference.duplicateGroups", { count: preferred.duplicateGroups }));
    const reducedHint =
      preferred.reducedCount > 0
        ? ` | ${t("batch.preference.reduced", { count: preferred.reducedCount })}`
        : "";
    setBatchPreferenceSummary(`${summaryParts.join(" | ")}${reducedHint}`);
  }, [
    batchCandidates,
    batchRawEntries,
    batchLanguagePreference,
    batchFormatPreference,
    showBatchLanguageSelector,
    showBatchFormatSelector,
    t
  ]);

  async function onBatchFilesSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) {
      return;
    }

    setBatchPreparing(true);
    setBatchError("");
    setBatchResult(null);
    setBatchRows([]);
    setBatchRawEntries([]);
    setBatchCandidates([]);
    setBatchSourceSummary("");
    setBatchPreferenceSummary("");
    setBatchLanguagePreference("any");
    setBatchFormatPreference("any");

    try {
      const candidates = await onLoadBatchCandidates();
      if (candidates.length === 0) {
        setBatchError(t("batch.noEpisodesAvailable"));
        return;
      }

      const { entries, unsupported, archiveErrors } = await collectBatchEntriesFromFiles(files);
      if (entries.length === 0) {
        const reasons: string[] = [];
        if (archiveErrors.length > 0) {
          reasons.push(t("batch.archiveErrors", { value: summarizeFileNames(archiveErrors, t) }));
        }
        if (unsupported.length > 0) {
          reasons.push(t("batch.unsupportedFiles", { value: summarizeFileNames(unsupported, t) }));
        }
        setBatchError(reasons.join(" | ") || t("batch.noSubtitleFiles"));
        setBatchSourceSummary("");
        setBatchRawEntries([]);
        setBatchCandidates(candidates);
        setBatchRows([]);
        return;
      }

      const notices: string[] = [];
      if (unsupported.length > 0) {
        notices.push(t("batch.ignoredUnsupported", { value: summarizeFileNames(unsupported, t) }));
      }
      if (archiveErrors.length > 0) {
        notices.push(t("batch.skippedArchives", { value: summarizeFileNames(archiveErrors, t) }));
      }
      if (notices.length > 0) {
        setBatchError(notices.join(" | "));
      }
      setBatchSourceSummary(summarizeBatchInputs(files, entries.length, t));
      setBatchRawEntries(entries);
      setBatchCandidates(candidates);
      emitToast({
        level: "info",
        title: t("toast.batchPreparedTitle"),
        message: t("toast.batchPreparedMessage", { count: entries.length }),
        detail: summarizeBatchInputs(files, entries.length, t)
      });
    } catch (error) {
      const errText = error instanceof Error ? error.message : String(error);
      setBatchError(t("batch.prepareFailed", { error: errText }));
      emitToast({
        level: "error",
        title: t("toast.batchPreparationFailedTitle"),
        message: errText
      });
    } finally {
      setBatchPreparing(false);
    }
  }

  async function submitSeasonBatch() {
    if (batchRows.length === 0 || batchCandidates.length === 0) {
      return;
    }

    const map = new Map(batchCandidates.map((video) => [video.id, video]));
    const label = batchLabel.trim();
    const items: BatchSubtitleUploadItem[] = [];
    for (const row of batchRows) {
      if (!row.selectedVideoId) {
        continue;
      }
      const matchedVideo = map.get(row.selectedVideoId);
      if (!matchedVideo) {
        continue;
      }
      items.push({
        video: matchedVideo,
        file: toSubtitleFile(row.entry),
        label,
        sourceName: row.entry.path
      });
    }

    if (items.length === 0) {
      setBatchError(t("batch.mapAtLeastOne"));
      return;
    }

    setBatchError("");
    const result = await onUploadBatch(items);
    setBatchResult(result);
  }

  const autoMatchedCount = batchRows.filter((row) => row.autoVideoId !== "").length;
  const mappedCount = batchRows.filter((row) => row.selectedVideoId !== "").length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[86vh] flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t("batch.dialogTitle")}</DialogTitle>
          <DialogDescription>
            {t("batch.dialogDescription", {
              summary: batchSourceSummary || "-",
              autoMatched: autoMatchedCount,
              total: batchRows.length,
              selected: mappedCount
            })}
          </DialogDescription>
        </DialogHeader>

        <input
          ref={batchInputRef}
          type="file"
          accept=".zip,.7z,.rar,.srt,.ass,.ssa,.vtt,.sub"
          multiple
          className="hidden"
          onChange={(event) => {
            void onBatchFilesSelected(event);
          }}
        />

        <div className="relative min-h-0 flex-1 space-y-4 overflow-auto pr-1">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy || batchPreparing}
              onClick={() => batchInputRef.current?.click()}
            >
              {t("batch.selectFiles")}
            </Button>
            <span className="text-xs text-muted-foreground">
              {t("batch.supportHint")}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("batch.duplicateHint")}
            </span>
            {batchError && <p className="text-xs text-rose-600">{batchError}</p>}
            {batchPreparing && <InlinePending label={t("batch.preparing")} />}
            {uploading && <InlinePending label={uploadingMessage || t("batch.uploadingMapped")} />}
          </div>

          {(showBatchLanguageSelector || showBatchFormatSelector || batchPreferenceSummary) && (
            <div className="flex flex-wrap items-center gap-2">
              {showBatchLanguageSelector && (
                <>
                  <span className="text-xs font-medium text-muted-foreground">{t("batch.languageType")}</span>
                  <Select
                    value={batchLanguagePreference === "any" ? batchLanguageOptions[0] : batchLanguagePreference}
                    onValueChange={(value) => setBatchLanguagePreference(value as BatchLanguagePreference)}
                  >
                    <SelectTrigger className="h-9 w-[220px]">
                      <SelectValue placeholder={t("batch.languageTypePlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {batchLanguageOptions.map((item) => (
                        <SelectItem key={item} value={item}>
                          {formatLanguageTypeLabel(item, t)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}

              {showBatchFormatSelector && (
                <>
                  <span className="text-xs font-medium text-muted-foreground">{t("batch.format")}</span>
                  <Select
                    value={batchFormatPreference === "any" ? batchFormatOptions[0] : batchFormatPreference}
                    onValueChange={(value) => setBatchFormatPreference(normalizeSubtitleFormat(value))}
                  >
                    <SelectTrigger className="h-9 w-[150px]">
                      <SelectValue placeholder={t("batch.format")} />
                    </SelectTrigger>
                    <SelectContent>
                      {batchFormatOptions.map((ext) => (
                        <SelectItem key={ext} value={ext}>
                          {formatSubtitleExtLabel(ext)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}

              {batchPreferenceSummary && <span className="text-xs text-muted-foreground">{batchPreferenceSummary}</span>}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">{t("batch.label")}</span>
            <Input
              className="w-[140px]"
              value={batchLabel}
              maxLength={32}
              placeholder="zh"
              onChange={(event) => setBatchLabel(event.target.value)}
            />
            <span className="text-xs text-muted-foreground">
              {t("batch.labelHint")}
            </span>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold">{t("batch.mappingTitle")}</p>
            <div className={cn("max-h-[52vh] overflow-auto rounded-md border", batchPreparing && "animate-pulse-soft")}>
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50%]">{t("batch.subtitleFile")}</TableHead>
                    <TableHead className="w-[120px]">{t("batch.parsed")}</TableHead>
                    <TableHead className="w-[360px]">{t("batch.targetEpisode")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batchRows.map((row) => {
                    const candidates = candidateVideosForBatchRow(row, batchCandidates);
                    const selectValue = row.selectedVideoId || "__UNASSIGNED__";
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="break-all text-xs">{row.entry.path}</TableCell>
                        <TableCell className="text-xs">{formatSeasonEpisodeText(row.season, row.episode)}</TableCell>
                        <TableCell className="align-top">
                          <Select
                            value={selectValue}
                            onValueChange={(value) => {
                              setBatchRows((prev) =>
                                prev.map((item) =>
                                  item.id === row.id
                                    ? {
                                        ...item,
                                        selectedVideoId: value === "__UNASSIGNED__" ? "" : value
                                      }
                                    : item
                                )
                              );
                            }}
                          >
                            <SelectTrigger className="h-9 w-full">
                              <SelectValue placeholder={t("batch.chooseEpisode")} />
                            </SelectTrigger>
                            <SelectContent className="max-h-72">
                              <SelectItem value="__UNASSIGNED__">{t("batch.skip")}</SelectItem>
                              {candidates.map((video) => (
                                <SelectItem key={`${row.id}-${video.id}`} value={video.id}>
                                  {video.fileName}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {batchRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                        {t("batch.empty")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {batchResult && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs">
              <p>
                {t("batch.result", {
                  success: batchResult.success,
                  total: batchResult.total,
                  failed: batchResult.failed
                })}
              </p>
              {batchResult.errors.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {batchResult.errors.slice(0, 8).map((item) => (
                    <li key={item} className="break-all">
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {batchPreparing && <PanelLoadingOverlay label={t("batch.preparing")} />}
        </div>

        <DialogFooter className="shrink-0 border-t pt-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
          <Button type="button" disabled={busy || batchPreparing || batchRows.length === 0} onClick={() => void submitSeasonBatch()}>
            {t("batch.uploadMapped")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface TvSubtitleManagementPanelProps {
  selectedSeries: TvSeriesSummary | null;
  selectedSeason: string;
  seasonOptions: TvSeasonOption[];
  videos: Video[];
  selectedVideo: Video | null;
  selectedVideoId: string;
  onSelectVideo: (video: Video) => void;
  onSeasonChange: (value: string) => void;
  onUpload: (video: Video, file: File, label: string) => Promise<boolean>;
  onReplace: (video: Video, subtitle: Subtitle, file: File) => Promise<boolean>;
  onRemove: (video: Video, subtitle: Subtitle) => Promise<boolean>;
  onPreviewSubtitle: (video: Video, subtitle: Subtitle) => Promise<ArrayBuffer>;
  formatTime: (value: string | undefined | null) => string;
  busy: boolean;
  uploading: boolean;
  uploadingMessage: string;
  episodesPending: boolean;
  subtitleAction: PendingSubtitleAction | null;
}

function TvSubtitleManagementPanel({
  selectedSeries,
  selectedSeason,
  seasonOptions,
  videos,
  selectedVideo,
  selectedVideoId,
  onSelectVideo,
  onSeasonChange,
  onUpload,
  onReplace,
  onRemove,
  onPreviewSubtitle,
  formatTime,
  busy,
  uploading,
  uploadingMessage,
  episodesPending,
  subtitleAction
}: TvSubtitleManagementPanelProps) {
  const { t } = useI18n();
  const [activeStep, setActiveStep] = useState<"episodes" | "subtitles">("episodes");
  const selectedSeasonLabel = seasonOptions.find((option) => option.value === selectedSeason)?.label || t("tv.allSeasons");
  const searchKeyword = useMemo(() => {
    if (!selectedVideo) {
      return "";
    }
    const parsed = parseVideoSeasonEpisode(selectedVideo);
    const series = (selectedSeries?.title || selectedVideo.title || "").trim();
    const episodeCode = parsed ? formatSeasonEpisodeText(parsed.season, parsed.episode) : "";
    return `${series} ${episodeCode}`.trim();
  }, [selectedSeries?.title, selectedVideo]);

  useEffect(() => {
    setActiveStep("episodes");
  }, [selectedSeries?.path]);

  function handleStepChange(value: string) {
    setActiveStep(value === "subtitles" ? "subtitles" : "episodes");
  }

  function handleEpisodeSelect(video: Video) {
    onSelectVideo(video);
    setActiveStep("subtitles");
  }

  return (
    <div className="flex h-full w-full min-h-0 flex-col gap-3 p-3 md:p-4">
      <Tabs value={activeStep} onValueChange={handleStepChange} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="grid h-9 w-full grid-cols-2 sm:max-w-[360px]">
          <TabsTrigger value="episodes" className="h-full">
            {t("tv.stepEpisodes")}
          </TabsTrigger>
          <TabsTrigger value="subtitles" className="h-full">
            {t("tv.stepSubtitles")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="episodes" className="mt-3 min-h-0 flex-1">
          <Card className="animate-fade-in-up flex h-full min-h-0 flex-col border bg-card">
            <CardHeader className="space-y-3 p-4">
              <CardTitle className="text-lg">{t("tv.episodesTitle")}</CardTitle>
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("tv.seriesLabel")}</p>
                <p className="truncate text-sm font-semibold">{selectedSeries?.title || "-"}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("tv.seasonLabel")}</p>
                <Select value={selectedSeason} onValueChange={onSeasonChange} disabled={!selectedSeries || busy || episodesPending}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder={t("tv.selectSeason")} />
                  </SelectTrigger>
                  <SelectContent>
                    {seasonOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {episodesPending && <InlinePending label={t("tv.loadingEpisodes")} />}
            </CardHeader>

            <CardContent className="relative min-h-0 flex-1 p-4 pt-0">
              <ScrollArea className={cn("h-full rounded-md border bg-background", episodesPending && "animate-pulse-soft")}>
                <ul className="space-y-2 p-2">
                  {videos.map((video) => {
                    const active = selectedVideoId === video.id;
                    const itemBusy = subtitleAction?.videoId === video.id;
                    const parsed = parseVideoSeasonEpisode(video);
                    const episodeCode = parsed ? formatSeasonEpisodeText(parsed.season, parsed.episode) : "-";
                    return (
                      <li key={video.id}>
                        <button
                          type="button"
                          onClick={() => handleEpisodeSelect(video)}
                          disabled={busy || episodesPending}
                          className={cn(
                            "surface-transition w-full rounded-md border px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-60",
                            active
                              ? "border-primary/70 bg-primary/10 shadow-[inset_3px_0_0_0_rgba(14,165,233,0.6)]"
                              : "border bg-background hover:bg-accent",
                            itemBusy && "animate-pulse-soft"
                          )}
                          aria-pressed={active}
                        >
                          <div className="text-xs font-semibold text-muted-foreground">{episodeCode}</div>
                          <div className="truncate text-sm font-semibold">{video.title || "-"}</div>
                          <div className="text-xs text-muted-foreground">{t("tv.subtitleCount", { count: video.subtitles.length })}</div>
                        </button>
                      </li>
                    );
                  })}

                  {videos.length === 0 && (
                    <li className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                      {t("tv.noEpisodesInSeason", { season: selectedSeasonLabel })}
                    </li>
                  )}
                </ul>
              </ScrollArea>
              {episodesPending && <PanelLoadingOverlay label={t("tv.refreshingEpisodes")} />}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="subtitles" className="mt-3 min-h-0 flex-1">
          <div className="flex h-full min-h-0 flex-col gap-3">
            <div className="flex justify-end">
              <Button type="button" variant="outline" className="w-full gap-1 sm:w-auto" onClick={() => setActiveStep("episodes")}>
                <ArrowLeft className="h-4 w-4" />
                {t("tv.backToEpisodes")}
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              <SubtitleDetailsPanel
                panelTitle={t("tv.managementTitle")}
                selectedVideo={selectedVideo}
                emptyText={t("tv.selectEpisodeEmpty")}
                showBack={false}
                onBack={() => {}}
                infoRows={[
                  { label: t("info.series"), value: selectedSeries?.title || "-" }
                ]}
                onUpload={onUpload}
                onReplace={onReplace}
                onRemove={onRemove}
                onPreviewSubtitle={onPreviewSubtitle}
                formatTime={formatTime}
                busy={busy}
                uploading={uploading}
                uploadingMessage={uploadingMessage}
                subtitleAction={subtitleAction}
                showSearchLinks={true}
                inlineSearchLinks={true}
                searchKeyword={searchKeyword}
                showMediaType={false}
                showMetadata={false}
                compactMeta={true}
                metaCollapsedByDefault={true}
              />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface SubtitleDetailsPanelProps {
  panelTitle: string;
  selectedVideo: Video | null;
  emptyText: string;
  showBack: boolean;
  onBack: () => void;
  infoRows: Array<{ label: string; value: string }>;
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
  inlineSearchLinks?: boolean;
  searchKeyword?: string;
  showMediaType?: boolean;
  showMetadata?: boolean;
  showUploadButton?: boolean;
  compactMeta?: boolean;
  metaCollapsedByDefault?: boolean;
}

interface SubtitleDetailsPanelHandle {
  openUploadPicker: () => void;
}

const SubtitleDetailsPanel = forwardRef<SubtitleDetailsPanelHandle, SubtitleDetailsPanelProps>(function SubtitleDetailsPanel({
  panelTitle,
  selectedVideo,
  emptyText,
  showBack,
  onBack,
  infoRows,
  onUpload,
  onReplace,
  onRemove,
  onPreviewSubtitle,
  formatTime,
  busy,
  uploading,
  uploadingMessage,
  subtitleAction,
  showSearchLinks,
  inlineSearchLinks = false,
  searchKeyword,
  showMediaType = true,
  showMetadata = true,
  showUploadButton = true,
  compactMeta = false,
  metaCollapsedByDefault = false
}: SubtitleDetailsPanelProps, ref) {
  const { t } = useI18n();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<Record<string, HTMLInputElement | null>>({});

  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [uploadLabel, setUploadLabel] = useState("zh");
  const [zipPickDialogOpen, setZipPickDialogOpen] = useState(false);
  const [zipPickMode, setZipPickMode] = useState<"upload" | "replace">("upload");
  const [zipPickFileName, setZipPickFileName] = useState("");
  const [zipPickEntries, setZipPickEntries] = useState<ZipSubtitleEntry[]>([]);
  const [zipPickTargetSubtitle, setZipPickTargetSubtitle] = useState<Subtitle | null>(null);
  const [zipUploadLabel, setZipUploadLabel] = useState("zh");
  const [selectedZipEntryId, setSelectedZipEntryId] = useState("");
  const [zipPickError, setZipPickError] = useState("");
  const [zipLoading, setZipLoading] = useState(false);
  const [deleteDialogSubtitleId, setDeleteDialogSubtitleId] = useState<string | null>(null);
  const [flashSubtitleList, setFlashSubtitleList] = useState(false);
  const [metaExpanded, setMetaExpanded] = useState(!metaCollapsedByDefault);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewStatus, setPreviewStatus] = useState<"idle" | "loading" | "success" | "error" | "empty">("idle");
  const [previewError, setPreviewError] = useState("");
  const [previewContent, setPreviewContent] = useState("");
  const [previewEncoding, setPreviewEncoding] = useState("");
  const [previewTruncated, setPreviewTruncated] = useState(false);

  const searchLinks = useMemo(() => {
    if (searchKeyword && searchKeyword.trim()) {
      return buildSubtitleSearchLinksByKeyword(searchKeyword);
    }
    if (!selectedVideo) {
      return null;
    }
    return buildSubtitleSearchLinks(selectedVideo);
  }, [searchKeyword, selectedVideo]);
  const uploadPending = subtitleAction?.kind === "upload" && subtitleAction.videoId === selectedVideo?.id;
  const uploadActionItem: RowActionItem | null = showUploadButton
    ? {
        label: uploadPending ? uploadingMessage || t("details.uploading") : t("movie.uploadSubtitleArchive"),
        onSelect: openUploadPicker,
        disabled: busy || zipLoading
      }
    : null;
  const inlineUploadActionItem = inlineSearchLinks ? uploadActionItem : null;
  const actionMenuItems: RowActionItem[] = [
    ...(inlineSearchLinks || !uploadActionItem ? [] : [uploadActionItem]),
    ...(!inlineSearchLinks && showSearchLinks && searchLinks
      ? [
          { label: "Zimuku", href: searchLinks.zimuku, external: true },
          { label: "SubHD", href: searchLinks.subhd, external: true }
        ]
      : [])
  ];
  const inlineSearchActionItems: RowActionItem[] =
    inlineSearchLinks && showSearchLinks && searchLinks
      ? [
          { label: "Zimuku", href: searchLinks.zimuku, external: true },
          { label: "SubHD", href: searchLinks.subhd, external: true }
        ]
      : [];
  const hasActionToolbar =
    actionMenuItems.length > 0 || Boolean(inlineUploadActionItem) || inlineSearchActionItems.length > 0 || zipLoading || Boolean(zipPickError);
  const detailsInfoGrid = selectedVideo ? (
    <div className="grid gap-2 text-sm md:grid-cols-2">
      <InfoItem label={t("info.title")} value={selectedVideo.title || "-"} />
      <InfoItem label={t("info.year")} value={selectedVideo.year || "-"} />
      {showMediaType && <InfoItem label={t("info.mediaType")} value={selectedVideo.mediaType === "movie" ? t("info.movie") : t("info.tv")} />}
      {showMetadata && <InfoItem label={t("info.metadata")} value={selectedVideo.metadataSource || "-"} />}
      {infoRows.map((item) => (
        <InfoItem key={item.label} label={item.label} value={item.value || "-"} />
      ))}
      <InfoItem label={t("info.path")} value={selectedVideo.path || "-"} />
      <InfoItem label={t("info.updated")} value={formatTime(selectedVideo.updatedAt)} />
    </div>
  ) : null;

  function triggerSubtitleListFlash() {
    setFlashSubtitleList(false);
    window.requestAnimationFrame(() => {
      setFlashSubtitleList(true);
      window.setTimeout(() => setFlashSubtitleList(false), 900);
    });
  }

  function resetZipPickState() {
    setZipPickDialogOpen(false);
    setZipPickMode("upload");
    setZipPickFileName("");
    setZipPickEntries([]);
    setZipPickTargetSubtitle(null);
    setZipUploadLabel("zh");
    setSelectedZipEntryId("");
    setZipPickError("");
    setZipLoading(false);
  }

  function resetUploadState() {
    setUploadDialogOpen(false);
    setPendingUploadFile(null);
    setUploadLabel("zh");
  }

  function resetPreviewState() {
    setPreviewDialogOpen(false);
    setPreviewTitle("");
    setPreviewStatus("idle");
    setPreviewError("");
    setPreviewContent("");
    setPreviewEncoding("");
    setPreviewTruncated(false);
  }

  function openPreviewFromBuffer(name: string, buffer: ArrayBuffer) {
    setPreviewDialogOpen(true);
    setPreviewTitle(name || "-");
    try {
      const decoded = decodeSubtitlePreviewContent(buffer);
      if (!decoded.text.trim()) {
        setPreviewStatus("empty");
        setPreviewError("");
        setPreviewContent("");
        setPreviewEncoding(decoded.encoding);
        setPreviewTruncated(false);
        return;
      }

      setPreviewStatus("success");
      setPreviewError("");
      setPreviewContent(decoded.text);
      setPreviewEncoding(decoded.encoding);
      setPreviewTruncated(decoded.truncated);
    } catch (error) {
      const errText = error instanceof Error ? error.message : String(error);
      setPreviewStatus("error");
      setPreviewError(errText);
      setPreviewContent("");
      setPreviewEncoding("");
      setPreviewTruncated(false);
    }
  }

  async function openStoredSubtitlePreview(subtitle: Subtitle) {
    if (!selectedVideo) {
      return;
    }

    setPreviewDialogOpen(true);
    setPreviewTitle(subtitle.fileName || "-");
    setPreviewStatus("loading");
    setPreviewError("");
    setPreviewContent("");
    setPreviewEncoding("");
    setPreviewTruncated(false);

    try {
      const data = await onPreviewSubtitle(selectedVideo, subtitle);
      openPreviewFromBuffer(subtitle.fileName, data);
    } catch (error) {
      const errText = error instanceof Error ? error.message : String(error);
      setPreviewStatus("error");
      setPreviewError(errText);
    }
  }

  function openArchiveSubtitlePreview(entry: ZipSubtitleEntry) {
    openPreviewFromBuffer(entry.fileName || entry.path || "-", entry.data);
  }

  useEffect(() => {
    resetUploadState();
    resetZipPickState();
    resetPreviewState();
    setDeleteDialogSubtitleId(null);
    setFlashSubtitleList(false);
  }, [selectedVideo?.id]);

  useEffect(() => {
    setMetaExpanded(!metaCollapsedByDefault);
  }, [metaCollapsedByDefault, selectedVideo?.id]);

  function openUploadPicker() {
    if (busy || zipLoading) {
      return;
    }
    uploadInputRef.current?.click();
  }

  useImperativeHandle(ref, () => ({
    openUploadPicker
  }));

  async function openZipPicker(file: File, mode: "upload" | "replace", targetSubtitle: Subtitle | null) {
    setZipLoading(true);
    setZipPickError("");

    try {
      const entries = await extractSubtitleEntriesFromArchiveFile(file);
      if (entries.length === 0) {
        setZipPickError(t("details.noSubtitleFilesInArchive"));
        emitToast({
          level: "error",
          title: t("toast.archiveParsingFailedTitle"),
          message: t("toast.archiveParsingNoSubtitleMessage")
        });
        return;
      }
      setZipPickMode(mode);
      setZipPickTargetSubtitle(targetSubtitle);
      if (mode === "upload") {
        setZipUploadLabel(uploadLabel.trim() || "zh");
      }
      setZipPickFileName(file.name);
      setZipPickEntries(entries);
      setSelectedZipEntryId("");
      setZipPickDialogOpen(true);
      emitToast({
        level: "info",
        title: t("toast.archiveParsedTitle"),
        message: t("toast.archiveParsedMessage", { count: entries.length }),
        detail: file.name
      });
    } catch (error) {
      const errText = error instanceof Error ? error.message : String(error);
      setZipPickError(t("details.parseArchiveFailed", { error: errText }));
      emitToast({
        level: "error",
        title: t("toast.archiveParsingFailedTitle"),
        message: errText,
        detail: file.name
      });
    } finally {
      setZipLoading(false);
    }
  }

  function onUploadFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    if (isArchiveFileName(file.name)) {
      void openZipPicker(file, "upload", null);
      return;
    }
    if (!isSubtitleFileName(file.name)) {
      setZipPickError(t("details.unsupportedFileType"));
      emitToast({
        level: "error",
        title: t("toast.unsupportedFileTitle"),
        message: file.name,
        detail: t("toast.unsupportedFileDetail")
      });
      return;
    }
    setPendingUploadFile(file);
    setUploadDialogOpen(true);
  }

  async function confirmUpload() {
    if (!selectedVideo || !pendingUploadFile) return;
    const success = await onUpload(selectedVideo, pendingUploadFile, uploadLabel.trim());
    if (success) {
      resetUploadState();
      triggerSubtitleListFlash();
    }
  }

  async function onReplaceFilePicked(subtitle: Subtitle, event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file || !selectedVideo) return;
    if (isArchiveFileName(file.name)) {
      await openZipPicker(file, "replace", subtitle);
      return;
    }
    if (!isSubtitleFileName(file.name)) {
      setZipPickError(t("details.unsupportedFileType"));
      emitToast({
        level: "error",
        title: t("toast.unsupportedFileTitle"),
        message: file.name,
        detail: t("toast.unsupportedFileDetail")
      });
      return;
    }
    const success = await onReplace(selectedVideo, subtitle, file);
    if (success) {
      triggerSubtitleListFlash();
    }
  }

  async function onZipEntryPicked(entry: ZipSubtitleEntry) {
    if (!selectedVideo) {
      return;
    }

    const selectedFile = toSubtitleFile(entry);
    if (zipPickMode === "upload") {
      const success = await onUpload(selectedVideo, selectedFile, zipUploadLabel.trim());
      if (success) {
        resetZipPickState();
        triggerSubtitleListFlash();
      }
      return;
    }

    if (!zipPickTargetSubtitle) {
      setZipPickError(t("details.missingReplaceTarget"));
      return;
    }

    const success = await onReplace(selectedVideo, zipPickTargetSubtitle, selectedFile);
    if (success) {
      resetZipPickState();
      triggerSubtitleListFlash();
    }
  }

  async function confirmZipEntrySelection() {
    const entry = zipPickEntries.find((item) => item.id === selectedZipEntryId);
    if (!entry) {
      setZipPickError(t("details.selectArchiveEntryFirst"));
      return;
    }
    await onZipEntryPicked(entry);
  }

  async function confirmDeleteSubtitle(subtitle: Subtitle) {
    if (!selectedVideo) {
      return;
    }
    const success = await onRemove(selectedVideo, subtitle);
    if (success) {
      setDeleteDialogSubtitleId(null);
      triggerSubtitleListFlash();
    }
  }

  return (
    <Card className="animate-fade-in-up flex h-full w-full flex-col border bg-card">
      <CardHeader className="p-4">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg">{panelTitle}</CardTitle>
          {showBack && (
            <Button type="button" variant="outline" size="sm" className="gap-1" onClick={onBack} disabled={busy}>
              <ArrowLeft className="h-4 w-4" />
              {t("details.backToList")}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-4 p-4 pt-0">
        {!selectedVideo ? (
          <div className="flex flex-1 items-center justify-center rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
            {emptyText}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            {compactMeta ? (
              <div className="space-y-3 rounded-md border bg-background/60 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="max-w-full truncate text-sm font-semibold sm:max-w-[60%]">
                    {selectedVideo.title || selectedVideo.fileName || "-"}
                  </p>
                  <Badge variant="secondary" className="text-[11px]">
                    {t("tv.subtitleCount", { count: selectedVideo.subtitles.length })}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {t("info.updated")}: {formatTime(selectedVideo.updatedAt)}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  onClick={() => setMetaExpanded((prev) => !prev)}
                >
                  {metaExpanded ? t("details.lessInfo") : t("details.moreInfo")}
                </Button>
                {metaExpanded && detailsInfoGrid}
              </div>
            ) : (
              detailsInfoGrid
            )}

            <input
              ref={uploadInputRef}
              type="file"
              accept=".srt,.ass,.ssa,.vtt,.sub,.zip,.7z,.rar"
              className="hidden"
              onChange={onUploadFileChange}
            />
            {hasActionToolbar && (
              <div className="flex flex-wrap items-center gap-2">
                {actionMenuItems.length > 0 && (
                  <RowActionsMenu
                    label={t("details.actionsForVideo", { name: selectedVideo.title || selectedVideo.fileName || selectedVideo.path })}
                    items={actionMenuItems}
                    triggerIcon={uploadPending || zipLoading ? <SpinnerIcon className="h-4 w-4" /> : undefined}
                  />
                )}
                {inlineUploadActionItem && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    disabled={inlineUploadActionItem.disabled}
                    onClick={() => inlineUploadActionItem.onSelect?.()}
                  >
                    {uploadPending || zipLoading ? <SpinnerIcon className="h-4 w-4" /> : null}
                    <span>{inlineUploadActionItem.label}</span>
                  </Button>
                )}
                {inlineSearchActionItems.map((item) => (
                  <Button key={item.label} type="button" variant="outline" size="sm" className="gap-1" asChild>
                    <a href={item.href} target={item.external ? "_blank" : undefined} rel={item.external ? "noreferrer" : undefined}>
                      <span>{item.label}</span>
                      {item.external && <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />}
                    </a>
                  </Button>
                ))}
                {zipLoading && <InlinePending label={t("details.parsingArchive")} />}
                {zipPickError && <span className="text-xs text-rose-600">{zipPickError}</span>}
              </div>
            )}

            <div className={cn("min-h-0 flex-1 rounded-md border", flashSubtitleList && "animate-highlight-flash")}>
              <ScrollArea className="h-full max-h-[48vh] xl:max-h-full">
                <Table>
                  <TableCaption>{t("details.subtitleListCaption")}</TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("details.name")}</TableHead>
                      <TableHead>{t("details.lang")}</TableHead>
                      <TableHead>{t("batch.format")}</TableHead>
                      <TableHead>{t("details.modified")}</TableHead>
                      <TableHead className="w-[196px] text-right">{t("common.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedVideo.subtitles.map((subtitle) => {
                      const replacePending = subtitleAction?.kind === "replace" && subtitleAction.subtitleId === subtitle.id;
                      const deletePending = subtitleAction?.kind === "delete" && subtitleAction.subtitleId === subtitle.id;
                      const rowBusy = replacePending || deletePending;

                      return (
                      <TableRow key={subtitle.id} className={cn(rowBusy && "animate-pulse-soft bg-muted/40")}>
                        <TableCell className="break-all">{subtitle.fileName}</TableCell>
                        <TableCell>{subtitle.language || "-"}</TableCell>
                        <TableCell>{subtitle.format || "-"}</TableCell>
                        <TableCell>{formatTime(subtitle.modTime)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <input
                              ref={(node) => {
                                replaceInputRef.current[subtitle.id] = node;
                              }}
                              type="file"
                              accept=".srt,.ass,.ssa,.vtt,.sub,.zip,.7z,.rar"
                              className="hidden"
                              onChange={(event) => {
                                void onReplaceFilePicked(subtitle, event);
                              }}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1 px-2"
                              disabled={busy || rowBusy}
                              onClick={() => void openStoredSubtitlePreview(subtitle)}
                            >
                              <Eye className="h-3.5 w-3.5" />
                              {t("common.preview")}
                            </Button>
                            <RowActionsMenu
                              label={t("details.actionsForSubtitle", { name: subtitle.fileName })}
                              disabled={busy || rowBusy}
                              triggerIcon={rowBusy ? <SpinnerIcon className="h-4 w-4" /> : undefined}
                              items={[
                                {
                                  label: replacePending ? t("details.replacing") : t("details.replaceSubtitle"),
                                  onSelect: () => replaceInputRef.current[subtitle.id]?.click(),
                                  disabled: busy || rowBusy
                                },
                                {
                                  label: deletePending ? t("details.deleting") : t("details.deleteSubtitle"),
                                  onSelect: () => setDeleteDialogSubtitleId(subtitle.id),
                                  disabled: busy || rowBusy
                                }
                              ]}
                            />

                            <AlertDialog
                              open={deleteDialogSubtitleId === subtitle.id}
                              onOpenChange={(open) => {
                                if (!open) {
                                  setDeleteDialogSubtitleId((current) => (current === subtitle.id ? null : current));
                                  return;
                                }
                                setDeleteDialogSubtitleId(subtitle.id);
                              }}
                            >
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>{t("details.deleteSubtitleTitle")}</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {t("details.deleteSubtitleDescription", { name: subtitle.fileName })}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel disabled={deletePending}>{t("common.cancel")}</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={(event) => {
                                      event.preventDefault();
                                      void confirmDeleteSubtitle(subtitle);
                                    }}
                                    disabled={deletePending}
                                  >
                                    {deletePending ? t("details.deleting") : t("common.delete")}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    );})}

                    {selectedVideo.subtitles.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                          {t("details.noSubtitles")}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          </div>
        )}
      </CardContent>

      <Dialog
        open={uploadDialogOpen}
        onOpenChange={(open) => {
          if (!open && uploading) {
            return;
          }
          if (!open) {
            resetUploadState();
            return;
          }
          setUploadDialogOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("details.uploadLabelTitle")}</DialogTitle>
            <DialogDescription>
              {pendingUploadFile ? t("details.fileDescription", { name: pendingUploadFile.name }) : t("details.uploadLabelDescription")}
            </DialogDescription>
          </DialogHeader>

          <Input
            value={uploadLabel}
            maxLength={32}
            placeholder="zh"
            onChange={(event) => setUploadLabel(event.target.value)}
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={resetUploadState} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => void confirmUpload()}
              disabled={!pendingUploadFile || !selectedVideo || busy}
            >
              {uploadPending ? <SpinnerIcon className="h-4 w-4" /> : null}
              {uploadPending ? t("details.uploading") : t("details.upload")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={zipPickDialogOpen}
        onOpenChange={(open) => {
          if (!open && uploading) {
            return;
          }
          if (!open) {
            resetZipPickState();
            return;
          }
          setZipPickDialogOpen(true);
        }}
      >
        <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("details.selectArchiveSubtitle")}</DialogTitle>
            <DialogDescription>
              {t("details.archiveDescription", { name: zipPickFileName || "-", count: zipPickEntries.length })}
            </DialogDescription>
          </DialogHeader>

          {zipPickMode === "upload" && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">{t("details.uploadSubtitleLabel")}</p>
              <Input
                value={zipUploadLabel}
                maxLength={32}
                placeholder="zh"
                onChange={(event) => setZipUploadLabel(event.target.value)}
              />
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm font-semibold">{t("details.archiveSubtitleFiles")}</p>
            <div className={cn("max-h-[55vh] overflow-auto rounded-md border", zipLoading && "animate-pulse-soft")}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("details.filePath")}</TableHead>
                      <TableHead className="w-[100px] text-right">{t("details.size")}</TableHead>
                      <TableHead className="w-[120px] text-center">{t("common.preview")}</TableHead>
                      <TableHead className="w-[96px] text-center">{t("details.selectFile")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {zipPickEntries.map((entry) => {
                      const checked = selectedZipEntryId === entry.id;
                      return (
                      <TableRow
                        key={entry.id}
                        className={cn(checked && "bg-accent/40")}
                        onClick={() => {
                          if (busy || uploading || zipLoading) {
                            return;
                          }
                          setSelectedZipEntryId((current) => (current === entry.id ? "" : entry.id));
                          setZipPickError("");
                        }}
                      >
                        <TableCell className="break-all text-xs">{entry.path}</TableCell>
                        <TableCell className="text-right text-xs">{Math.max(1, Math.round(entry.size / 1024))} KB</TableCell>
                        <TableCell className="text-center">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2"
                            onClick={(event) => {
                              event.stopPropagation();
                              openArchiveSubtitlePreview(entry);
                            }}
                          >
                            {t("common.preview")}
                          </Button>
                        </TableCell>
                        <TableCell className="text-center">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={busy || uploading || zipLoading}
                            aria-label={t("details.actionsForSubtitle", { name: entry.path })}
                            onChange={(event) => {
                              if (event.target.checked) {
                                setSelectedZipEntryId(entry.id);
                                setZipPickError("");
                                return;
                              }
                              setSelectedZipEntryId("");
                            }}
                          />
                        </TableCell>
                      </TableRow>
                    );})}

                    {zipPickEntries.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                          {t("details.noArchiveEntries")}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={resetZipPickState} disabled={busy}>
              {t("common.close")}
            </Button>
            <Button
              type="button"
              onClick={() => void confirmZipEntrySelection()}
              disabled={busy || uploading || zipLoading || !selectedZipEntryId}
            >
              {uploading ? <SpinnerIcon className="h-4 w-4" /> : null}
              {zipPickMode === "upload" ? t("details.confirmUploadFromArchive") : t("details.confirmReplaceFromArchive")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewDialogOpen} onOpenChange={setPreviewDialogOpen}>
        <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col overflow-hidden rounded-none sm:h-[88vh] sm:max-h-[88vh] sm:w-[min(1100px,96vw)] sm:rounded-lg">
          <DialogHeader>
            <DialogTitle>{t("details.previewTitle", { name: previewTitle || "-" })}</DialogTitle>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-background/70 p-3">
            {previewStatus === "loading" && (
              <div className="flex h-full items-center justify-center">
                <InlinePending label={t("details.previewLoading")} />
              </div>
            )}

            {previewStatus === "error" && (
              <div className="flex h-full items-center justify-center text-sm text-rose-600">
                {t("details.previewFailed", { error: previewError || "-" })}
              </div>
            )}

            {previewStatus === "empty" && (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {t("details.previewEmpty")}
              </div>
            )}

            {previewStatus === "success" && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {previewEncoding && (
                    <Badge variant="secondary" className="text-[11px] uppercase">
                      {previewEncoding}
                    </Badge>
                  )}
                  {previewTruncated && (
                    <span className="text-xs text-muted-foreground">
                      {t("details.previewTruncated", { count: SUBTITLE_PREVIEW_CHAR_LIMIT })}
                    </span>
                  )}
                </div>
                <pre className="overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background p-3 font-mono text-xs leading-5">
                  {previewContent}
                </pre>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPreviewDialogOpen(false)}>
              {t("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
});

SubtitleDetailsPanel.displayName = "SubtitleDetailsPanel";

function UploadBlockingOverlay({ message }: { message: string }) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-background/78 backdrop-blur-sm">
      <div className="animate-scale-in mx-4 flex min-w-[280px] max-w-[420px] flex-col items-center gap-3 rounded-2xl border bg-card px-6 py-7 text-center shadow-2xl">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
          <SpinnerIcon className="h-5 w-5" />
        </span>
        <div className="space-y-1">
          <p className="text-sm font-semibold">{t("details.uploadingSubtitlesTitle")}</p>
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {message || t("details.uploadingSubtitleFiles")}
          </p>
        </div>
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/75 bg-background/75 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 break-all text-sm font-semibold">{value}</p>
    </div>
  );
}

interface QuickStatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  tone: "emerald" | "blue" | "amber" | "rose";
  pending?: boolean;
  className?: string;
}

function QuickStatCard({ icon, label, value, hint, tone, pending = false, className }: QuickStatCardProps) {
  const toneClass: Record<QuickStatCardProps["tone"], { iconBg: string; iconText: string; hintText: string }> = {
    emerald: {
      iconBg: "bg-emerald-500/18 dark:bg-emerald-500/24",
      iconText: "text-emerald-500 dark:text-emerald-400",
      hintText: "text-emerald-600 dark:text-emerald-400"
    },
    blue: {
      iconBg: "bg-blue-500/18 dark:bg-blue-500/24",
      iconText: "text-blue-600 dark:text-blue-400",
      hintText: "text-blue-600 dark:text-blue-400"
    },
    amber: {
      iconBg: "bg-amber-500/18 dark:bg-amber-500/24",
      iconText: "text-amber-600 dark:text-amber-400",
      hintText: "text-amber-600 dark:text-amber-400"
    },
    rose: {
      iconBg: "bg-rose-500/18 dark:bg-rose-500/24",
      iconText: "text-rose-600 dark:text-rose-400",
      hintText: "text-rose-600 dark:text-rose-400"
    }
  };

  const style = toneClass[tone];

  return (
    <Card className={cn("border border-border/70 bg-card/92", className, pending && "animate-pulse-soft")}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-3">
          <span className={cn("inline-flex h-10 w-10 items-center justify-center rounded-xl", style.iconBg, style.iconText)}>
            {icon}
          </span>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
        <p className="text-display text-4xl font-bold tracking-tight">{value}</p>
        <p className={cn("text-xs font-medium", style.hintText)}>{hint}</p>
      </CardContent>
    </Card>
  );
}

function PagerView({ pager, onSetPage, disabled = false }: { pager: Pager; onSetPage: (page: number) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const totalPages = Math.max(1, pager.totalPages);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Button type="button" variant="outline" size="sm" disabled={disabled || pager.page <= 1} onClick={() => onSetPage(pager.page - 1)}>
        {t("pager.prev")}
      </Button>
      <span className="text-xs text-muted-foreground">
        {t("pager.summary", { page: pager.page, totalPages, total: pager.total })}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || pager.page >= totalPages}
        onClick={() => onSetPage(pager.page + 1)}
      >
        {t("pager.next")}
      </Button>
    </div>
  );
}

function LogsPanel({
  logs,
  pending,
  formatTime
}: {
  logs: OperationLog[];
  pending: boolean;
  formatTime: (value: string | undefined | null) => string;
}) {
  const { t } = useI18n();
  return (
    <Card className="animate-fade-in-up flex h-full min-h-[420px] flex-col border bg-card">
      <CardHeader className="flex flex-row items-center justify-between p-4">
        <CardTitle className="text-lg">{t("logs.title")}</CardTitle>
        <Badge variant="secondary">{pending ? t("logs.refreshing") : t("logs.recentCount", { count: logs.length })}</Badge>
      </CardHeader>
      <CardContent className="relative flex min-h-0 flex-1 p-4 pt-0">
        <ScrollArea className={cn("min-h-0 flex-1 rounded-md border bg-background", pending && "animate-pulse-soft")}>
          <ul className="divide-y divide-border">
            {logs.map((log) => (
              <li key={log.id} className="animate-fade-in-up space-y-1 p-3 text-sm">
                <p className="text-xs text-muted-foreground">{formatTime(log.timestamp)}</p>
                <p className="font-semibold">{log.action}</p>
                <p className="break-all text-xs text-muted-foreground">{log.targetPath || "-"}</p>
                <p className="text-xs text-muted-foreground">{t("logs.videoStatus", { videoId: log.videoId, status: log.status })}</p>
                {log.message && <p className="break-all text-xs text-muted-foreground">{t("logs.details", { details: log.message })}</p>}
              </li>
            ))}

            {logs.length === 0 && (
              <li className="p-8 text-center text-sm text-muted-foreground">{t("logs.empty")}</li>
            )}
          </ul>
        </ScrollArea>
        {pending && <PanelLoadingOverlay label={t("logs.refreshing")} />}
      </CardContent>
    </Card>
  );
}


