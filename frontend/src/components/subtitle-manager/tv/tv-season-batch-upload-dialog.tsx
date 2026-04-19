import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, ListFilter, TriangleAlert } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import type { BatchSubtitleUploadItem, BatchSubtitleUploadResult, Video } from "@/lib/types";
import { emitToast } from "@/lib/toast";
import { toSubtitleFile, type ZipSubtitleEntry } from "@/lib/subtitle-zip";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import type {
  BatchLanguagePreference,
  SeasonBatchMappingFilter,
  SeasonBatchMappingStatus,
  SeasonBatchRowView
} from "../types";
import { InlinePending, PanelLoadingOverlay } from "../shared/pending-state";
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
    <Card className={cn("border border-border/70 bg-card", className)}>
      <CardHeader className="gap-4 border-b border-border/60 p-5 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center border border-border/70 bg-surface-subtle text-muted-foreground">
              {icon}
            </div>
            <div className="min-w-0">
              <CardTitle className="text-lg font-semibold tracking-tight md:text-xl">{title}</CardTitle>
              {description ? <CardDescription className="mt-1 max-w-3xl text-sm">{description}</CardDescription> : null}
            </div>
          </div>
        </div>
        {aside ? <div className="flex shrink-0 flex-wrap items-center gap-2">{aside}</div> : null}
      </CardHeader>
      <CardContent className="p-5">{children}</CardContent>
    </Card>
  );
}

