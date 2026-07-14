"use client";

import type { ChangeEvent, ReactNode } from "react";
import { Clock, Eye, FileArchive, FileCode2, Languages, Pencil, Trash2 } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { subtitleLanguageDisplayText } from "@/lib/subtitle-language";
import type { PendingSubtitleAction, Subtitle } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { RowActionsMenu } from "../shared/row-actions-menu";
import { SpinnerIcon } from "../shared/pending-state";
import { SubtitleSourceDetailButton } from "./source-detail-button";
import { formatSubtitleSourceLabel } from "./source-utils";
import {
  ACCEPTED_SUBTITLE_UPLOAD_TYPES,
  formatSubtitleSize,
  isSRTSubtitle,
  isTimingOffsetSupported
} from "./use-subtitle-file-workflow";

export const subtitleRowActionIconClassName = "h-10 w-10 shrink-0 touch-target sm:h-8 sm:w-8";
export const subtitleRowActionTextClassName = "h-10 shrink-0 gap-1 px-2.5 text-caption touch-target sm:h-8";

export interface SubtitleTrackCardProps {
  subtitle: Subtitle;
  busy: boolean;
  subtitleAction?: PendingSubtitleAction | null;
  formatTime: (value: string | undefined | null) => string;
  replaceInputRef: (node: HTMLInputElement | null) => void;
  onReplaceFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onPreview: () => void;
  onReplaceClick: () => void;
  onConvert: () => void;
  onOffset: () => void;
  onDelete: () => void;
  deleteDialog?: ReactNode;
  className?: string;
}

export function SubtitleTrackCard({
  subtitle,
  busy,
  subtitleAction,
  formatTime,
  replaceInputRef,
  onReplaceFileChange,
  onPreview,
  onReplaceClick,
  onConvert,
  onOffset,
  onDelete,
  deleteDialog,
  className
}: SubtitleTrackCardProps) {
  const { t } = useI18n();
  const replacePending = subtitleAction?.kind === "replace" && subtitleAction.subtitleId === subtitle.id;
  const convertPending = subtitleAction?.kind === "convert" && subtitleAction.subtitleId === subtitle.id;
  const offsetPending = subtitleAction?.kind === "offset" && subtitleAction.subtitleId === subtitle.id;
  const deletePending = subtitleAction?.kind === "delete" && subtitleAction.subtitleId === subtitle.id;
  const rowBusy = replacePending || convertPending || offsetPending || deletePending;
  const sourceText = formatSubtitleSourceLabel(subtitle, t);
  const canConvert = isSRTSubtitle(subtitle);
  const canOffset = isTimingOffsetSupported(subtitle);

  const moreItems = [
    ...(canConvert
      ? [
          {
            label: convertPending ? t("conversion.converting") : t("conversion.convertToAss"),
            disabled: busy || rowBusy,
            onSelect: onConvert
          }
        ]
      : []),
    ...(canOffset
      ? [
          {
            label: offsetPending ? t("timing.offsetting") : t("timing.offset"),
            disabled: busy || rowBusy,
            onSelect: onOffset
          }
        ]
      : []),
    {
      label: deletePending ? t("common.deleting") : t("common.delete"),
      disabled: busy || rowBusy,
      onSelect: onDelete
    }
  ];

  return (
    <article className={cn("surface-panel p-3", rowBusy && "animate-pulse-soft", className)}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius)] bg-surface-subtle text-foreground-muted sm:h-8 sm:w-8">
          <FileArchive className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground" title={subtitle.fileName || undefined}>
              {subtitle.fileName}
            </p>
            <Badge variant="secondary" className="shrink-0">
              {subtitle.format || "-"}
            </Badge>
          </div>

          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Languages className="h-3.5 w-3.5" />
              <span title={subtitle.language || undefined}>{subtitleLanguageDisplayText(subtitle.language, t)}</span>
            </div>
            <div className="flex min-w-0 items-center gap-1">
              <span className="min-w-0 truncate" title={sourceText}>
                {sourceText}
              </span>
              <SubtitleSourceDetailButton subtitle={subtitle} sourceLabel={sourceText} />
            </div>
            <div>{formatSubtitleSize(subtitle.size)}</div>
            <div>{formatTime(subtitle.modTime)}</div>
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border pt-2.5">
        <input
          ref={replaceInputRef}
          type="file"
          accept={ACCEPTED_SUBTITLE_UPLOAD_TYPES}
          className="hidden"
          onChange={onReplaceFileChange}
        />

        <Button
          type="button"
          variant="outline"
          size="icon"
          className={subtitleRowActionIconClassName}
          disabled={busy || rowBusy}
          onClick={onPreview}
          title={t("common.preview")}
          aria-label={t("common.preview")}
        >
          <Eye className="h-3.5 w-3.5" />
        </Button>

        <Button
          type="button"
          variant="outline"
          size="icon"
          className={subtitleRowActionIconClassName}
          disabled={busy || rowBusy}
          onClick={onReplaceClick}
          title={replacePending ? t("common.replacing") : t("common.replace")}
          aria-label={replacePending ? t("common.replacing") : t("common.replace")}
        >
          {replacePending ? <SpinnerIcon className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
        </Button>

        {canConvert ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(subtitleRowActionTextClassName, "hidden sm:inline-flex")}
            disabled={busy || rowBusy}
            onClick={onConvert}
          >
            {convertPending ? <SpinnerIcon className="h-3.5 w-3.5" /> : <FileCode2 className="h-3.5 w-3.5" />}
            {convertPending ? t("conversion.converting") : t("conversion.convertToAss")}
          </Button>
        ) : null}

        {canOffset ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={cn(subtitleRowActionIconClassName, "hidden sm:inline-flex")}
            disabled={busy || rowBusy}
            onClick={onOffset}
            title={offsetPending ? t("timing.offsetting") : t("timing.offset")}
            aria-label={offsetPending ? t("timing.offsetting") : t("timing.offset")}
          >
            {offsetPending ? <SpinnerIcon className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
          </Button>
        ) : null}

        <Button
          type="button"
          variant="outline"
          size="icon"
          className={cn(
            subtitleRowActionIconClassName,
            "hidden border-destructive-border text-destructive-muted hover:bg-destructive-soft hover:text-destructive-muted sm:inline-flex"
          )}
          disabled={busy || rowBusy}
          onClick={onDelete}
          title={deletePending ? t("common.deleting") : t("common.delete")}
          aria-label={deletePending ? t("common.deleting") : t("common.delete")}
        >
          {deletePending ? <SpinnerIcon className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
        </Button>

        <div className="ml-auto sm:hidden">
          <RowActionsMenu
            label={t("common.actions")}
            items={moreItems}
            triggerClassName={subtitleRowActionIconClassName}
            disabled={busy || rowBusy}
            menuDirection="up"
          />
        </div>
      </div>

      {deleteDialog}
    </article>
  );
}
