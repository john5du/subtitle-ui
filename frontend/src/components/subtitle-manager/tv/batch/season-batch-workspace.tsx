import { TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

import { InlinePending, PanelLoadingOverlay, SpinnerIcon } from "../../shared/pending-state";
import { SeasonBatchMappingBody, SeasonBatchMappingFooter } from "./season-batch-mapping-panel";
import { SeasonBatchSourcePanel } from "./season-batch-source-panel";
import type { TvSeasonBatchUploadWorkspaceProps } from "./types";
import { useSeasonBatchWorkspace } from "./use-season-batch-workspace";

export type { TvSeasonBatchUploadWorkspaceProps } from "./types";

export function TvSeasonBatchUploadWorkspace(props: TvSeasonBatchUploadWorkspaceProps) {
  const { className, ...hookProps } = props;
  const model = useSeasonBatchWorkspace(hookProps);
  const {
    t,
    batchInputRef,
    busy,
    uploading,
    uploadingMessage,
    batchPreparing,
    subhdSearching,
    batchBlockingError,
    showSelectStep,
    showMappingStep,
    sourceMode,
    selectedSubhdSid,
    prepareSelectedSubHDPack,
    onComplete
  } = model;

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <input
        ref={batchInputRef}
        type="file"
        accept=".zip,.7z,.rar,.srt,.ass,.ssa,.vtt,.sub"
        multiple
        className="hidden"
        onChange={(event) => {
          void model.onBatchFilesSelected(event);
        }}
      />

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pr-1">
          {batchPreparing || uploading || subhdSearching ? (
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

          {showSelectStep ? <SeasonBatchSourcePanel {...model} /> : null}
          {showMappingStep ? <SeasonBatchMappingBody {...model} /> : null}
        </div>

        {batchPreparing ? <PanelLoadingOverlay label={t("batch.preparing")} /> : null}
      </div>

      {showSelectStep && sourceMode === "subhd" ? (
        <div className="mt-4 shrink-0 border-t border-border pt-3">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:space-x-2 sm:gap-0">
            <Button type="button" variant="outline" disabled={busy || batchPreparing || uploading} onClick={() => onComplete?.()}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="default"
              disabled={!selectedSubhdSid || busy || batchPreparing || uploading || subhdSearching}
              onClick={() => void prepareSelectedSubHDPack()}
            >
              {batchPreparing ? <SpinnerIcon className="h-4 w-4" /> : null}
              {t("batch.subhd.prepare")}
            </Button>
          </div>
        </div>
      ) : null}

      {showMappingStep ? <SeasonBatchMappingFooter {...model} /> : null}
    </div>
  );
}