function MappingStatusBadge({ status, label }: { status: SeasonBatchMappingStatus; label: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "px-3 py-1",
        status === "unassigned" && "border-input bg-surface-strong text-foreground",
        status === "manual" && "border-border bg-surface-subtle text-foreground",
        status === "auto" && "border-border bg-transparent text-muted-foreground",
        status === "skipped" && "border-border bg-transparent text-foreground-muted"
      )}
    >
      {label}
    </Badge>
  );
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
    <div
      className={cn(
        "border p-4 transition-colors",
        row.status === "unassigned" && "border-input bg-card",
        row.status === "manual" && "border-border/80 bg-surface-subtle",
        row.status === "auto" && "border-border/60 bg-background",
        row.status === "skipped" && "border-border/60 bg-background/70"
      )}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="break-all text-sm font-semibold">{fileName}</p>
              <p className="mt-1 break-all text-xs text-muted-foreground">{sourcePath || t("batch.directInput")}</p>
            </div>
            <MappingStatusBadge status={row.status} label={t(`batch.status.${row.status}`)} />
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="px-3 py-1 text-foreground">
              {formatSeasonEpisodeText(row.season, row.episode)}
            </Badge>
            <Badge variant="outline" className="px-3 py-1">
              {formatLanguageTypeLabel(row.languageType, t)}
            </Badge>
            {row.format ? (
              <Badge variant="outline" className="px-3 py-1">
                {formatSubtitleExtLabel(row.format)}
              </Badge>
            ) : null}
            <Badge variant="outline" className="px-3 py-1">
              {t("batch.candidates", { count: row.candidateCount })}
            </Badge>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground-muted">
            {t("batch.targetEpisode")}
          </p>
          <Select value={selectValue} onValueChange={(value) => onSelectionChange(row.id, value)} disabled={disabled}>
            <SelectTrigger className="h-10 w-full bg-card">
              <SelectValue placeholder={t("batch.chooseEpisode")} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value={ROW_SELECT_PENDING}>{t("batch.pendingReview")}</SelectItem>
              <SelectItem value={ROW_SELECT_SKIPPED}>{t("batch.skip")}</SelectItem>
              {candidates.map((video) => (
                <SelectItem key={`${row.id}-${video.id}`} value={video.id}>
                  {video.fileName}
                </SelectItem>
              ))}
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
  className,
  onRequestClose,
  showCloseButton = false
}: TvSeasonBatchUploadWorkspaceProps) {
  const { t } = useI18n();
  const batchInputRef = useRef<HTMLInputElement | null>(null);
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
    const rows = buildSeasonBatchRows(batchCandidates, preferred.entries);
    setBatchRows(buildSeasonBatchRowViews(rows, batchCandidates));
  }, [
    batchCandidates,
    batchRawEntries,
    batchLanguagePreference,
    batchFormatPreference,
    showBatchLanguageSelector,
    showBatchFormatSelector
  ]);

  const batchSummary = useMemo(() => summarizeSeasonBatchRows(batchRows), [batchRows]);
  const filteredBatchRows = useMemo(() => filterSeasonBatchRowViews(batchRows, batchFilter), [batchRows, batchFilter]);

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
      const candidates = await onLoadBatchCandidates();
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
        setBatchBlockingError(reasons.join(" | ") || t("batch.noSubtitleFiles"));
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

  async function submitSeasonBatch() {
    if (batchRows.length === 0 || batchCandidates.length === 0) {
      return;
    }

    const map = new Map(batchCandidates.map((video) => [video.id, video]));
    const label = batchLabel.trim();
    const items: BatchSubtitleUploadItem[] = [];
    for (const row of batchRows) {
      if (!row.selectedVideoId || row.skipped) {
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
      setBatchBlockingError(t("batch.mapAtLeastOne"));
      return;
    }

    setBatchBlockingError("");
    const result = await onUploadBatch(items);
    setBatchResult(result);
  }

  const filterActions: { key: SeasonBatchMappingFilter; label: string; count: number }[] = [
    { key: "all", label: t("batch.filter.all"), count: batchSummary.total },
    { key: "pending", label: t("batch.filter.pending"), count: batchSummary.unassigned },
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
        <div className="grid gap-3 border-b border-border/70 pb-4 md:grid-cols-[auto_repeat(3,minmax(0,220px))] md:items-end">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-foreground-muted">
              {t("batch.file")}
            </p>
            <Button
              type="button"
              variant={batchInputFiles.length > 0 ? "outline" : "default"}
              disabled={busy || batchPreparing}
              className="w-full md:w-auto"
              onClick={() => batchInputRef.current?.click()}
            >
              {batchInputFiles.length > 0 ? t("batch.reselectFiles") : t("batch.selectFiles")}
            </Button>
          </div>

          {showBatchLanguageSelector ? (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-foreground-muted">
                {t("batch.languageType")}
              </p>
              <Select
                value={batchLanguagePreference === "any" ? batchLanguageOptions[0] : batchLanguagePreference}
                onValueChange={(value) => setBatchLanguagePreference(value as BatchLanguagePreference)}
                disabled={busy || batchPreparing || batchRawEntries.length === 0}
              >
                <SelectTrigger className="h-10 w-full bg-card">
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
            </div>
          ) : (
            <div className="hidden md:block" />
          )}

          {showBatchFormatSelector ? (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-foreground-muted">
                {t("batch.format")}
              </p>
              <Select
                value={batchFormatPreference === "any" ? batchFormatOptions[0] : batchFormatPreference}
                onValueChange={(value) => setBatchFormatPreference(normalizeSubtitleFormat(value))}
                disabled={busy || batchPreparing || batchRawEntries.length === 0}
              >
                <SelectTrigger className="h-10 w-full bg-card">
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
            </div>
          ) : (
            <div className="hidden md:block" />
          )}

          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-foreground-muted">
              {t("batch.label")}
            </p>
            <Input
              value={batchLabel}
              maxLength={32}
              placeholder="zh"
              className="h-10 w-full bg-card"
              disabled={busy || batchPreparing}
              onChange={(event) => setBatchLabel(event.target.value)}
            />
          </div>
        </div>

        {(batchPreparing || uploading) ? (
          <div className="flex flex-wrap items-center gap-2">
            {batchPreparing ? <InlinePending label={t("batch.preparing")} /> : null}
            {uploading ? <InlinePending label={uploadingMessage || t("batch.uploadingMapped")} /> : null}
          </div>
        ) : null}

        {batchNotices.length > 0 ? (
          <div className="border border-border/60 bg-surface-subtle px-4 py-3">
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

        {batchBlockingError ? (
          <div className="border border-input bg-card px-4 py-3">
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
              <p className="text-sm text-foreground">{batchBlockingError}</p>
            </div>
          </div>
        ) : null}

        <WorkspaceSection
          icon={<ListFilter className="h-4 w-4" />}
          title={t("batch.mappingTitle")}
          className="min-h-[320px]"
        >
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
                        "px-2 py-0 text-[10px]",
                        batchFilter === item.key && "border-transparent bg-primary-foreground/10 text-current"
                      )}
                    >
                      {item.count}
                    </Badge>
                  </Button>
                ))}
              </div>
              {batchSummary.total > 0 ? <p className="text-sm text-muted-foreground">{filteredBatchRows.length}/{batchSummary.total}</p> : null}
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
                <div className="border border-dashed border-border/70 bg-surface-subtle px-6 py-10 text-center">
                  <p className="text-sm text-muted-foreground">
                    {batchRows.length === 0 ? t("batch.empty") : t("batch.filterEmpty")}
                  </p>
                </div>
              )}
            </div>
          </div>
        </WorkspaceSection>

        {batchResult ? (
          <WorkspaceSection
            icon={<CircleCheck className="h-4 w-4" />}
            title={t("batch.resultsTitle")}
          >
            <div className="space-y-4">
              <div className="border border-border/60 bg-surface-subtle px-4 py-3 text-sm">
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
                      <div key={item} className="border border-border/60 bg-background px-4 py-3 text-sm break-all">
                        {item}
                      </div>
                    ))}
                    {batchResult.errors.length > 6 ? (
                      <p className="text-xs text-muted-foreground">{t("batch.summary.more", { count: batchResult.errors.length - 6 })}</p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </WorkspaceSection>
        ) : null}

        {batchPreparing ? <PanelLoadingOverlay label={t("batch.preparing")} /> : null}
      </div>

      <div className="mt-4 shrink-0 border-t border-border pt-3">
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {showCloseButton && onRequestClose ? (
            <Button type="button" variant="outline" onClick={onRequestClose}>
              {t("common.close")}
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={busy || batchPreparing || batchSummary.mapped === 0}
            onClick={() => void submitSeasonBatch()}
          >
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
      <DialogContent className="flex max-h-[86vh] flex-col overflow-hidden sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t("batch.dialogTitle")}</DialogTitle>
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
