import { useEffect, useMemo, useRef, useState, type ChangeEvent, type RefObject } from "react";

import { useI18n } from "@/lib/i18n";
import type {
  BatchSubtitleUploadItem,
  BatchSubtitleUploadResult,
  SubHDSearchResult,
  SubHDSeasonSuggestedMapping,
  Video
} from "@/lib/types";
import { emitToast } from "@/lib/toast";
import { buildSubtitleSearchLinksByKeyword } from "@/lib/subtitle-search";
import type { ZipSubtitleEntry } from "@/lib/subtitle-zip";
import type { BatchLanguagePreference, SeasonBatchMappingFilter, SeasonBatchRowView } from "../../types";
import {
  applyBatchEntryPreferences,
  buildSeasonBatchRows,
  buildSeasonBatchRowsFromSubHDSuggestions,
  buildSeasonBatchRowViews,
  collectBatchEntriesFromFiles,
  filterSeasonBatchRowViews,
  getLanguageTypesFromEntries,
  getSubtitleFormatsFromEntries,
  normalizeSubtitleFormat,
  summarizeFileNames,
  summarizeSeasonBatchRows
} from "../batch-utils";
import { mapSubHDPrepareEntries } from "./season-batch-entries";
import {
  buildDefaultSeasonQuery,
  filterVideosForSeason,
  parseSeasonNumber,
  scoreSeasonPackResult
} from "./season-query";
import type { BatchSourceMode, TvSeasonBatchUploadWorkspaceProps } from "./types";
import { ROW_SELECT_PENDING, ROW_SELECT_SKIPPED } from "./types";

export function useSeasonBatchWorkspace({
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
  autoSearchOnMount = false
}: Omit<TvSeasonBatchUploadWorkspaceProps, "className">) {
  const { t } = useI18n();
  const batchInputRef = useRef<HTMLInputElement | null>(null);
  const autoSearchStartedRef = useRef(false);
  const [sourceMode, setSourceMode] = useState<BatchSourceMode>("subhd");
  const [batchPreparing, setBatchPreparing] = useState(false);
  const [batchInputFiles, setBatchInputFiles] = useState<File[]>([]);
  const [batchRawEntries, setBatchRawEntries] = useState<ZipSubtitleEntry[]>([]);
  const [batchRows, setBatchRows] = useState<SeasonBatchRowView[]>([]);
  const [batchCandidates, setBatchCandidates] = useState<Video[]>([]);
  const [batchLanguagePreference, setBatchLanguagePreference] = useState<BatchLanguagePreference>("bilingual");
  const [batchFormatPreference, setBatchFormatPreference] = useState("any");
  const [batchLabel, setBatchLabel] = useState("");
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
      if (batchLanguageOptions[0] && batchLanguagePreference !== batchLanguageOptions[0] && batchLanguagePreference !== "any") {
        setBatchLanguagePreference(batchLanguageOptions[0]);
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

    const defaultSeason = seasonNumber > 0 ? seasonNumber : 0;

    // SubHD prepare: trust server suggestedMappings (prefs already applied server-side).
    if (sourceMode === "subhd" && subhdCacheToken) {
      setBatchRows(
        buildSeasonBatchRowViews(
          buildSeasonBatchRowsFromSubHDSuggestions(batchRawEntries, subhdSuggestions, defaultSeason),
          batchCandidates
        )
      );
      return;
    }

    // Local upload: FE still owns preference filtering + S/E auto-map.
    const effectiveLanguagePreference = showBatchLanguageSelector ? batchLanguagePreference : "any";
    const effectiveFormatPreference = showBatchFormatSelector ? normalizeSubtitleFormat(batchFormatPreference) : "any";
    const preferred = applyBatchEntryPreferences(batchRawEntries, effectiveLanguagePreference, effectiveFormatPreference);
    setBatchRows(buildSeasonBatchRowViews(buildSeasonBatchRows(batchCandidates, preferred.entries, defaultSeason), batchCandidates));
  }, [
    batchCandidates,
    batchRawEntries,
    batchLanguagePreference,
    batchFormatPreference,
    showBatchLanguageSelector,
    showBatchFormatSelector,
    sourceMode,
    subhdCacheToken,
    subhdSuggestions,
    seasonNumber
  ]);

  const batchSummary = useMemo(() => summarizeSeasonBatchRows(batchRows), [batchRows]);
  const filteredBatchRows = useMemo(() => filterSeasonBatchRowViews(batchRows, batchFilter), [batchRows, batchFilter]);
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
        message: t("toast.batchPreparedMessage", { count: entries.length })
      });
    } catch (error) {
      const errText = error instanceof Error ? error.message : String(error);
      setBatchBlockingError(t("batch.prepareFailed", { error: errText }));
      emitToast({
        level: "error",
        message: t("toast.batchPreparationFailedTitle"),
        detail: errText
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
        label: batchLabel.trim()
      });

      const entries = mapSubHDPrepareEntries(prepared);

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
        message: t("toast.batchPreparedMessage", { count: entries.length }),
        detail: prepared.fileName
      });
    } catch (error) {
      const errText = error instanceof Error ? error.message : String(error);
      setBatchBlockingError(t("batch.prepareFailed", { error: errText }));
      emitToast({
        level: "error",
        message: t("toast.batchPreparationFailedTitle"),
        detail: errText
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

  return {
    t,
    batchInputRef: batchInputRef as RefObject<HTMLInputElement | null>,
    busy,
    uploading,
    uploadingMessage,
    sourceMode,
    batchPreparing,
    batchInputFiles,
    batchRawEntries,
    batchRows,
    batchCandidates,
    batchLanguagePreference,
    setBatchLanguagePreference,
    batchFormatPreference,
    setBatchFormatPreference,
    batchLabel,
    setBatchLabel,
    batchBlockingError,
    batchNotices,
    batchResult,
    batchFilter,
    setBatchFilter,
    subhdQuery,
    setSubhdQuery,
    subhdSearching,
    subhdResults,
    selectedSubhdSid,
    setSelectedSubhdSid,
    subhdCacheToken,
    subhdPackName,
    subhdTitlePage,
    skipExisting,
    setSkipExisting,
    subhdEnabled,
    externalSearchLinks,
    batchLanguageOptions,
    batchFormatOptions,
    showBatchLanguageSelector,
    showBatchFormatSelector,
    batchSummary,
    filteredBatchRows,
    showMappingStep,
    showSelectStep,
    filterActions,
    onBatchFilesSelected,
    updateBatchRowSelection,
    backToSelectStep,
    switchSourceMode,
    searchSubHDSeason,
    prepareSelectedSubHDPack,
    submitSeasonBatch,
    onComplete
  };
}

export type SeasonBatchWorkspaceModel = ReturnType<typeof useSeasonBatchWorkspace>;
