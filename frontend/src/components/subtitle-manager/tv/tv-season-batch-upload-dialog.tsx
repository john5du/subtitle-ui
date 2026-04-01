import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

import { useI18n } from "@/lib/i18n";
import type { BatchSubtitleUploadItem, BatchSubtitleUploadResult, Video } from "@/lib/types";
import { emitToast } from "@/lib/toast";
import { toSubtitleFile, type ZipSubtitleEntry } from "@/lib/subtitle-zip";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import type { BatchLanguagePreference, SeasonBatchMappingRow } from "../types";
import { InlinePending, PanelLoadingOverlay } from "../shared/pending-state";
import {
  applyBatchEntryPreferences,
  buildSeasonBatchRows,
  candidateVideosForBatchRow,
  collectBatchEntriesFromFiles,
  formatLanguageTypeLabel,
  formatSeasonEpisodeText,
  formatSubtitleExtLabel,
  getLanguageTypesFromEntries,
  getSubtitleFormatsFromEntries,
  normalizeSubtitleFormat,
  summarizeBatchInputs,
  summarizeFileNames
} from "./batch-utils";

interface TvSeasonBatchUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  uploading: boolean;
  uploadingMessage: string;
  onLoadBatchCandidates: () => Promise<Video[]>;
  onUploadBatch: (items: BatchSubtitleUploadItem[]) => Promise<BatchSubtitleUploadResult>;
}

interface TvSeasonBatchUploadWorkspaceProps
  extends Omit<TvSeasonBatchUploadDialogProps, "open" | "onOpenChange"> {
  className?: string;
  onRequestClose?: () => void;
  showCloseButton?: boolean;
  showSummary?: boolean;
}

export function TvSeasonBatchUploadWorkspace({
  busy,
  uploading,
  uploadingMessage,
  onLoadBatchCandidates,
  onUploadBatch,
  className,
  onRequestClose,
  showCloseButton = false,
  showSummary = true
}: TvSeasonBatchUploadWorkspaceProps) {
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

  async function onBatchFilesSelected(event: ChangeEvent<HTMLInputElement>) {
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

      {showSummary && (
        <div className="mb-4 rounded-xl border border-border/70 bg-background/60 px-4 py-3 text-sm text-muted-foreground">
          {t("batch.dialogDescription", {
            summary: batchSourceSummary || "-",
            autoMatched: autoMatchedCount,
            total: batchRows.length,
            selected: mappedCount
          })}
        </div>
      )}

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
          {batchError && <p className="text-xs text-destructive">{batchError}</p>}
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

      <div className="mt-4 shrink-0 border-t border-border/70 pt-3">
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {showCloseButton && onRequestClose ? (
            <Button type="button" variant="outline" onClick={onRequestClose}>
              {t("common.close")}
            </Button>
          ) : null}
          <Button type="button" disabled={busy || batchPreparing || batchRows.length === 0} onClick={() => void submitSeasonBatch()}>
            {t("batch.uploadMapped")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function TvSeasonBatchUploadDialog({
  open,
  onOpenChange,
  busy,
  uploading,
  uploadingMessage,
  onLoadBatchCandidates,
  onUploadBatch
}: TvSeasonBatchUploadDialogProps) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[86vh] flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t("batch.dialogTitle")}</DialogTitle>
          <DialogDescription>{t("batch.duplicateHint")}</DialogDescription>
        </DialogHeader>

        <TvSeasonBatchUploadWorkspace
          className="min-h-0 flex-1"
          busy={busy}
          uploading={uploading}
          uploadingMessage={uploadingMessage}
          onLoadBatchCandidates={onLoadBatchCandidates}
          onUploadBatch={onUploadBatch}
          onRequestClose={() => onOpenChange(false)}
          showCloseButton={true}
          showSummary={true}
        />
      </DialogContent>
    </Dialog>
  );
}
