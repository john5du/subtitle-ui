"use client";

import { useEffect, useMemo, useState } from "react";

import { useI18n } from "@/lib/i18n";
import { requestPayload } from "@/lib/subtitle-manager/api-client";
import { emitToast } from "@/lib/toast";
import type {
  SubtitleNormalizeApplyItem,
  SubtitleNormalizeApplyResult,
  SubtitleNormalizeItem,
  SubtitleNormalizePlan
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { InlinePending } from "../../shared/pending-state";

export type NormalizeDialogScope =
  | { kind: "video"; videoId: string }
  | { kind: "season"; path?: string; key?: string; season: number };

interface NormalizeSubtitlesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: NormalizeDialogScope | null;
  onApplied?: () => Promise<void> | void;
}

function itemKey(item: SubtitleNormalizeItem) {
  return `${item.videoId}::${item.subtitleId}`;
}

export function NormalizeSubtitlesDialog({ open, onOpenChange, scope, onApplied }: NormalizeSubtitlesDialogProps) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState<SubtitleNormalizeItem[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open || !scope) {
      return;
    }
    let cancelled = false;
    async function loadPlan() {
      setLoading(true);
      setError("");
      setItems([]);
      setSelected({});
      try {
        let plan: SubtitleNormalizePlan;
        if (scope!.kind === "video") {
          plan = await requestPayload<SubtitleNormalizePlan>(
            `/api/videos/${encodeURIComponent(scope!.videoId)}/subtitles/normalize/plan`,
            { method: "POST" }
          );
        } else {
          plan = await requestPayload<SubtitleNormalizePlan>(`/api/tv/series/subtitles/normalize/plan`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              path: scope!.path || "",
              key: scope!.key || "",
              season: scope!.season
            })
          });
        }
        if (cancelled) return;
        const nextItems = Array.isArray(plan?.items) ? plan.items : [];
        setItems(nextItems);
        const nextSelected: Record<string, boolean> = {};
        for (const item of nextItems) {
          nextSelected[itemKey(item)] = item.status === "rename";
        }
        setSelected(nextSelected);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadPlan();
    return () => {
      cancelled = true;
    };
  }, [open, scope]);

  const renameable = useMemo(() => items.filter((item) => item.status === "rename"), [items]);
  const selectedCount = useMemo(
    () => renameable.filter((item) => selected[itemKey(item)]).length,
    [renameable, selected]
  );

  function toggleAll(checked: boolean) {
    setSelected((prev) => {
      const next = { ...prev };
      for (const item of renameable) {
        next[itemKey(item)] = checked;
      }
      return next;
    });
  }

  async function handleApply() {
    if (!scope || selectedCount === 0) return;
    const payloadItems: SubtitleNormalizeApplyItem[] = renameable
      .filter((item) => selected[itemKey(item)])
      .map((item) => ({
        videoId: item.videoId,
        subtitleId: item.subtitleId,
        toPath: item.toPath
      }));
    if (payloadItems.length === 0) return;

    setApplying(true);
    setError("");
    try {
      let result: SubtitleNormalizeApplyResult;
      if (scope.kind === "video") {
        result = await requestPayload<SubtitleNormalizeApplyResult>(
          `/api/videos/${encodeURIComponent(scope.videoId)}/subtitles/normalize/apply`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: payloadItems })
          }
        );
      } else {
        result = await requestPayload<SubtitleNormalizeApplyResult>(`/api/tv/series/subtitles/normalize/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: scope.path || "",
            key: scope.key || "",
            season: scope.season,
            items: payloadItems
          })
        });
      }
      emitToast({
        level: result.failed > 0 ? "error" : "success",
        message: t("normalize.applySummary", {
          renamed: String(result.renamed ?? 0),
          skipped: String(result.skipped ?? 0),
          failed: String(result.failed ?? 0)
        })
      });
      await onApplied?.();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }

  function statusLabel(status: string) {
    switch (status) {
      case "rename":
        return t("normalize.status.rename");
      case "noop":
        return t("normalize.status.noop");
      case "skip_conflict":
        return t("normalize.status.conflict");
      default:
        return status;
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("normalize.title")}</DialogTitle>
          <DialogDescription>{t("normalize.description")}</DialogDescription>
        </DialogHeader>

        {loading ? <InlinePending label={t("normalize.loading")} /> : null}
        {error ? <div className="surface-status-destructive border p-2 text-sm">{error}</div> : null}

        {!loading && !error && items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("normalize.empty")}</p>
        ) : null}

        {!loading && items.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={renameable.length > 0 && selectedCount === renameable.length}
                  disabled={renameable.length === 0 || applying}
                  onChange={(event) => toggleAll(event.target.checked)}
                />
                {t("normalize.selectRenames", { count: String(selectedCount) })}
              </label>
              <span>
                {t("normalize.counts", {
                  total: String(items.length),
                  rename: String(renameable.length)
                })}
              </span>
            </div>
            <ScrollArea className="max-h-[50vh] rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>{t("normalize.from")}</TableHead>
                    <TableHead>{t("normalize.to")}</TableHead>
                    <TableHead className="w-28">{t("normalize.statusLabel")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => {
                    const key = itemKey(item);
                    const canSelect = item.status === "rename";
                    return (
                      <TableRow key={key}>
                        <TableCell>
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-primary"
                            checked={Boolean(selected[key])}
                            disabled={!canSelect || applying}
                            onChange={(event) =>
                              setSelected((prev) => ({
                                ...prev,
                                [key]: event.target.checked
                              }))
                            }
                          />
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate font-mono text-xs" title={item.fromFileName}>
                          {item.fromFileName}
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate font-mono text-xs" title={item.toFileName}>
                          {item.toFileName}
                          {item.toLabel ? (
                            <span className="ml-1 text-muted-foreground">({item.toLabel})</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-xs">
                          <span title={item.reason || undefined}>
                            {statusLabel(item.status)}
                            {item.reason === "bilingual detected" ? (
                              <span className="ml-1 text-primary">({t("normalize.reason.bilingual")})</span>
                            ) : null}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={applying} onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" disabled={loading || applying || selectedCount === 0} onClick={() => void handleApply()}>
            {applying ? t("normalize.applying") : t("normalize.apply", { count: String(selectedCount) })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
