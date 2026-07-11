"use client";

import { useEffect, useMemo, useState } from "react";

import { useI18n } from "@/lib/i18n";
import type { BatchSubtitleDeleteItem, BatchSubtitleUploadResult, Subtitle, TvSeasonOption, Video } from "@/lib/types";
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
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { formatSeasonEpisodeText, parseVideoSeasonEpisode } from "./batch-utils";

interface BatchDeleteRow {
  key: string;
  video: Video;
  subtitle: Subtitle;
  season: number | null;
  episodeCode: string;
  episodeTitle: string;
}

interface TvBatchDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seriesTitle: string;
  seriesVideos: Video[];
  seasonOptions: TvSeasonOption[];
  initialSeason?: string;
  busy: boolean;
  uploading: boolean;
  uploadingMessage: string;
  onDeleteBatch: (items: BatchSubtitleDeleteItem[]) => Promise<BatchSubtitleUploadResult>;
}

function rowKey(videoId: string, subtitleId: string) {
  return `${videoId}\0${subtitleId}`;
}

function buildRows(videos: Video[]): BatchDeleteRow[] {
  const rows: BatchDeleteRow[] = [];
  for (const video of videos) {
    const parsed = parseVideoSeasonEpisode(video);
    const episodeCode = parsed ? formatSeasonEpisodeText(parsed.season, parsed.episode) : "-";
    for (const subtitle of video.subtitles || []) {
      rows.push({
        key: rowKey(video.id, subtitle.id),
        video,
        subtitle,
        season: parsed?.season ?? null,
        episodeCode,
        episodeTitle: video.title || video.fileName || "-"
      });
    }
  }
  return rows;
}

export function TvBatchDeleteDialog({
  open,
  onOpenChange,
  seriesTitle,
  seriesVideos,
  seasonOptions,
  initialSeason,
  busy,
  uploading,
  uploadingMessage,
  onDeleteBatch
}: TvBatchDeleteDialogProps) {
  const { t } = useI18n();
  const rows = useMemo(() => buildRows(seriesVideos), [seriesVideos]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open) {
      setSelectedKeys(new Set());
      setConfirmOpen(false);
      setDeleting(false);
      return;
    }

    const next = new Set<string>();
    const preferredSeason =
      seasonOptions.find((option) => option.value === initialSeason)?.season ??
      null;
    if (preferredSeason != null) {
      for (const row of buildRows(seriesVideos)) {
        if (row.season === preferredSeason) {
          next.add(row.key);
        }
      }
    }
    setSelectedKeys(next);
    setConfirmOpen(false);
    setDeleting(false);
  }, [open, seriesVideos, seasonOptions, initialSeason]);

  const selectedCount = selectedKeys.size;
  const allSelected = rows.length > 0 && selectedCount === rows.length;
  const operationBusy = busy || uploading || deleting;

  function toggleKey(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function selectAll() {
    setSelectedKeys(new Set(rows.map((row) => row.key)));
  }

  function clearSelection() {
    setSelectedKeys(new Set());
  }

  function selectSeason(season: number | null | undefined) {
    if (season == null) {
      return;
    }
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const row of rows) {
        if (row.season === season) {
          next.add(row.key);
        }
      }
      return next;
    });
  }

  async function handleConfirmDelete() {
    const items = rows
      .filter((row) => selectedKeys.has(row.key))
      .map((row) => ({ video: row.video, subtitle: row.subtitle }));
    if (items.length === 0) {
      return;
    }

    setDeleting(true);
    try {
      await onDeleteBatch(items);
      setConfirmOpen(false);
      onOpenChange(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && operationBusy) {
            return;
          }
          onOpenChange(next);
        }}
      >
        <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t("tv.batchDeleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("tv.batchDeleteDescription", {
                series: seriesTitle || "-",
                count: rows.length
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={operationBusy || rows.length === 0} onClick={allSelected ? clearSelection : selectAll}>
                {allSelected ? t("tv.batchDeleteClearSelection") : t("tv.batchDeleteSelectAll")}
              </Button>
              {seasonOptions.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={operationBusy || rows.length === 0 || option.season == null}
                  onClick={() => selectSeason(option.season)}
                >
                  {t("tv.batchDeleteSelectSeason", { season: option.label })}
                </Button>
              ))}
              <span className="ml-auto text-xs text-muted-foreground">
                {t("tv.batchDeleteSelected", { selected: selectedCount, total: rows.length })}
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              {rows.length === 0 ? (
                <div className="surface-panel flex h-full min-h-[200px] items-center justify-center p-6 text-sm text-muted-foreground">
                  {t("common.noSubtitles")}
                </div>
              ) : (
                <ScrollArea className="h-[min(52vh,480px)]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10" />
                        <TableHead>{t("common.episode")}</TableHead>
                        <TableHead>{t("tv.batchDeleteFile")}</TableHead>
                        <TableHead className="hidden sm:table-cell">{t("common.language")}</TableHead>
                        <TableHead className="hidden md:table-cell">{t("common.format")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => {
                        const checked = selectedKeys.has(row.key);
                        return (
                          <TableRow
                            key={row.key}
                            className={cn(checked && "bg-surface-subtle")}
                            onClick={() => {
                              if (!operationBusy) {
                                toggleKey(row.key);
                              }
                            }}
                          >
                            <TableCell className="w-10">
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-foreground"
                                checked={checked}
                                disabled={operationBusy}
                                onChange={() => toggleKey(row.key)}
                                onClick={(event) => event.stopPropagation()}
                                aria-label={row.subtitle.fileName}
                              />
                            </TableCell>
                            <TableCell>
                              <div className="text-xs font-semibold text-muted-foreground">{row.episodeCode}</div>
                              <div className="max-w-[220px] truncate text-sm font-medium" title={row.episodeTitle}>
                                {row.episodeTitle}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="max-w-[280px] truncate text-sm" title={row.subtitle.fileName}>
                                {row.subtitle.fileName}
                              </div>
                            </TableCell>
                            <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                              {row.subtitle.language || "-"}
                            </TableCell>
                            <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                              {row.subtitle.format || "-"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </div>

            {uploading || deleting ? (
              <p className="text-xs text-muted-foreground">{uploadingMessage || t("status.deletingSubtitlesProgress", { current: 0, total: selectedCount })}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={operationBusy} onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="default"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={operationBusy || selectedCount === 0}
              onClick={() => setConfirmOpen(true)}
            >
              {t("tv.batchDeleteConfirmAction")} ({selectedCount})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={(next) => !operationBusy && setConfirmOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("tv.batchDeleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("tv.batchDeleteConfirmDescription", { count: selectedCount })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={operationBusy}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={operationBusy}
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmDelete();
              }}
            >
              {deleting ? t("common.deleting") : t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
