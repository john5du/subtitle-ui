import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { ArrowLeft, CircleAlert, CircleCheck, ExternalLink, Info, Search, TriangleAlert } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import type {
  BatchSubtitleUploadItem,
  BatchSubtitleUploadResult,
  SubHDSearchResult,
  SubHDSeasonInstallOptions,
  SubHDSeasonPacksResult,
  SubHDSeasonPrepareOptions,
  SubHDSeasonPrepareResult,
  SubHDSeasonSuggestedMapping,
  TvSeriesSummary,
  Video
} from "@/lib/types";
import { emitToast } from "@/lib/toast";
import { parseVideoSeasonEpisode } from "@/lib/subtitle-manager/tv-episode";
import { buildSubtitleSearchLinksByKeyword } from "@/lib/subtitle-search";
import type { ZipSubtitleEntry } from "@/lib/subtitle-zip";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import type {
  BatchLanguagePreference,
  SeasonBatchMappingFilter,
  SeasonBatchMappingStatus,
  SeasonBatchRowView
} from "../types";
import { InlinePending, PanelLoadingOverlay, SpinnerIcon } from "../shared/pending-state";
import {
  applyBatchEntryPreferences,
  buildSeasonBatchRows,
  buildSeasonBatchRowViews,
  candidateVideosForBatchRow,
  collectBatchEntriesFromFiles,
  describeBatchEntrySource,
  filterSeasonBatchRowViews,
  formatLanguageTypeLabel,
  formatSeasonEpisodeText,
  formatSubtitleExtLabel,
  getLanguageTypesFromEntries,
  getSubtitleFormatsFromEntries,
  normalizeSubtitleFormat,
  summarizeBatchInputs,
  summarizeFileNames,
  summarizeSeasonBatchRows
} from "./batch-utils";

type BatchSourceMode = "local" | "subhd";

interface TvSeasonBatchUploadWorkspaceProps {
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
  onComplete?: (result: BatchSubtitleUploadResult) => void;
  className?: string;
  /** Start SubHD season-pack search when the workspace mounts. */
  autoSearchOnMount?: boolean;
}

function parseSeasonNumber(value: string | undefined) {
  if (!value) {
    return -1;
  }
  const match = value.match(/(\d{1,2})/);
  if (!match) {
    return -1;
  }
  return Number.parseInt(match[1], 10);
}

function filterVideosForSeason(videos: Video[], season: number) {
  if (season <= 0) {
    return videos;
  }
  return videos.filter((video) => {
    const parsed = parseVideoSeasonEpisode(video, season);
    return parsed?.season === season;
  });
}

function buildDefaultSeasonQuery(series: TvSeriesSummary | null | undefined, seasonValue: string | undefined, videos: Video[]) {
  const title = (series?.originalTitle || series?.title || videos[0]?.seriesOriginalTitle || videos[0]?.seriesTitle || "").trim();
  const season = parseSeasonNumber(seasonValue);
  if (!title) {
    return "";
  }
  if (season < 0) {
    return title;
  }
  return `${title} S${String(season).padStart(2, "0")}`;
}

function scoreSeasonPackResult(item: SubHDSearchResult, season: number) {
  if (!item.installable) {
    return -1000;
  }
  const text = `${item.title || ""} ${item.version || ""} ${item.format || ""}`.toLowerCase();
  let score = 0;
  for (const lang of item.langs || []) {
    if (/简|双|中/.test(lang)) {
      score += 3;
    }
    if (/英/.test(lang)) {
      score += 1;
    }
  }
  for (const hint of ["合集", "整季", "pack", "complete", "season", "全集"]) {
    if (text.includes(hint) || (item.title || "").includes(hint) || (item.version || "").includes(hint)) {
      score += 4;
    }
  }
  if (season >= 0) {
    const token = `s${String(season).padStart(2, "0")}`;
    const tokenAlt = `s${season}`;
    if (text.includes(token) || text.includes(tokenAlt)) {
      score += 5;
    }
    if (/\bs\d{1,2}e\d{1,3}\b/i.test(text) && !/合集|pack|complete|整季|全集/.test(text)) {
      score -= 2;
    }
  }
  const format = (item.format || "").toLowerCase();
  if (!format || format === "zip" || format === "rar" || format === "7z") {
    score += 2;
  } else if (format === "ass" || format === "ssa" || format === "srt") {
    score += 1;
  } else if (format === "sup") {
    score -= 5;
  }
  return score;
}

interface WorkspaceSectionProps {
  icon: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  aside?: ReactNode;
}

const ROW_SELECT_PENDING = "__PENDING__";
const ROW_SELECT_SKIPPED = "__SKIPPED__";

