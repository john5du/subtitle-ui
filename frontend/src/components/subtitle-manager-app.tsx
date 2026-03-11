"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  Film,
  FileText,
  FolderTree,
  LayoutDashboard,
  RefreshCw,
  Search,
  Trash2,
  Tv
} from "lucide-react";
import Image from "next/image";
import { useTheme } from "next-themes";

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
  AlertDialogTitle,
  AlertDialogTrigger
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

const BATCH_LANGUAGE_LABELS: Record<DetectedBatchLanguageType, string> = {
  bilingual: "Bilingual",
  simplified: "Simplified Chinese",
  traditional: "Traditional Chinese",
  english: "English",
  japanese: "Japanese",
  korean: "Korean",
  unknown: "Unknown"
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

function formatLanguageTypeLabel(value: DetectedBatchLanguageType) {
  return BATCH_LANGUAGE_LABELS[value] || value;
}

function formatSubtitleExtLabel(ext: string) {
  return ext.replace(".", "").toUpperCase();
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

function summarizeBatchInputs(files: File[], entryCount: number) {
  const archiveCount = files.filter((file) => isArchiveFileName(file.name)).length;
  const subtitleCount = files.filter((file) => isSubtitleFileName(file.name)).length;
  const unsupportedCount = files.length - archiveCount - subtitleCount;
  const parts: string[] = [];
  if (archiveCount > 0) {
    parts.push(`${archiveCount} archive`);
  }
  if (subtitleCount > 0) {
    parts.push(`${subtitleCount} subtitle`);
  }
  if (unsupportedCount > 0) {
    parts.push(`${unsupportedCount} unsupported`);
  }

  const inputWord = files.length === 1 ? "input" : "inputs";
  const entryWord = entryCount === 1 ? "entry" : "entries";
  return `${files.length} ${inputWord} (${parts.join(", ")}) -> ${entryCount} ${entryWord}`;
}

function summarizeFileNames(names: string[], maxVisible = 3) {
  if (names.length <= maxVisible) {
    return names.join(", ");
  }
  return `${names.slice(0, maxVisible).join(", ")} +${names.length - maxVisible} more`;
}

function SpinnerIcon({ className }: { className?: string }) {
  return <RefreshCw className={cn("animate-spin", className)} />;
}

function InlinePending({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <SpinnerIcon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

function PanelLoadingOverlay({ label }: { label: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-start justify-end rounded-md bg-background/45 p-3 backdrop-blur-[1px]">
      <div className="animate-scale-in inline-flex items-center gap-2 rounded-full border bg-card/95 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm">
        <SpinnerIcon className="h-3.5 w-3.5" />
        {label}
      </div>
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

export function SubtitleManagerApp() {
  const {
    activeTab,
    movieQuery,
    tvQuery,
    movieVideos,
    tvSeriesRows,
    selectedTvSeries,
    tvVideosRequestedForSelectedSeries,
    sortedTvVideos,
    tvSeasonOptions,
    selectedTvSeason,
    selectedVideoIdByType,
    moviePager,
    tvPager,
    movieYearSortOrder,
    tvSeriesYearSortOrder,
    selectedTvDirPath,
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
  const movieDetailsRef = useRef<SubtitleDetailsPanelHandle | null>(null);

  const navItems: Array<{ key: ActiveTab; icon: React.ReactNode; label: string }> = [
    { key: "dashboard", icon: <LayoutDashboard className="h-4 w-4" />, label: "Overview" },
    { key: "movie", icon: <Film className="h-4 w-4" />, label: "Movie" },
    { key: "tv", icon: <Tv className="h-4 w-4" />, label: "TV" },
    { key: "logs", icon: <FileText className="h-4 w-4" />, label: "Logs" }
  ];

  const refreshText = refreshPending ? "Refreshing..." : "Refresh";

  const selectedMovie = useMemo(() => {
    return movieVideos.find((video) => video.id === selectedVideoIdByType.movie) ?? null;
  }, [movieVideos, selectedVideoIdByType.movie]);

  const selectedTvVideo = useMemo(() => {
    return sortedTvVideos.find((video) => video.id === selectedVideoIdByType.tv) ?? null;
  }, [selectedVideoIdByType.tv, sortedTvVideos]);

  const movieSearchLinks = useMemo(() => {
    if (!selectedMovie) return null;
    return buildSubtitleSearchLinks(selectedMovie);
  }, [selectedMovie]);

  const tvSearchLinks = useMemo(() => {
    if (!selectedTvSeries?.title) return null;
    return buildSubtitleSearchLinksByKeyword(selectedTvSeries.title);
  }, [selectedTvSeries?.title]);

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
    ? "Scanning media library..."
    : refreshPending
      ? `Refreshing ${activeTab}...`
      : uploading
        ? uploadingMessage || "Uploading subtitles..."
        : pending.tabSwitch
          ? "Loading workspace..."
          : message || "Ready";

  function handleMovieSelect(video: Video) {
    selectMovieVideo(video);
  }

  function handleTvSelect(video: Video) {
    selectTvVideo(video);
  }

  function openMovieUploadPicker() {
    if (!selectedMovie) return;
    setPendingMovieUploadPick(true);
    setMovieManagerOpen(true);
    void loadMovieWorkspaceOnDemand();
  }

  function openMovieManager() {
    if (!selectedMovie) return;
    setMovieManagerOpen(true);
    void loadMovieWorkspaceOnDemand();
  }

  function openTvManager() {
    if (!selectedTvSeries) return;
    if (!selectedVideoIdByType.tv && sortedTvVideos.length > 0) {
      selectTvVideo(sortedTvVideos[0]);
    }
    setTvManagerOpen(true);
    void loadTvWorkspaceOnDemand();
  }

  function openTvBatchDialog() {
    if (!selectedTvSeries) return;
    setTvBatchOpen(true);
    void loadTvWorkspaceOnDemand();
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

  return (
    <div className="h-full w-full px-3 py-3 md:px-6 md:py-5">
      <div className="mx-auto grid h-full w-full max-w-[1560px] gap-3 lg:grid-cols-[240px_minmax(0,1fr)]">
        <Card className="animate-fade-in-up border bg-card lg:h-full">
          <CardContent className="flex h-full flex-col gap-4 p-4">
            <div>
              <Image
                src="/icon.svg"
                alt=""
                aria-hidden
                width={44}
                height={44}
                className="mb-2 h-11 w-11 rounded-xl border border-border/70 bg-background/40"
              />
              <p className="text-base font-bold uppercase tracking-[0.2em] text-muted-foreground">Subtitle UI</p>
              <p className="mt-1 text-xs text-muted-foreground">Simple, efficient subtitle operations.</p>
            </div>

            <div className="grid gap-1">
              {navItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={cn(
                    "surface-transition flex items-center rounded-lg border px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-60",
                    activeTab === item.key
                      ? "border-primary/70 bg-primary/10 text-foreground shadow-sm"
                      : "border-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground"
                  )}
                  disabled={uploading || pending.tabSwitch}
                  onClick={() => void switchTab(item.key)}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {item.icon}
                    {item.label}
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-auto space-y-2">
              <ThemeModeSelect />
              <Button type="button" onClick={() => void triggerScan()} disabled={operationLocked} className="h-9 w-full gap-2">
                {scanPending ? <SpinnerIcon className="h-4 w-4" /> : <Search className="h-4 w-4" />}
                {scanPending ? "Scanning..." : "Scan Media Library"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void refreshActiveTab()}
                disabled={operationLocked}
                className="h-9 w-full gap-2"
              >
                {refreshPending ? <SpinnerIcon className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
                {refreshText}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="min-h-0 min-w-0 lg:flex lg:h-full lg:flex-col">
          <Card className="animate-fade-in-up border bg-card">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                  {activeTab === "dashboard" && "Overview"}
                  {activeTab === "movie" && "Movie Workspace"}
                  {activeTab === "tv" && "TV Workspace"}
                  {activeTab === "logs" && "Logs"}
                </p>
              </div>
              <Badge variant="outline" className={cn("surface-transition text-xs", statusBadgeClass)}>
                {statusBadgeText}
              </Badge>
            </CardContent>
          </Card>

          <div key={activeTab} className="animate-fade-in-up mt-3 min-h-0 lg:flex-1">
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
              <div className="flex min-h-0 flex-col gap-3 lg:h-full">
                <Card className="border bg-card">
                  <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Selected movie</p>
                      <p className="truncate text-sm font-semibold">{selectedMovie?.title || "Select a movie from the list"}</p>
                      {pending.movieList && <InlinePending label="Updating movie list..." />}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {movieSearchLinks && (
                        <Button type="button" variant="outline" asChild>
                          <a href={movieSearchLinks.zimuku} target="_blank" rel="noreferrer" className="gap-1">
                            Zimuku
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </Button>
                      )}
                    {movieSearchLinks && (
                      <Button type="button" variant="outline" asChild>
                        <a href={movieSearchLinks.subhd} target="_blank" rel="noreferrer" className="gap-1">
                          SubHD
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </Button>
                    )}
                    <Button type="button" onClick={openMovieUploadPicker} disabled={!selectedMovie || operationLocked}>
                      Upload Subtitle / Archive
                    </Button>
                    <Button type="button" variant="outline" onClick={openMovieManager} disabled={!selectedMovie || operationLocked}>
                      Open Subtitle Manager
                    </Button>
                  </div>
                </CardContent>
              </Card>

                <div className="min-h-[430px] lg:min-h-0 lg:flex-1">
                  <MovieListPanel
                    query={movieQuery}
                    onQueryChange={setMovieQuery}
                    videos={movieVideos}
                    selectedVideoId={selectedVideoIdByType.movie}
                    pager={moviePager}
                    yearSortOrder={movieYearSortOrder}
                    onToggleYearSort={toggleMovieYearSort}
                    onSelectVideo={handleMovieSelect}
                    onSetPage={setMoviePage}
                    pending={pending.movieList}
                    formatTime={formatTime}
                  />
                </div>
              </div>
            )}

            {activeTab === "tv" && (
              <div className="flex min-h-0 flex-col gap-3 lg:h-full">
                <Card className="border bg-card">
                  <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Selected series</p>
                      <p className="truncate text-sm font-semibold">{selectedTvSeries?.title || "Select a series from the list"}</p>
                      {(pending.tvSeriesList || pending.tvEpisodes) && (
                        <InlinePending label={pending.tvEpisodes ? "Loading episodes..." : "Updating series list..."} />
                      )}
                      {selectedTvSeries && !pending.tvEpisodes && !tvVideosRequestedForSelectedSeries && (
                        <p className="text-xs text-muted-foreground">
                          Episodes load when you open Subtitle Manager or Season Batch Upload.
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {tvSearchLinks && (
                        <Button type="button" variant="outline" asChild>
                          <a href={tvSearchLinks.zimuku} target="_blank" rel="noreferrer" className="gap-1">
                            Zimuku
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </Button>
                      )}
                      {tvSearchLinks && (
                        <Button type="button" variant="outline" asChild>
                          <a href={tvSearchLinks.subhd} target="_blank" rel="noreferrer" className="gap-1">
                            SubHD
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </Button>
                      )}
                      <Button type="button" onClick={openTvBatchDialog} disabled={!selectedTvSeries || operationLocked}>
                        Season Batch Upload
                      </Button>
                      <Button type="button" variant="outline" onClick={openTvManager} disabled={!selectedTvSeries || operationLocked}>
                        Open Subtitle Manager
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <div className="min-h-[520px] lg:min-h-0 lg:flex-1">
                  <TvSeriesListPanel
                    query={tvQuery}
                    onQueryChange={setTvQuery}
                    rows={tvSeriesRows}
                    pager={tvPager}
                    yearSortOrder={tvSeriesYearSortOrder}
                    selectedSeriesPath={selectedTvDirPath}
                    onSelectSeries={selectTvDirectory}
                    onSetPage={setTvPage}
                    onToggleYearSort={toggleTvSeriesYearSort}
                    showScanPrompt={showTvScanPrompt}
                    onTriggerScan={triggerScan}
                    loading={scanPending}
                    pending={pending.tvSeriesList}
                    formatTime={formatTime}
                  />
                </div>
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
            panelTitle="Movie Subtitle Management"
            selectedVideo={selectedMovie}
            emptyText="Select a movie from the list."
            showBack={false}
            onBack={() => {}}
            infoRows={[]}
            onUpload={uploadSubtitle}
            onReplace={replaceSubtitle}
            onRemove={removeSubtitle}
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
        <DialogContent className="flex h-[90vh] max-h-[90vh] w-[min(1280px,96vw)] max-w-none overflow-hidden p-0 [&>button]:right-3 [&>button]:top-3 [&>button]:z-50">
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

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <QuickStatCard
          icon={<Activity className="h-4 w-4" />}
          label="Last Scan Videos"
          value={String(scanStatus?.videoCount ?? 0)}
          hint={scanStatus?.running ? "Scan in progress" : "Scanner idle"}
          tone="emerald"
          pending={pending.scan || pending.bootstrapping}
          className="animate-fade-in-up"
        />
        <QuickStatCard
          icon={<FolderTree className="h-4 w-4" />}
          label="Discovered Dirs"
          value={String(directoryScan.movie.length + directoryScan.tv.length)}
          hint={`Movie ${directoryScan.movie.length} / TV ${directoryScan.tv.length}`}
          tone="blue"
          pending={pending.scan || pending.bootstrapping}
          className="animate-fade-in-up"
        />
        <QuickStatCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Directory Warnings"
          value={String(directoryScan.errors.length)}
          hint={directoryScan.errors.length > 0 ? "Needs review" : "All clear"}
          tone={directoryScan.errors.length > 0 ? "rose" : "amber"}
          pending={pending.scan || pending.bootstrapping}
          className="animate-fade-in-up"
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.2fr_1fr]">
        <Card className="animate-fade-in-up border bg-card">
          <CardHeader className="p-4">
            <CardTitle className="text-lg">Scan Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0">
            <div className="rounded-lg border bg-muted/20 p-3 text-sm">
              <p role="status" aria-live="polite" className="font-medium">
                {message || "Ready"}
              </p>
              {pending.scan && <p className="mt-2"><InlinePending label="Scanner is working through the media library..." /></p>}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Directory warnings</p>
              {directoryScan.errors.length > 0 ? (
                <ul className="space-y-2">
                  {directoryScan.errors.slice(0, 6).map((error) => (
                    <li key={error} className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-200">
                      {error}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">No directory warnings in the latest scan.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up border bg-card">
          <CardHeader className="flex flex-row items-center justify-between p-4">
            <CardTitle className="text-lg">Recent Operations</CardTitle>
            <Badge variant="secondary">{pending.logs ? "Refreshing..." : `Recent ${recentLogs.length}`}</Badge>
          </CardHeader>
          <CardContent className="relative p-4 pt-0">
            <ScrollArea className={cn("h-[300px] rounded-md border bg-background", pending.logs && "animate-pulse-soft")}>
              <ul className="divide-y divide-border">
                {recentLogs.map((log) => (
                  <li key={log.id} className="animate-fade-in-up space-y-1 p-3 text-xs">
                    <p className="font-medium">{log.action}</p>
                    <p className="text-muted-foreground">{formatTime(log.timestamp)}</p>
                    <p className="break-all text-muted-foreground">{log.targetPath || "-"}</p>
                    <p className="text-muted-foreground">status: {log.status}</p>
                    {log.message && <p className="break-all text-muted-foreground">details: {log.message}</p>}
                  </li>
                ))}
                {recentLogs.length === 0 && (
                  <li className="p-6 text-center text-sm text-muted-foreground">No operation logs yet.</li>
                )}
              </ul>
            </ScrollArea>
            {pending.logs && <PanelLoadingOverlay label="Refreshing logs..." />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
function ThemeModeSelect() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const value = mounted ? theme || "system" : "system";

  return (
    <div className="flex items-center gap-2 rounded-lg border bg-background px-2 py-1 dark:border-slate-700 dark:bg-slate-900/80">
      <span className="text-xs font-semibold text-muted-foreground">Theme</span>
      <Select value={value} onValueChange={setTheme}>
        <SelectTrigger className="h-8 w-[126px] border-none bg-transparent px-2 text-xs shadow-none focus:ring-0">
          <SelectValue placeholder="Theme" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="system">System</SelectItem>
          <SelectItem value="light">Light</SelectItem>
          <SelectItem value="dark">Dark</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

interface MovieListPanelProps {
  query: string;
  onQueryChange: (value: string) => void;
  videos: Video[];
  selectedVideoId: string;
  pager: Pager;
  yearSortOrder: "asc" | "desc";
  onToggleYearSort: () => void;
  onSelectVideo: (video: Video) => void;
  onSetPage: (page: number) => void;
  pending: boolean;
  formatTime: (value: string | undefined | null) => string;
}

function MovieListPanel({
  query,
  onQueryChange,
  videos,
  selectedVideoId,
  pager,
  yearSortOrder,
  onToggleYearSort,
  onSelectVideo,
  onSetPage,
  pending,
  formatTime
}: MovieListPanelProps) {
  return (
    <Card className="animate-fade-in-up flex h-full flex-col border bg-card">
      <CardHeader className="space-y-3 p-4">
        <CardTitle className="text-lg">Movie List</CardTitle>
        <Input
          value={query}
          aria-label="Filter movies by title or path"
          placeholder="Filter by title/path"
          onChange={(event) => onQueryChange(event.target.value)}
        />
        {pending && <InlinePending label="Updating movie results..." />}
      </CardHeader>

      <CardContent className="relative flex min-h-0 flex-1 flex-col gap-3 p-4 pt-0">
        <ScrollArea className={cn("min-h-0 flex-1 rounded-md border bg-background", pending && "animate-pulse-soft")}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead className="w-[90px]">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={onToggleYearSort}>
                    Year
                    <span className="text-[10px]">{yearSortOrder === "desc" ? "↓" : "↑"}</span>
                  </button>
                </TableHead>
                <TableHead className="w-[170px]">Updated Time</TableHead>
                <TableHead className="w-[100px] text-right">Subtitles</TableHead>
                <TableHead className="w-[360px]">File Name</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {videos.map((video) => {
                const active = selectedVideoId === video.id;
                return (
                  <TableRow
                    key={video.id}
                    className={cn(
                      "surface-transition cursor-pointer",
                      active ? "bg-primary/10 shadow-[inset_3px_0_0_0_rgba(14,165,233,0.6)]" : "hover:bg-accent"
                    )}
                    onClick={() => onSelectVideo(video)}
                    aria-selected={active}
                  >
                    <TableCell className="max-w-[240px] truncate font-medium" title={video.title}>
                      {video.title || "-"}
                    </TableCell>
                    <TableCell>{video.year || "-"}</TableCell>
                    <TableCell>{formatTime(video.updatedAt)}</TableCell>
                    <TableCell className="text-right">{video.subtitles.length}</TableCell>
                    <TableCell className="max-w-[360px] truncate" title={video.fileName}>
                      {video.fileName || "-"}
                    </TableCell>
                  </TableRow>
                );
              })}

              {videos.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    No movies found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
        {pending && <PanelLoadingOverlay label="Refreshing movies..." />}

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
  yearSortOrder: "asc" | "desc";
  selectedSeriesPath: string;
  onSelectSeries: (path: string) => void;
  onSetPage: (page: number) => void;
  onToggleYearSort: () => void;
  showScanPrompt: boolean;
  onTriggerScan: () => void;
  loading: boolean;
  pending: boolean;
  formatTime: (value: string | undefined | null) => string;
}

function TvSeriesListPanel({
  query,
  onQueryChange,
  rows,
  pager,
  yearSortOrder,
  selectedSeriesPath,
  onSelectSeries,
  onSetPage,
  onToggleYearSort,
  showScanPrompt,
  onTriggerScan,
  loading,
  pending,
  formatTime
}: TvSeriesListPanelProps) {
  return (
    <Card className="animate-fade-in-up flex h-full flex-col border bg-card">
      <CardHeader className="space-y-3 p-4">
        <CardTitle className="text-lg">TV Series List</CardTitle>
        <Input
          value={query}
          aria-label="Filter TV series by name or path"
          placeholder="Filter by series title/path"
          onChange={(event) => onQueryChange(event.target.value)}
        />
        {pending && <InlinePending label="Updating series results..." />}
      </CardHeader>

      <CardContent className="relative flex min-h-0 flex-1 flex-col gap-3 p-4 pt-0">
        <ScrollArea className={cn("min-h-0 flex-1 rounded-md border bg-background", pending && "animate-pulse-soft")}>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead className="w-[110px]">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={onToggleYearSort}>
                    Latest Year
                    <span className="text-[10px]">{yearSortOrder === "desc" ? "↓" : "↑"}</span>
                  </button>
                </TableHead>
                <TableHead className="w-[170px]">Updated Time</TableHead>
                <TableHead className="w-[100px] text-right">Videos</TableHead>
                <TableHead className="w-[120px] text-right">No Subtitles</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const active = row.path === selectedSeriesPath;
                return (
                  <TableRow
                    key={row.key}
                    className={cn(
                      "surface-transition cursor-pointer",
                      active ? "bg-primary/10 shadow-[inset_3px_0_0_0_rgba(14,165,233,0.6)]" : "hover:bg-accent"
                    )}
                    onClick={() => onSelectSeries(row.path)}
                    aria-selected={active}
                  >
                    <TableCell className="max-w-[240px] truncate font-medium" title={row.title}>
                      {row.title || "-"}
                    </TableCell>
                    <TableCell>{row.latestEpisodeYear || "-"}</TableCell>
                    <TableCell className="truncate" title={formatTime(row.updatedAt)}>{formatTime(row.updatedAt)}</TableCell>
                    <TableCell className="text-right">{row.videoCount}</TableCell>
                    <TableCell className="text-right">{row.noSubtitleCount}</TableCell>
                  </TableRow>
                );
              })}

              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    {showScanPrompt ? (
                      <div className="flex flex-col items-center gap-3 text-center">
                        <p className="max-w-[320px] text-sm text-muted-foreground">
                          TV library has not been scanned yet. Run a scan to discover series and episodes.
                        </p>
                        <Button type="button" variant="outline" className="gap-2" onClick={() => void onTriggerScan()} disabled={loading}>
                          <Search className="h-4 w-4" />
                          Scan Media Library
                        </Button>
                      </div>
                    ) : (
                      "No TV series found."
                    )}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
        {pending && <PanelLoadingOverlay label="Refreshing series..." />}

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
      summaryParts.push(`Language: ${formatLanguageTypeLabel(effectiveLanguagePreference)}`);
    }
    if (showBatchFormatSelector && effectiveFormatPreference !== "any") {
      summaryParts.push(`Format: ${formatSubtitleExtLabel(effectiveFormatPreference)}`);
    }
    summaryParts.push(`Duplicate episode groups: ${preferred.duplicateGroups}`);
    const reducedHint =
      preferred.reducedCount > 0
        ? ` | Reduced ${preferred.reducedCount} duplicate subtitle files.`
        : "";
    setBatchPreferenceSummary(`${summaryParts.join(" | ")}${reducedHint}`);
  }, [
    batchCandidates,
    batchRawEntries,
    batchLanguagePreference,
    batchFormatPreference,
    showBatchLanguageSelector,
    showBatchFormatSelector
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
        setBatchError("No TV episodes available in selected series.");
        return;
      }

      const { entries, unsupported, archiveErrors } = await collectBatchEntriesFromFiles(files);
      if (entries.length === 0) {
        const reasons: string[] = [];
        if (archiveErrors.length > 0) {
          reasons.push(`Archive errors: ${summarizeFileNames(archiveErrors)}`);
        }
        if (unsupported.length > 0) {
          reasons.push(`Unsupported files: ${summarizeFileNames(unsupported)}`);
        }
        setBatchError(reasons.join(" | ") || "No subtitle files found in selected inputs.");
        setBatchSourceSummary("");
        setBatchRawEntries([]);
        setBatchCandidates(candidates);
        setBatchRows([]);
        return;
      }

      const notices: string[] = [];
      if (unsupported.length > 0) {
        notices.push(`Ignored unsupported files: ${summarizeFileNames(unsupported)}`);
      }
      if (archiveErrors.length > 0) {
        notices.push(`Skipped archive files: ${summarizeFileNames(archiveErrors)}`);
      }
      if (notices.length > 0) {
        setBatchError(notices.join(" | "));
      }
      setBatchSourceSummary(summarizeBatchInputs(files, entries.length));
      setBatchRawEntries(entries);
      setBatchCandidates(candidates);
      emitToast({
        level: "info",
        title: "Batch inputs prepared",
        message: `${entries.length} subtitle entries are ready for mapping.`,
        detail: summarizeBatchInputs(files, entries.length)
      });
    } catch (error) {
      const errText = error instanceof Error ? error.message : String(error);
      setBatchError(`Prepare batch inputs failed: ${errText}`);
      emitToast({
        level: "error",
        title: "Batch preparation failed",
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
      setBatchError("Please map at least one subtitle file to an episode.");
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
          <DialogTitle>TV Season Batch Upload</DialogTitle>
          <DialogDescription>
            Selected inputs: {batchSourceSummary || "-"} | Auto matched: {autoMatchedCount}/{batchRows.length} | Selected: {mappedCount}
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
              Select Files / Archive
            </Button>
            <span className="text-xs text-muted-foreground">
              Supports multiple archive files (.zip/.7z/.rar) or subtitle files (.srt/.ass/.ssa/.vtt/.sub). Match rules use SxxEyy / x / Season Episode patterns.
            </span>
            <span className="text-xs text-muted-foreground">
              For duplicate subtitles in the same episode, language and format preferences pick one entry automatically. Preference options only appear when parsed archive entries contain multiple types.
            </span>
            {batchError && <p className="text-xs text-rose-600">{batchError}</p>}
            {batchPreparing && <InlinePending label="Preparing batch inputs..." />}
            {uploading && <InlinePending label={uploadingMessage || "Uploading mapped subtitles..."} />}
          </div>

          {(showBatchLanguageSelector || showBatchFormatSelector || batchPreferenceSummary) && (
            <div className="flex flex-wrap items-center gap-2">
              {showBatchLanguageSelector && (
                <>
                  <span className="text-xs font-medium text-muted-foreground">Language Type</span>
                  <Select
                    value={batchLanguagePreference === "any" ? batchLanguageOptions[0] : batchLanguagePreference}
                    onValueChange={(value) => setBatchLanguagePreference(value as BatchLanguagePreference)}
                  >
                    <SelectTrigger className="h-9 w-[220px]">
                      <SelectValue placeholder="Language Type" />
                    </SelectTrigger>
                    <SelectContent>
                      {batchLanguageOptions.map((item) => (
                        <SelectItem key={item} value={item}>
                          {formatLanguageTypeLabel(item)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}

              {showBatchFormatSelector && (
                <>
                  <span className="text-xs font-medium text-muted-foreground">Format</span>
                  <Select
                    value={batchFormatPreference === "any" ? batchFormatOptions[0] : batchFormatPreference}
                    onValueChange={(value) => setBatchFormatPreference(normalizeSubtitleFormat(value))}
                  >
                    <SelectTrigger className="h-9 w-[150px]">
                      <SelectValue placeholder="Format" />
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
            <span className="text-xs font-medium text-muted-foreground">Label</span>
            <Input
              className="w-[140px]"
              value={batchLabel}
              maxLength={32}
              placeholder="zh"
              onChange={(event) => setBatchLabel(event.target.value)}
            />
            <span className="text-xs text-muted-foreground">
              Saved as media-name[.label].ext. Leave empty for default naming.
            </span>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold">Batch Subtitle Mapping</p>
            <div className={cn("max-h-[52vh] overflow-auto rounded-md border", batchPreparing && "animate-pulse-soft")}>
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50%]">Subtitle File</TableHead>
                    <TableHead className="w-[120px]">Parsed</TableHead>
                    <TableHead className="w-[360px]">Target Episode</TableHead>
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
                              <SelectValue placeholder="Choose episode" />
                            </SelectTrigger>
                            <SelectContent className="max-h-72">
                              <SelectItem value="__UNASSIGNED__">Skip</SelectItem>
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
                        Select subtitle files or archives to start mapping.
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
                Result: {batchResult.success}/{batchResult.total} succeeded, {batchResult.failed} failed.
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
          {batchPreparing && <PanelLoadingOverlay label="Parsing archives and matching episodes..." />}
        </div>

        <DialogFooter className="shrink-0 border-t pt-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button type="button" disabled={busy || batchPreparing || batchRows.length === 0} onClick={() => void submitSeasonBatch()}>
            Upload Mapped Subtitles
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
  formatTime,
  busy,
  uploading,
  uploadingMessage,
  episodesPending,
  subtitleAction
}: TvSubtitleManagementPanelProps) {
  const selectedSeasonLabel = seasonOptions.find((option) => option.value === selectedSeason)?.label || "All Seasons";
  const searchKeyword = useMemo(() => {
    if (!selectedVideo) {
      return "";
    }
    const parsed = parseVideoSeasonEpisode(selectedVideo);
    const series = (selectedSeries?.title || selectedVideo.title || "").trim();
    const episodeCode = parsed ? formatSeasonEpisodeText(parsed.season, parsed.episode) : "";
    return `${series} ${episodeCode}`.trim();
  }, [selectedSeries?.title, selectedVideo]);

  return (
    <div className="grid h-full w-full min-h-0 gap-3 p-3 md:grid-cols-[340px_minmax(0,1fr)] md:p-4">
      <Card className="animate-fade-in-up flex min-h-0 flex-col border bg-card">
        <CardHeader className="space-y-3 p-4">
          <CardTitle className="text-lg">Episodes</CardTitle>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Series</p>
            <p className="truncate text-sm font-semibold">{selectedSeries?.title || "-"}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Season</p>
            <Select value={selectedSeason} onValueChange={onSeasonChange} disabled={!selectedSeries || busy || episodesPending}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select season" />
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
          {episodesPending && <InlinePending label="Loading episode list..." />}
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
                      onClick={() => onSelectVideo(video)}
                      disabled={busy || episodesPending}
                      className={cn(
                        "surface-transition w-full rounded-md border px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-60",
                        active
                          ? "border-primary/70 bg-primary/10 shadow-[inset_3px_0_0_0_rgba(14,165,233,0.6)]"
                          : "border bg-background hover:bg-accent"
                        ,
                        itemBusy && "animate-pulse-soft"
                      )}
                      aria-pressed={active}
                    >
                      <div className="text-xs font-semibold text-muted-foreground">{episodeCode}</div>
                      <div className="truncate text-sm font-semibold">{video.title || "-"}</div>
                      <div className="text-xs text-muted-foreground">Subtitles: {video.subtitles.length}</div>
                    </button>
                  </li>
                );
              })}

              {videos.length === 0 && (
                <li className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No episodes in {selectedSeasonLabel}.
                </li>
              )}
            </ul>
          </ScrollArea>
          {episodesPending && <PanelLoadingOverlay label="Refreshing episodes..." />}
        </CardContent>
      </Card>

      <div className="min-h-0">
        <SubtitleDetailsPanel
          panelTitle="TV Subtitle Management"
          selectedVideo={selectedVideo}
          emptyText="Select an episode from the list."
          showBack={false}
          onBack={() => {}}
          infoRows={[
            { label: "Series", value: selectedSeries?.title || "-" }
          ]}
          onUpload={onUpload}
          onReplace={onReplace}
          onRemove={onRemove}
          formatTime={formatTime}
          busy={busy}
          uploading={uploading}
          uploadingMessage={uploadingMessage}
          subtitleAction={subtitleAction}
          showSearchLinks={true}
          searchKeyword={searchKeyword}
          showMediaType={false}
          showMetadata={false}
        />
      </div>
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
  formatTime,
  busy,
  uploading,
  uploadingMessage,
  subtitleAction,
  showSearchLinks,
  searchKeyword,
  showMediaType = true,
  showMetadata = true,
  showUploadButton = true
}: SubtitleDetailsPanelProps, ref) {
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
  const [zipPickError, setZipPickError] = useState("");
  const [zipLoading, setZipLoading] = useState(false);
  const [deleteDialogSubtitleId, setDeleteDialogSubtitleId] = useState<string | null>(null);
  const [flashSubtitleList, setFlashSubtitleList] = useState(false);

  const searchLinks = useMemo(() => {
    if (searchKeyword && searchKeyword.trim()) {
      return buildSubtitleSearchLinksByKeyword(searchKeyword);
    }
    if (!selectedVideo) {
      return null;
    }
    return buildSubtitleSearchLinks(selectedVideo);
  }, [searchKeyword, selectedVideo]);
  const hasActionToolbar = showUploadButton || (showSearchLinks && Boolean(searchLinks)) || zipLoading || Boolean(zipPickError);
  const uploadPending = subtitleAction?.kind === "upload" && subtitleAction.videoId === selectedVideo?.id;
  const workingLabel = uploadPending ? uploadingMessage || "Uploading subtitle..." : "Upload Subtitle / Archive";

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
    setZipPickError("");
    setZipLoading(false);
  }

  function resetUploadState() {
    setUploadDialogOpen(false);
    setPendingUploadFile(null);
    setUploadLabel("zh");
  }

  useEffect(() => {
    resetUploadState();
    resetZipPickState();
    setDeleteDialogSubtitleId(null);
    setFlashSubtitleList(false);
  }, [selectedVideo?.id]);

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
        setZipPickError("No subtitle files found in the archive.");
        emitToast({
          level: "error",
          title: "Archive parsing failed",
          message: "No subtitle files were found in the selected archive."
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
      setZipPickDialogOpen(true);
      emitToast({
        level: "info",
        title: "Archive parsed",
        message: `${entries.length} subtitle files found.`,
        detail: file.name
      });
    } catch (error) {
      const errText = error instanceof Error ? error.message : String(error);
      setZipPickError(`Parse archive failed: ${errText}`);
      emitToast({
        level: "error",
        title: "Archive parsing failed",
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
      setZipPickError("Unsupported file type. Please select subtitle files or archive files (.zip/.7z/.rar).");
      emitToast({
        level: "error",
        title: "Unsupported file",
        message: file.name,
        detail: "Select subtitle files or supported archive formats."
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
      setZipPickError("Unsupported file type. Please select subtitle files or archive files (.zip/.7z/.rar).");
      emitToast({
        level: "error",
        title: "Unsupported file",
        message: file.name,
        detail: "Select subtitle files or supported archive formats."
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
      setZipPickError("Missing target subtitle for replace.");
      return;
    }

    const success = await onReplace(selectedVideo, zipPickTargetSubtitle, selectedFile);
    if (success) {
      resetZipPickState();
      triggerSubtitleListFlash();
    }
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
              Back to list
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
            <div className="grid gap-2 text-sm md:grid-cols-2">
              <InfoItem label="Title" value={selectedVideo.title || "-"} />
              <InfoItem label="Year" value={selectedVideo.year || "-"} />
              {showMediaType && <InfoItem label="Media Type" value={selectedVideo.mediaType || "-"} />}
              {showMetadata && <InfoItem label="Metadata" value={selectedVideo.metadataSource || "-"} />}
              {infoRows.map((item) => (
                <InfoItem key={item.label} label={item.label} value={item.value || "-"} />
              ))}
              <InfoItem label="Path" value={selectedVideo.path || "-"} />
              <InfoItem label="Updated" value={formatTime(selectedVideo.updatedAt)} />
            </div>

            <input
              ref={uploadInputRef}
              type="file"
              accept=".srt,.ass,.ssa,.vtt,.sub,.zip,.7z,.rar"
              className="hidden"
              onChange={onUploadFileChange}
            />
            {hasActionToolbar && (
              <div className="flex flex-wrap items-center gap-2">
                {showUploadButton && (
                  <Button type="button" onClick={openUploadPicker} disabled={busy || zipLoading}>
                    {uploadPending ? <SpinnerIcon className="h-4 w-4" /> : null}
                    {workingLabel}
                  </Button>
                )}
                {showSearchLinks && searchLinks && (
                  <>
                    <Button type="button" variant="outline" asChild>
                      <a href={searchLinks.zimuku} target="_blank" rel="noreferrer" className="gap-1">
                        Zimuku
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </Button>
                    <Button type="button" variant="outline" asChild>
                      <a href={searchLinks.subhd} target="_blank" rel="noreferrer" className="gap-1">
                        SubHD
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </Button>
                  </>
                )}
                {zipLoading && <InlinePending label="Parsing archive..." />}
                {zipPickError && <span className="text-xs text-rose-600">{zipPickError}</span>}
              </div>
            )}

            <div className={cn("min-h-0 flex-1 rounded-md border", flashSubtitleList && "animate-highlight-flash")}>
              <ScrollArea className="h-full max-h-[48vh] xl:max-h-full">
                <Table>
                  <TableCaption>Subtitle list for selected video.</TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Lang</TableHead>
                      <TableHead>Format</TableHead>
                      <TableHead>Modified</TableHead>
                      <TableHead className="w-[180px]">Actions</TableHead>
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
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
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
                              size="sm"
                              variant="outline"
                              onClick={() => replaceInputRef.current[subtitle.id]?.click()}
                              disabled={busy || rowBusy}
                            >
                              {replacePending ? <SpinnerIcon className="h-3.5 w-3.5" /> : null}
                              {replacePending ? "Replacing..." : "Replace"}
                            </Button>

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
                              <AlertDialogTrigger asChild>
                                <Button type="button" size="sm" variant="destructive" className="gap-1" disabled={busy || rowBusy}>
                                  {deletePending ? <SpinnerIcon className="h-3.5 w-3.5" /> : <Trash2 className="h-4 w-4" />}
                                  {deletePending ? "Deleting..." : "Delete"}
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete subtitle?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    &quot;{subtitle.fileName}&quot; will be deleted permanently.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel disabled={deletePending}>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={(event) => {
                                      event.preventDefault();
                                      void confirmDeleteSubtitle(subtitle);
                                    }}
                                    disabled={deletePending}
                                  >
                                    {deletePending ? "Deleting..." : "Delete"}
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
                          No subtitles found.
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
            <DialogTitle>Upload subtitle label</DialogTitle>
            <DialogDescription>
              {pendingUploadFile ? `File: ${pendingUploadFile.name}` : "Choose subtitle language/label before upload."}
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
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void confirmUpload()}
              disabled={!pendingUploadFile || !selectedVideo || busy}
            >
              {uploadPending ? <SpinnerIcon className="h-4 w-4" /> : null}
              {uploadPending ? "Uploading..." : "Upload"}
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
            <DialogTitle>Select Subtitle From Archive</DialogTitle>
            <DialogDescription>
              Archive: {zipPickFileName || "-"} | {zipPickEntries.length} subtitle files found.
            </DialogDescription>
          </DialogHeader>

          {zipPickMode === "upload" && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">Upload Subtitle Label</p>
              <Input
                value={zipUploadLabel}
                maxLength={32}
                placeholder="zh"
                onChange={(event) => setZipUploadLabel(event.target.value)}
              />
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm font-semibold">Archive Subtitle Files</p>
            <div className={cn("max-h-[55vh] overflow-auto rounded-md border", zipLoading && "animate-pulse-soft")}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>File Path</TableHead>
                      <TableHead className="w-[100px] text-right">Size</TableHead>
                      <TableHead className="w-[120px]">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {zipPickEntries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="break-all text-xs">{entry.path}</TableCell>
                        <TableCell className="text-right text-xs">{Math.max(1, Math.round(entry.size / 1024))} KB</TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy || uploading}
                            onClick={() => void onZipEntryPicked(entry)}
                          >
                            Use This File
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}

                    {zipPickEntries.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                          No subtitle entries.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={resetZipPickState} disabled={busy}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
});

SubtitleDetailsPanel.displayName = "SubtitleDetailsPanel";

function UploadBlockingOverlay({ message }: { message: string }) {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-background/78 backdrop-blur-sm">
      <div className="animate-scale-in mx-4 flex min-w-[280px] max-w-[420px] flex-col items-center gap-3 rounded-2xl border bg-card px-6 py-7 text-center shadow-2xl">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
          <SpinnerIcon className="h-5 w-5" />
        </span>
        <div className="space-y-1">
          <p className="text-sm font-semibold">Uploading subtitles</p>
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {message || "Uploading subtitle files..."}
          </p>
        </div>
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
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
      iconBg: "bg-emerald-500/15 dark:bg-emerald-500/20",
      iconText: "text-emerald-500 dark:text-emerald-400",
      hintText: "text-emerald-600 dark:text-emerald-400"
    },
    blue: {
      iconBg: "bg-blue-500/15 dark:bg-blue-500/20",
      iconText: "text-blue-600 dark:text-blue-400",
      hintText: "text-blue-600 dark:text-blue-400"
    },
    amber: {
      iconBg: "bg-amber-500/15 dark:bg-amber-500/20",
      iconText: "text-amber-600 dark:text-amber-400",
      hintText: "text-amber-600 dark:text-amber-400"
    },
    rose: {
      iconBg: "bg-rose-500/15 dark:bg-rose-500/20",
      iconText: "text-rose-600 dark:text-rose-400",
      hintText: "text-rose-600 dark:text-rose-400"
    }
  };

  const style = toneClass[tone];

  return (
    <Card className={cn("border bg-card", className, pending && "animate-pulse-soft")}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-3">
          <span className={cn("inline-flex h-8 w-8 items-center justify-center rounded-lg", style.iconBg, style.iconText)}>
            {icon}
          </span>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
        <p className="text-4xl font-bold tracking-tight">{value}</p>
        <p className={cn("text-xs font-medium", style.hintText)}>{hint}</p>
      </CardContent>
    </Card>
  );
}

function PagerView({ pager, onSetPage, disabled = false }: { pager: Pager; onSetPage: (page: number) => void; disabled?: boolean }) {
  const totalPages = Math.max(1, pager.totalPages);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Button type="button" variant="outline" size="sm" disabled={disabled || pager.page <= 1} onClick={() => onSetPage(pager.page - 1)}>
        Prev
      </Button>
      <span className="text-xs text-muted-foreground">
        Page {pager.page} / {totalPages} ({pager.total})
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || pager.page >= totalPages}
        onClick={() => onSetPage(pager.page + 1)}
      >
        Next
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
  return (
    <Card className="animate-fade-in-up flex h-full min-h-[420px] flex-col border bg-card">
      <CardHeader className="flex flex-row items-center justify-between p-4">
        <CardTitle className="text-lg">Operation Logs</CardTitle>
        <Badge variant="secondary">{pending ? "Refreshing..." : `Recent ${logs.length}`}</Badge>
      </CardHeader>
      <CardContent className="relative flex min-h-0 flex-1 p-4 pt-0">
        <ScrollArea className={cn("min-h-0 flex-1 rounded-md border bg-background", pending && "animate-pulse-soft")}>
          <ul className="divide-y divide-border">
            {logs.map((log) => (
              <li key={log.id} className="animate-fade-in-up space-y-1 p-3 text-sm">
                <p className="text-xs text-muted-foreground">{formatTime(log.timestamp)}</p>
                <p className="font-semibold">{log.action}</p>
                <p className="break-all text-xs text-muted-foreground">{log.targetPath || "-"}</p>
                <p className="text-xs text-muted-foreground">videoId: {log.videoId} | status: {log.status}</p>
                {log.message && <p className="break-all text-xs text-muted-foreground">details: {log.message}</p>}
              </li>
            ))}

            {logs.length === 0 && (
              <li className="p-8 text-center text-sm text-muted-foreground">No operation logs yet.</li>
            )}
          </ul>
        </ScrollArea>
        {pending && <PanelLoadingOverlay label="Refreshing logs..." />}
      </CardContent>
    </Card>
  );
}


