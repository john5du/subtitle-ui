import { ArrowLeft, CircleAlert, CircleCheck, Info } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import type { BatchLanguagePreference } from "../../types";
import {
  formatLanguageTypeLabel,
  formatSubtitleExtLabel,
  normalizeSubtitleFormat,
  summarizeBatchInputs
} from "../batch-utils";
import { MappingRow } from "./mapping-row";
import type { SeasonBatchWorkspaceModel } from "./use-season-batch-workspace";
import { WorkspaceSection } from "./workspace-section";

type MappingPanelProps = Pick<
  SeasonBatchWorkspaceModel,
  | "t"
  | "busy"
  | "uploading"
  | "batchPreparing"
  | "sourceMode"
  | "subhdPackName"
  | "batchInputFiles"
  | "batchRawEntries"
  | "backToSelectStep"
  | "batchNotices"
  | "filterActions"
  | "batchFilter"
  | "setBatchFilter"
  | "batchRows"
  | "batchSummary"
  | "filteredBatchRows"
  | "batchCandidates"
  | "updateBatchRowSelection"
  | "batchResult"
  | "showBatchLanguageSelector"
  | "batchLanguagePreference"
  | "setBatchLanguagePreference"
  | "batchLanguageOptions"
  | "showBatchFormatSelector"
  | "batchFormatPreference"
  | "setBatchFormatPreference"
  | "batchFormatOptions"
  | "batchLabel"
  | "setBatchLabel"
  | "subhdCacheToken"
  | "submitSeasonBatch"
  | "onComplete"
>;

export function SeasonBatchMappingBody(props: MappingPanelProps) {
  const {
    t,
    busy,
    uploading,
    batchPreparing,
    sourceMode,
    subhdPackName,
    batchInputFiles,
    batchRawEntries,
    backToSelectStep,
    batchNotices,
    filterActions,
    batchFilter,
    setBatchFilter,
    batchRows,
    batchSummary,
    filteredBatchRows,
    batchCandidates,
    updateBatchRowSelection,
    batchResult
  } = props;

  return (
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
  );
}

export function SeasonBatchMappingFooter(props: MappingPanelProps) {
  const {
    t,
    busy,
    uploading,
    batchPreparing,
    batchRawEntries,
    showBatchLanguageSelector,
    batchLanguagePreference,
    setBatchLanguagePreference,
    batchLanguageOptions,
    showBatchFormatSelector,
    batchFormatPreference,
    setBatchFormatPreference,
    batchFormatOptions,
    batchLabel,
    setBatchLabel,
    batchSummary,
    sourceMode,
    subhdCacheToken,
    submitSeasonBatch,
    onComplete
  } = props;

  return (
    <div className="mt-4 shrink-0 space-y-3 border-t border-border pt-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        {showBatchLanguageSelector ? (
          <div className="space-y-2 sm:w-[180px]">
            <p className="text-caption font-semibold uppercase tracking-section text-foreground-muted">
              {t("common.language")}
            </p>
            <Select
              value={batchLanguagePreference === "any" ? batchLanguageOptions[0] : batchLanguagePreference}
              onValueChange={(value) => setBatchLanguagePreference(value as BatchLanguagePreference)}
              disabled={busy || batchPreparing || batchRawEntries.length === 0}
            >
              <SelectTrigger size="sm" className="w-full">
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
          <div className="space-y-2 sm:w-[140px]">
            <p className="text-caption font-semibold uppercase tracking-section text-foreground-muted">{t("common.format")}</p>
            <Select
              value={batchFormatPreference === "any" ? batchFormatOptions[0] : batchFormatPreference}
              onValueChange={(value) => setBatchFormatPreference(normalizeSubtitleFormat(value))}
              disabled={busy || batchPreparing || batchRawEntries.length === 0}
            >
              <SelectTrigger size="sm" className="w-full">
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

        <div className="space-y-2 sm:w-[140px]">
          <p className="text-caption font-semibold uppercase tracking-section text-foreground-muted">{t("batch.label")}</p>
          <Input
            size="sm"
            value={batchLabel}
            maxLength={32}
            placeholder="zh&en"
            className="w-full"
            disabled={busy || batchPreparing}
            onChange={(event) => setBatchLabel(event.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:space-x-2 sm:gap-0">
        <Button type="button" variant="outline" disabled={busy || batchPreparing || uploading} onClick={() => onComplete?.()}>
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          variant="default"
          disabled={busy || batchPreparing || batchSummary.mapped === 0 || (sourceMode === "subhd" && !subhdCacheToken)}
          onClick={() => void submitSeasonBatch()}
        >
          {sourceMode === "subhd" ? t("batch.subhd.installMapped") : t("common.upload")}
        </Button>
      </div>
    </div>
  );
}