function WorkspaceSection({ icon, title, description, children, className, aside }: WorkspaceSectionProps) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-foreground-muted">{icon}</span>
            <h3 className="text-sm font-semibold uppercase tracking-section text-foreground-muted">{title}</h3>
          </div>
          {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {aside ? <div className="flex shrink-0 flex-wrap items-center gap-2">{aside}</div> : null}
      </div>
      <div>{children}</div>
    </section>
  );
}

function MappingStatusBadge({ status, label }: { status: SeasonBatchMappingStatus; label: string }) {
  const variant =
    status === "unassigned" ? "warning" : status === "manual" ? "info" : status === "auto" ? "success" : "secondary";
  return (
    <Badge variant={variant} className="shrink-0 whitespace-nowrap">
      {label}
    </Badge>
  );
}

function formatBatchEpisodeOptionLabel(video: Video) {
  const parsed = parseVideoSeasonEpisode(video);
  const code = parsed ? formatSeasonEpisodeText(parsed.season, parsed.episode) : "";
  const title = (video.title || video.fileName || "").trim();
  if (code && title) {
    return `${code} · ${title}`;
  }
  return code || title || video.id;
}

function MappingRow({
  row,
  videos,
  disabled,
  t,
  onSelectionChange
}: {
  row: SeasonBatchRowView;
  videos: Video[];
  disabled: boolean;
  t: ReturnType<typeof useI18n>["t"];
  onSelectionChange: (rowId: string, value: string) => void;
}) {
  const { fileName, sourcePath } = describeBatchEntrySource(row.entry);
  const candidates = candidateVideosForBatchRow(row, videos);
  const selectValue = row.skipped ? ROW_SELECT_SKIPPED : row.selectedVideoId || ROW_SELECT_PENDING;

  return (
    <div className={cn("surface-panel p-3 sm:p-4", row.status === "skipped" && "opacity-75")}>
      <div className="flex flex-col gap-3 xl:flex-row xl:gap-0">
        <div className="min-w-0 space-y-3 xl:flex-1 xl:pr-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="break-all text-sm font-semibold">{fileName}</p>
              <p className="mt-1 break-all text-xs text-muted-foreground">{sourcePath || t("batch.directInput")}</p>
            </div>
            <MappingStatusBadge status={row.status} label={t(`batch.status.${row.status}`)} />
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary">{formatSeasonEpisodeText(row.season, row.episode)}</Badge>
            <Badge variant="outline">{formatLanguageTypeLabel(row.languageType, t)}</Badge>
            {row.format ? <Badge variant="outline">{formatSubtitleExtLabel(row.format)}</Badge> : null}
            <Badge variant="outline">{t("batch.candidates", { count: row.candidateCount })}</Badge>
          </div>
        </div>

        <div className="min-w-0 space-y-2 border-t border-border pt-3 xl:w-[320px] xl:shrink-0 xl:border-l xl:border-t-0 xl:pl-3 xl:pt-0">
          <p className="text-caption font-semibold uppercase tracking-section text-foreground-muted">
            {t("common.episode")}
          </p>
          <Select value={selectValue} onValueChange={(value) => onSelectionChange(row.id, value)} disabled={disabled}>
            <SelectTrigger className="h-9 w-full min-w-0 [&>span]:min-w-0 [&>span]:truncate">
              <SelectValue placeholder={t("batch.chooseEpisode")} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value={ROW_SELECT_PENDING}>{t("common.pending")}</SelectItem>
              <SelectItem value={ROW_SELECT_SKIPPED}>{t("batch.skip")}</SelectItem>
              {candidates.map((video) => {
                const label = formatBatchEpisodeOptionLabel(video);
                return (
                  <SelectItem
                    key={`${row.id}-${video.id}`}
                    value={video.id}
                    title={video.fileName || video.title || label}
                    className="overflow-hidden"
                    textValue={label}
                  >
                    <span className="block truncate">{label}</span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

export function TvSeasonBatchUploadWorkspace({
  busy,
  uploading,
  uploadingMessage,
  onLoadBatchCandidates,
  onUploadBatch,
  selectedSeries = null,
  selectedSeason = "",
  seasonVideos = [],
  onSearchSubHDSeasonPacks,
  onPrepareSubHDSeason,
  onInstallSubHDSeason,
  onComplete,
  className,
  autoSearchOnMount = false
}: TvSeasonBatchUploadWorkspaceProps) {
  const { t } = useI18n();
  const batchInputRef = useRef<HTMLInputElement | null>(null);
  const autoSearchStartedRef = useRef(false);
  const [sourceMode, setSourceMode] = useState<BatchSourceMode>("subhd");
  const [batchPreparing, setBatchPreparing] = useState(false);
  const [batchInputFiles, setBatchInputFiles] = useState<File[]>([]);
  const [batchRawEntries, setBatchRawEntries] = useState<ZipSubtitleEntry[]>([]);
  const [batchRows, setBatchRows] = useState<SeasonBatchRowView[]>([]);
  const [batchCandidates, setBatchCandidates] = useState<Video[]>([]);
  const [batchLanguagePreference, setBatchLanguagePreference] = useState<BatchLanguagePreference>("any");
  const [batchFormatPreference, setBatchFormatPreference] = useState("any");
  const [batchLabel, setBatchLabel] = useState("zh");
  const [batchBlockingError, setBatchBlockingError] = useState("");
  const [batchNotices, setBatchNotices] = useState<string[]>([]);
  const [batchResult, setBatchResult] = useState<BatchSubtitleUploadResult | null>(null);
  const [batchFilter, setBatchFilter] = useState<SeasonBatchMappingFilter>("all");
  const [subhdQuery, setSubhdQuery] = useState(() => buildDefaultSeasonQuery(selectedSeries, selectedSeason, seasonVideos));
  const [subhdSearching, setSubhdSearching] = useState(false);
  const [subhdResults, setSubhdResults] = useState<SubHDSearchResult[]>([]);
  const [selectedSubhdSid, setSelectedSubhdSid] = useState("");
  const [subhdCacheToken, setSubhdCacheToken] = useState("");
  const [subhdPackName, setSubhdPackName] = useState("");
  const [subhdSuggestions, setSubhdSuggestions] = useState<SubHDSeasonSuggestedMapping[]>([]);
  const [subhdTitlePage, setSubhdTitlePage] = useState<{ doubanId?: string; title?: string; url?: string; message?: string }>({});
  const [skipExisting, setSkipExisting] = useState(true);

  const subhdEnabled = Boolean(onSearchSubHDSeasonPacks && onPrepareSubHDSeason && onInstallSubHDSeason);
  const seasonNumber = parseSeasonNumber(selectedSeason);
  const externalSearchLinks = useMemo(
    () => buildSubtitleSearchLinksByKeyword(subhdQuery || buildDefaultSeasonQuery(selectedSeries, selectedSeason, seasonVideos)),
    [selectedSeason, selectedSeries, seasonVideos, subhdQuery]
  );

  useEffect(() => {
    if (!subhdEnabled && sourceMode === "subhd") {
      setSourceMode("local");
    }
  }, [sourceMode, subhdEnabled]);

  useEffect(() => {
    setSubhdQuery(buildDefaultSeasonQuery(selectedSeries, selectedSeason, seasonVideos));
  }, [selectedSeries, selectedSeason, seasonVideos]);

  useEffect(() => {
    autoSearchStartedRef.current = false;
  }, [selectedSeries?.key, selectedSeason]);

  const batchPreferenceEntries = useMemo(() => {
    const archiveEntries = batchRawEntries.filter((entry) => /\.(zip|7z|rar)\//i.test(entry.path));
    return archiveEntries.length > 0 ? archiveEntries : batchRawEntries;
  }, [batchRawEntries]);

  const batchLanguageOptions = useMemo(() => getLanguageTypesFromEntries(batchPreferenceEntries), [batchPreferenceEntries]);
  const batchFormatOptions = useMemo(() => getSubtitleFormatsFromEntries(batchPreferenceEntries), [batchPreferenceEntries]);
  const showBatchLanguageSelector = batchLanguageOptions.length > 1;
  const showBatchFormatSelector = batchFormatOptions.length > 1;

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
      return;
    }

    const effectiveLanguagePreference = showBatchLanguageSelector ? batchLanguagePreference : "any";
    const effectiveFormatPreference = showBatchFormatSelector ? normalizeSubtitleFormat(batchFormatPreference) : "any";
    const preferred = applyBatchEntryPreferences(batchRawEntries, effectiveLanguagePreference, effectiveFormatPreference);
    const defaultSeason = seasonNumber > 0 ? seasonNumber : 0;
    let rows = buildSeasonBatchRowViews(
      buildSeasonBatchRows(batchCandidates, preferred.entries, defaultSeason),
      batchCandidates
    );

    if (sourceMode === "subhd" && subhdSuggestions.length > 0) {
      const suggestionByEntry = new Map(subhdSuggestions.map((m) => [m.archiveEntry, m]));
      rows = buildSeasonBatchRowViews(
        rows.map((row) => {
          const entryPath = row.entry.archiveEntry || row.entry.path;
          const suggestion = suggestionByEntry.get(entryPath);
          if (!suggestion) {
            return row;
          }
          if (suggestion.skipped) {
            return { ...row, selectedVideoId: "", skipped: true };
          }
          return {
            ...row,
            selectedVideoId: suggestion.videoId,
            autoVideoId: suggestion.videoId,
            skipped: false
          };
        }),
        batchCandidates
      );
    }

    setBatchRows(rows);
  }, [
    batchCandidates,
    batchRawEntries,
    batchLanguagePreference,
    batchFormatPreference,
    showBatchLanguageSelector,
    showBatchFormatSelector,
    sourceMode,
    subhdSuggestions,
    seasonNumber
  ]);

  const batchSummary = useMemo(() => summarizeSeasonBatchRows(batchRows), [batchRows]);
  const filteredBatchRows = useMemo(() => filterSeasonBatchRowViews(batchRows, batchFilter), [batchRows, batchFilter]);
  // SubHD: mapping only after prepare (cache token + entries). Local: after files parsed.
  const showMappingStep = batchRawEntries.length > 0 && (sourceMode !== "subhd" || Boolean(subhdCacheToken));
  const showSelectStep = !showMappingStep;

  async function onBatchFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) {
      return;
    }

    setBatchPreparing(true);
    setBatchInputFiles(files);
    setBatchBlockingError("");
    setBatchNotices([]);
    setBatchResult(null);
    setBatchRows([]);
    setBatchRawEntries([]);
    setBatchCandidates([]);
    setBatchLanguagePreference("any");
    setBatchFormatPreference("any");
    setBatchFilter("all");

    try {
      const loaded = await onLoadBatchCandidates();
      const candidates = filterVideosForSeason(loaded, seasonNumber);
      if (candidates.length === 0) {
        setBatchBlockingError(t("batch.noEpisodesAvailable"));
        return;
      }

      const { entries, unsupported, archiveErrors } = await collectBatchEntriesFromFiles(files);
      setBatchCandidates(candidates);

      if (entries.length === 0) {
        const reasons: string[] = [];
        if (archiveErrors.length > 0) {
          reasons.push(t("batch.archiveErrors", { value: summarizeFileNames(archiveErrors, t) }));
        }
        if (unsupported.length > 0) {
          reasons.push(t("batch.unsupportedFiles", { value: summarizeFileNames(unsupported, t) }));
        }
        setBatchBlockingError(reasons.join(" | ") || t("common.noSubtitles"));
        return;
      }

      const notices: string[] = [];
      if (unsupported.length > 0) {
        notices.push(t("batch.ignoredUnsupported", { value: summarizeFileNames(unsupported, t) }));
      }
      if (archiveErrors.length > 0) {
        notices.push(t("batch.skippedArchives", { value: summarizeFileNames(archiveErrors, t) }));
      }
      setBatchNotices(notices);
      setBatchRawEntries(entries);

      emitToast({
        level: "info",
        title: t("toast.batchPreparedTitle"),
        message: t("toast.batchPreparedMessage", { count: entries.length }),
        detail: summarizeBatchInputs(files, entries.length, t)
      });
    } catch (error) {
      const errText = error instanceof Error ? error.message : String(error);
      setBatchBlockingError(t("batch.prepareFailed", { error: errText }));
      emitToast({
        level: "error",
        title: t("toast.batchPreparationFailedTitle"),
        message: errText
      });
    } finally {
      setBatchPreparing(false);
    }
  }

  function updateBatchRowSelection(rowId: string, value: string) {
    setBatchRows((prev) =>
      buildSeasonBatchRowViews(
        prev.map((row) => {
          if (row.id !== rowId) {
            return row;
          }

          if (value === ROW_SELECT_PENDING) {
            return {
              ...row,
              selectedVideoId: "",
              skipped: false
            };
          }

          if (value === ROW_SELECT_SKIPPED) {
            return {
              ...row,
              selectedVideoId: "",
              skipped: true
            };
          }

          return {
            ...row,
            selectedVideoId: value,
            skipped: false
          };
        }),
        batchCandidates
      )
    );
  }

  function resetPreparedState() {
    setBatchInputFiles([]);
    setBatchRawEntries([]);
    setBatchRows([]);
    setBatchCandidates([]);
    setBatchBlockingError("");
    setBatchNotices([]);
    setBatchResult(null);
    setBatchFilter("all");
    setSubhdCacheToken("");
    setSubhdPackName("");
    setSubhdSuggestions([]);
  }

  function backToSelectStep() {
    resetPreparedState();
    if (sourceMode === "subhd") {
      // Keep last search results so user can pick another pack without re-searching.
      setBatchNotices([]);
    }
  }

  function switchSourceMode(mode: BatchSourceMode) {
    if (mode === sourceMode) {
      return;
    }
    setSourceMode(mode);
    resetPreparedState();
    setSubhdResults([]);
    setSelectedSubhdSid("");
    setSubhdTitlePage({});
  }

  async function searchSubHDSeason(queryOverride?: string) {
    if (!onSearchSubHDSeasonPacks) {
      return;
    }
    setSubhdSearching(true);
    setBatchBlockingError("");
    setSubhdTitlePage({});
    try {
      let candidates = batchCandidates;
      if (candidates.length === 0) {
        candidates = filterVideosForSeason(await onLoadBatchCandidates(), seasonNumber);
        setBatchCandidates(candidates);
      }
      const anchor = candidates[0] || seasonVideos[0];
      if (!anchor) {
        setBatchBlockingError(t("batch.noEpisodesAvailable"));
        return;
      }

      const effectiveQuery = (queryOverride ?? subhdQuery).trim();
      const page = await onSearchSubHDSeasonPacks(anchor, {
        query: effectiveQuery || undefined,
        season: seasonNumber >= 0 ? seasonNumber : undefined
      });
      const items = Array.isArray(page.items) ? [...page.items] : [];
      items.sort((a, b) => scoreSeasonPackResult(b, seasonNumber) - scoreSeasonPackResult(a, seasonNumber));
      setSubhdResults(items);
      const best = items.find((item) => item.installable) || items[0];
      setSelectedSubhdSid(best?.sid || "");
      if (page.query) {
        setSubhdQuery(page.query);
      }
      setSubhdTitlePage({
        doubanId: page.doubanId,
        title: page.title,
        url: page.titlePageUrl,
        message: page.message
      });
      if (items.length === 0) {
        setBatchNotices([page.message?.trim() ? page.message : t("batch.subhd.noPacks")]);
      } else {
        // Title page is already shown via subhdTitlePage UI; keep notices empty.
        setBatchNotices([]);
      }
    } catch (error) {
      const errText = error instanceof Error ? error.message : String(error);
      setBatchBlockingError(errText);
      setSubhdResults([]);
      setSelectedSubhdSid("");
    } finally {
      setSubhdSearching(false);
    }
  }

  useEffect(() => {
    if (!autoSearchOnMount || !subhdEnabled || autoSearchStartedRef.current) {
      return;
    }
    autoSearchStartedRef.current = true;
    const query = buildDefaultSeasonQuery(selectedSeries, selectedSeason, seasonVideos);
    setSourceMode("subhd");
    setSubhdQuery(query);
    void searchSubHDSeason(query);
    // Intentionally run once per open/season; searchSubHDSeason closes over latest callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSearchOnMount, subhdEnabled, selectedSeries?.key, selectedSeason]);

  async function prepareSelectedSubHDPack() {
    if (!onPrepareSubHDSeason) {
      return;
    }
    const sid = selectedSubhdSid.trim();
    if (!sid) {
      setBatchBlockingError(t("batch.subhd.selectResult"));
      return;
    }

    setBatchPreparing(true);
    setBatchBlockingError("");
    setBatchResult(null);
    setBatchRows([]);
    setBatchRawEntries([]);
    setSubhdCacheToken("");
    setSubhdPackName("");

    try {
      let candidates = batchCandidates;
      if (candidates.length === 0) {
        candidates = filterVideosForSeason(await onLoadBatchCandidates(), seasonNumber);
      } else {
        candidates = filterVideosForSeason(candidates, seasonNumber);
      }
      if (candidates.length === 0) {
        setBatchBlockingError(t("batch.noEpisodesAvailable"));
        return;
      }
      setBatchCandidates(candidates);

      const prepared = await onPrepareSubHDSeason({
        sid,
        videoIds: candidates.map((video) => video.id),
        season: seasonNumber > 0 ? seasonNumber : undefined,
        languagePreference: batchLanguagePreference,
        formatPreference: batchFormatPreference,
        skipExisting,
        label: batchLabel.trim() || "zh"
      });

      const entries: ZipSubtitleEntry[] = (prepared.entries || []).map((entry, index) => {
        const pathValue = (entry.path || entry.fileName || "").replace(/\\/g, "/").replace(/^\/+/, "");
        return {
          id: `subhd-${index}-${pathValue.toLowerCase()}`,
          path: `${prepared.fileName || "pack"}/${pathValue}`,
          fileName: entry.fileName || pathValue.split("/").pop() || pathValue,
          size: Number(entry.size) || 0,
          archiveEntry: pathValue,
          cacheToken: prepared.cacheToken
        };
      });

      if (entries.length === 0) {
        setBatchBlockingError(t("common.noSubtitles"));
        return;
      }

      setSubhdCacheToken(prepared.cacheToken);
      setSubhdPackName(prepared.fileName || sid);
      setSubhdSuggestions(prepared.suggestedMappings || []);
      setBatchRawEntries(entries);
      setBatchNotices(prepared.notices || []);

      emitToast({
        level: "info",
        title: t("toast.batchPreparedTitle"),
        message: t("toast.batchPreparedMessage", { count: entries.length }),
        detail: prepared.fileName
      });
    } catch (error) {
      const errText = error instanceof Error ? error.message : String(error);
      setBatchBlockingError(t("batch.prepareFailed", { error: errText }));
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

    if (sourceMode === "subhd") {
      if (!onInstallSubHDSeason || !subhdCacheToken) {
        setBatchBlockingError(t("batch.subhd.prepareFirst"));
        return;
      }
      const mappings = [];
      for (const row of batchRows) {
        if (!row.selectedVideoId || row.skipped) {
          continue;
        }
        if (!map.has(row.selectedVideoId)) {
          continue;
        }
        const archiveEntry = row.entry.archiveEntry || row.entry.path;
        if (!archiveEntry) {
          continue;
        }
        mappings.push({
          videoId: row.selectedVideoId,
          archiveEntry,
          label
        });
      }
      if (mappings.length === 0) {
        setBatchBlockingError(t("batch.mapAtLeastOne"));
        return;
      }
      setBatchBlockingError("");
      const result = await onInstallSubHDSeason({ cacheToken: subhdCacheToken, mappings });
      setBatchResult(result);
      onComplete?.(result);
      return;
    }

    const items: BatchSubtitleUploadItem[] = [];
    for (const row of batchRows) {
      if (!row.selectedVideoId || row.skipped) {
        continue;
      }
      const matchedVideo = map.get(row.selectedVideoId);
      if (!matchedVideo) {
        continue;
      }
      if (row.entry.archiveEntry && row.entry.sourceFile) {
        items.push({
          video: matchedVideo,
          file: row.entry.sourceFile,
          label,
          sourceName: row.entry.path,
          archiveEntry: row.entry.archiveEntry
        });
        continue;
      }
      if (row.entry.plainFile) {
        items.push({
          video: matchedVideo,
          file: row.entry.plainFile,
          label,
          sourceName: row.entry.path
        });
      }
    }

    if (items.length === 0) {
      setBatchBlockingError(t("batch.mapAtLeastOne"));
      return;
    }

    setBatchBlockingError("");
    const result = await onUploadBatch(items);
    setBatchResult(result);
    onComplete?.(result);
  }

  const filterActions: { key: SeasonBatchMappingFilter; label: string; count: number }[] = [
    { key: "all", label: t("batch.filter.all"), count: batchSummary.total },
    { key: "pending", label: t("common.pending"), count: batchSummary.unassigned },
    { key: "mapped", label: t("batch.filter.mapped"), count: batchSummary.mapped },
    { key: "skipped", label: t("batch.filter.skipped"), count: batchSummary.skipped }
  ];

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
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
        {(batchPreparing || uploading || subhdSearching) ? (
          <div className="flex flex-wrap items-center gap-2">
            {batchPreparing ? <InlinePending label={t("batch.preparing")} /> : null}
            {subhdSearching ? <InlinePending label={t("batch.subhd.searching")} /> : null}
            {uploading ? <InlinePending label={uploadingMessage || t("batch.uploadingMapped")} /> : null}
          </div>
        ) : null}

        {batchBlockingError ? (
          <div className="surface-status-destructive border px-4 py-3">
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-sm">{batchBlockingError}</p>
            </div>
          </div>
        ) : null}

        {showSelectStep ? (
          <>
            {subhdEnabled ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={sourceMode === "subhd" ? "default" : "outline"}
                  disabled={busy || batchPreparing || uploading}
                  onClick={() => switchSourceMode("subhd")}
                >
                  {t("batch.source.subhd")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={sourceMode === "local" ? "default" : "outline"}
                  disabled={busy || batchPreparing || uploading}
                  onClick={() => switchSourceMode("local")}
                >
                  {t("batch.source.localFallback")}
                </Button>
              </div>
            ) : null}

            {sourceMode === "subhd" ? (
              <div className="surface-panel space-y-3 p-3 sm:p-4">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={subhdQuery}
                    onChange={(event) => setSubhdQuery(event.target.value)}
                    placeholder={t("batch.subhd.queryPlaceholder")}
                    disabled={busy || batchPreparing || uploading || subhdSearching}
                    className="h-9"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    disabled={busy || batchPreparing || uploading || subhdSearching}
                    onClick={() => void searchSubHDSeason()}
                    title={subhdSearching ? t("batch.subhd.searching") : t("common.search")}
                    aria-label={subhdSearching ? t("batch.subhd.searching") : t("common.search")}
                  >
                    {subhdSearching ? <SpinnerIcon className="h-4 w-4" /> : <Search className="h-4 w-4" />}
                  </Button>
                </div>

                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={skipExisting}
                    disabled={busy || batchPreparing || uploading}
                    onChange={(event) => setSkipExisting(event.target.checked)}
                  />
                  {t("batch.subhd.skipExisting")}
                </label>

                {subhdTitlePage.doubanId ? (
                  <p className="text-xs text-muted-foreground">
                    {t("batch.subhd.titlePage", {
                      title: subhdTitlePage.title || "-",
                      id: subhdTitlePage.doubanId
                    })}
                    {subhdTitlePage.url ? (
                      <>
                        {" · "}
                        <a
                          className="underline underline-offset-2 hover:text-foreground"
                          href={`https://subhd.tv${subhdTitlePage.url.startsWith("/") ? subhdTitlePage.url : `/${subhdTitlePage.url}`}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {subhdTitlePage.url}
                        </a>
                      </>
                    ) : null}
                  </p>
                ) : null}

                {batchNotices.length > 0 ? (
                  <div className="space-y-1 text-sm text-muted-foreground">
                    {batchNotices.map((notice) => (
                      <p key={notice}>{notice}</p>
                    ))}
                  </div>
                ) : null}

                {subhdResults.length > 0 ? (
                  <div className="max-h-[min(50vh,420px)] space-y-2 overflow-auto">
                    {subhdResults.slice(0, 20).map((item) => {
                      const selected = selectedSubhdSid === item.sid;
                      return (
                        <button
                          key={item.sid}
                          type="button"
                          disabled={!item.installable || busy || batchPreparing || uploading}
                          onClick={() => setSelectedSubhdSid(item.sid)}
                          className={cn(
                            "flex w-full flex-col gap-1 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                            selected ? "border-primary bg-primary/5" : "border-border hover:bg-surface-hover",
                            !item.installable && "opacity-50"
                          )}
                        >
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="secondary">{t("batch.subhd.packBadge")}</Badge>
                            <span className="font-semibold">{item.version || item.title || item.sid}</span>
                            {item.format ? <Badge variant="outline">{item.format}</Badge> : null}
                            {!item.installable ? <Badge variant="secondary">{t("download.notInstallable")}</Badge> : null}
                          </div>
                          {item.langs && item.langs.length > 0 ? (
                            <span className="text-xs text-muted-foreground">{item.langs.join(" / ")}</span>
                          ) : null}
                          {item.downloads ? (
                            <span className="text-xs text-muted-foreground">
                              {t("download.downloads")}: {item.downloads}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {!subhdSearching && subhdResults.length === 0 && (batchNotices.length > 0 || subhdTitlePage.message) ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      title={t("download.openSubHDSearch")}
                      aria-label={t("download.openSubHDSearch")}
                      asChild
                    >
                      <a href={externalSearchLinks.subhd} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      title={t("download.openZimuku")}
                      aria-label={t("download.openZimuku")}
                      asChild
                    >
                      <a href={externalSearchLinks.zimuku} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  <Button
                    type="button"
                    disabled={!selectedSubhdSid || busy || batchPreparing || uploading || subhdSearching}
                    onClick={() => void prepareSelectedSubHDPack()}
                  >
                    {batchPreparing ? <SpinnerIcon className="h-4 w-4" /> : null}
                    {t("batch.subhd.prepare")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="surface-panel space-y-3 p-4">
                <Button
                  type="button"
                  disabled={busy || batchPreparing}
                  onClick={() => batchInputRef.current?.click()}
                >
                  {t("batch.selectFiles")}
                </Button>
                {batchNotices.length > 0 ? (
                  <div className="space-y-1 text-sm text-muted-foreground">
                    {batchNotices.map((notice) => (
                      <p key={notice}>{notice}</p>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </>
        ) : null}

        {showMappingStep ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-semibold">{t("batch.mappingStepTitle")}</p>
                {sourceMode === "subhd" && subhdPackName ? (
                  <p className="text-xs text-muted-foreground">{subhdPackName}</p>
                ) : null}
                {sourceMode === "local" && batchInputFiles.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {summarizeBatchInputs(batchInputFiles, batchRawEntries.length, t)}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={busy || batchPreparing || uploading}
                onClick={backToSelectStep}
                title={t("batch.backToSelect")}
                aria-label={t("batch.backToSelect")}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
              </Button>
            </div>

            {batchNotices.length > 0 ? (
              <div className="surface-panel px-4 py-3">
                <div className="flex items-start gap-3">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="space-y-2 text-sm text-muted-foreground">
                    {batchNotices.map((notice) => (
                      <p key={notice}>{notice}</p>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="space-y-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap gap-2">
                  {filterActions.map((item) => (
                    <Button
                      key={item.key}
                      type="button"
                      size="sm"
                      variant={batchFilter === item.key ? "default" : "outline"}
                      disabled={batchRows.length === 0}
                      onClick={() => setBatchFilter(item.key)}
                    >
                      {item.label}
                      <Badge
                        variant={batchFilter === item.key ? "secondary" : "outline"}
                        className={cn(
                          "px-2 py-0 text-micro",
                          batchFilter === item.key && "border-transparent bg-primary-foreground/10 text-current"
                        )}
                      >
                        {item.count}
                      </Badge>
                    </Button>
                  ))}
                </div>
                {batchSummary.total > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {filteredBatchRows.length}/{batchSummary.total}
                  </p>
                ) : null}
              </div>

              <div className={cn("space-y-3", batchPreparing && "animate-pulse-soft")}>
                {filteredBatchRows.length > 0 ? (
                  filteredBatchRows.map((row) => (
                    <MappingRow
                      key={row.id}
                      row={row}
                      videos={batchCandidates}
                      disabled={busy || batchPreparing || uploading}
                      t={t}
                      onSelectionChange={updateBatchRowSelection}
                    />
                  ))
                ) : (
                  <div className="surface-panel px-6 py-10 text-center text-sm text-muted-foreground">
                    {batchRows.length === 0 ? t("batch.empty") : t("batch.filterEmpty")}
                  </div>
                )}
              </div>
            </div>

            {batchResult ? (
              <WorkspaceSection icon={<CircleCheck className="h-4 w-4" />} title={t("batch.resultsTitle")}>
                <div className="space-y-4">
                  <div className="surface-panel px-4 py-3 text-sm">
                    {t("batch.result", {
                      success: batchResult.success,
                      total: batchResult.total,
                      failed: batchResult.failed
                    })}
                  </div>
                  {batchResult.errors.length > 0 ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <CircleAlert className="h-4 w-4" />
                        {t("batch.resultErrorsTitle")}
                      </div>
                      <div className="space-y-2">
                        {batchResult.errors.slice(0, 6).map((item) => (
                          <div key={item} className="surface-panel px-4 py-3 text-sm break-all">
                            {item}
                          </div>
                        ))}
                        {batchResult.errors.length > 6 ? (
                          <p className="text-xs text-muted-foreground">
                            {t("batch.summary.more", { count: batchResult.errors.length - 6 })}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              </WorkspaceSection>
            ) : null}
          </>
        ) : null}

        {batchPreparing ? <PanelLoadingOverlay label={t("batch.preparing")} /> : null}
      </div>

      {showMappingStep ? (
        <div className="mt-4 shrink-0 border-t border-border pt-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
              {showBatchLanguageSelector ? (
                <div className="space-y-2 lg:w-[220px]">
                  <p className="text-caption font-semibold uppercase tracking-section text-foreground-muted">
                    {t("common.language")}
                  </p>
                  <Select
                    value={batchLanguagePreference === "any" ? batchLanguageOptions[0] : batchLanguagePreference}
                    onValueChange={(value) => setBatchLanguagePreference(value as BatchLanguagePreference)}
                    disabled={busy || batchPreparing || batchRawEntries.length === 0}
                  >
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue placeholder={t("common.language")} />
                    </SelectTrigger>
                    <SelectContent>
                      {batchLanguageOptions.map((item) => (
                        <SelectItem key={item} value={item}>
                          {formatLanguageTypeLabel(item, t)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {showBatchFormatSelector ? (
                <div className="space-y-2 lg:w-[220px] lg:border-l lg:border-border lg:pl-3">
                  <p className="text-caption font-semibold uppercase tracking-section text-foreground-muted">
                    {t("common.format")}
                  </p>
                  <Select
                    value={batchFormatPreference === "any" ? batchFormatOptions[0] : batchFormatPreference}
                    onValueChange={(value) => setBatchFormatPreference(normalizeSubtitleFormat(value))}
                    disabled={busy || batchPreparing || batchRawEntries.length === 0}
                  >
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue placeholder={t("common.format")} />
                    </SelectTrigger>
                    <SelectContent>
                      {batchFormatOptions.map((ext) => (
                        <SelectItem key={ext} value={ext}>
                          {formatSubtitleExtLabel(ext)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              <div className="space-y-2 lg:w-[180px] lg:border-l lg:border-border lg:pl-3">
                <p className="text-caption font-semibold uppercase tracking-section text-foreground-muted">
                  {t("batch.label")}
                </p>
                <Input
                  value={batchLabel}
                  maxLength={32}
                  placeholder="zh"
                  className="h-9 w-full"
                  disabled={busy || batchPreparing}
                  onChange={(event) => setBatchLabel(event.target.value)}
                />
              </div>
            </div>

            <div className="flex shrink-0 flex-col-reverse gap-2 lg:flex-row lg:justify-end">
              <Button
                type="button"
                disabled={
                  busy ||
                  batchPreparing ||
                  batchSummary.mapped === 0 ||
                  (sourceMode === "subhd" && !subhdCacheToken)
                }
                onClick={() => void submitSeasonBatch()}
              >
                {sourceMode === "subhd" ? t("batch.subhd.installMapped") : t("common.upload")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
