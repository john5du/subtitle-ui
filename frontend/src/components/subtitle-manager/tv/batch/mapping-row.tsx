import type { Video } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { parseVideoSeasonEpisode } from "@/lib/subtitle-manager/tv-episode";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import type { SeasonBatchMappingStatus, SeasonBatchRowView } from "../../types";
import {
  candidateVideosForBatchRow,
  describeBatchEntrySource,
  formatLanguageTypeLabel,
  formatSeasonEpisodeText,
  formatSubtitleExtLabel
} from "../batch-utils";
import { ROW_SELECT_PENDING, ROW_SELECT_SKIPPED } from "./types";

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

export function MappingRow({
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
            <SelectTrigger size="sm" className="w-full min-w-0 [&>span]:min-w-0 [&>span]:truncate">
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
