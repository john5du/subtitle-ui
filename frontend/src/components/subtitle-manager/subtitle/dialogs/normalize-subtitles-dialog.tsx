"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRightLeft, Check, Languages, TriangleAlert } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { requestPayload } from "@/lib/subtitle-manager/api-client";
import { emitToast } from "@/lib/toast";
import type {
  SubtitleNormalizeApplyItem,
  SubtitleNormalizeApplyResult,
  SubtitleNormalizeItem,
  SubtitleNormalizePlan
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader
} from "@/components/ui/dialog";
import { DialogTitleWithHelp } from "@/components/ui/dialog-title-with-help";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { InlinePending } from "../../shared/pending-state";

type BubblePos = { top: number; left: number; width: number };

function measureBubbleSize(text: string): { width: number; height: number } {
  if (typeof document === "undefined") {
    return { width: Math.min(160, Math.max(48, text.length * 8 + 20)), height: 32 };
  }
  const el = document.createElement("div");
  el.style.cssText = [
    "position:fixed",
    "visibility:hidden",
    "pointer-events:none",
    "left:-9999px",
    "top:0",
    "z-index:-1",
    "box-sizing:border-box",
    "padding:8px 10px",
    "font-size:12px",
    "line-height:1.5",
    "font-weight:400",
    "width:max-content",
    "white-space:nowrap"
  ].join(";");
  el.textContent = text;
  document.body.appendChild(el);
  const rect = el.getBoundingClientRect();
  document.body.removeChild(el);
  return {
    width: Math.max(48, Math.ceil(rect.width)),
    height: Math.max(28, Math.ceil(rect.height))
  };
}

function bubbleStyle(anchor: DOMRect, text: string): BubblePos {
  const gap = 8;
  const viewportPad = 8;
  const size = measureBubbleSize(text);
  const width = size.width;
  const height = size.height;
  const spaceBelow = window.innerHeight - anchor.bottom;
  const spaceAbove = anchor.top;
  const placeBelow = spaceBelow >= height + gap || spaceBelow >= spaceAbove;
  const top = placeBelow
    ? anchor.bottom + gap
    : Math.max(viewportPad, anchor.top - gap - height);
  let left = anchor.right - width;
  if (width + viewportPad * 2 <= window.innerWidth) {
    left = Math.min(Math.max(viewportPad, left), window.innerWidth - width - viewportPad);
  } else {
    left = viewportPad;
  }
  return { top, left, width };
}

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
  const [statusPopoverKey, setStatusPopoverKey] = useState<string | null>(null);
  const [statusBubble, setStatusBubble] = useState<{ key: string; label: string; pos: BubblePos } | null>(null);
  const statusButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const statusBubbleRef = useRef<HTMLDivElement | null>(null);

  function closeStatusBubble() {
    setStatusPopoverKey(null);
    setStatusBubble(null);
  }

  function openStatusBubble(key: string, label: string) {
    const button = statusButtonRefs.current[key];
    if (!button) {
      return;
    }
    const rect = button.getBoundingClientRect();
    setStatusBubble({
      key,
      label,
      pos: bubbleStyle(rect, label)
    });
    setStatusPopoverKey(key);
  }

  useEffect(() => {
    if (!open) {
      closeStatusBubble();
    }
  }, [open]);

  useEffect(() => {
    if (!statusBubble) {
      return;
    }
    function onPointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node | null;
      if (!target || !statusBubble) {
        return;
      }
      const inButton = statusButtonRefs.current[statusBubble.key]?.contains(target);
      const inBubble = statusBubbleRef.current?.contains(target);
      if (!inButton && !inBubble) {
        closeStatusBubble();
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeStatusBubble();
      }
    }
    function onReposition() {
      if (!statusBubble) {
        return;
      }
      const button = statusButtonRefs.current[statusBubble.key];
      if (button) {
        setStatusBubble((prev) =>
          prev
            ? {
                ...prev,
                pos: bubbleStyle(button.getBoundingClientRect(), prev.label)
              }
            : null
        );
      } else {
        closeStatusBubble();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [statusBubble]);

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
      closeStatusBubble();
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

  function statusMeta(item: SubtitleNormalizeItem) {
    const bilingual = item.reason === "bilingual detected";
    switch (item.status) {
      case "rename":
        return {
          label: bilingual ? `${t("normalize.status.rename")} · ${t("normalize.reason.bilingual")}` : t("normalize.status.rename"),
          icon: bilingual ? Languages : ArrowRightLeft,
          className: bilingual ? "text-primary" : "text-foreground"
        };
      case "noop":
        return {
          label: t("normalize.status.noop"),
          icon: Check,
          className: "text-emerald-600 dark:text-emerald-400"
        };
      case "skip_conflict":
        return {
          label: item.reason ? `${t("normalize.status.conflict")}: ${item.reason}` : t("normalize.status.conflict"),
          icon: TriangleAlert,
          className: "text-amber-600 dark:text-amber-400"
        };
      default:
        return {
          label: item.status,
          icon: TriangleAlert,
          className: "text-muted-foreground"
        };
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitleWithHelp title={t("normalize.title")} help={t("normalize.description")} />
        </DialogHeader>

        <DialogBody>
          {loading ? <InlinePending label={t("normalize.loading")} /> : null}
          {error ? <div className="surface-status-destructive border p-2 text-sm">{error}</div> : null}

          {!loading && !error && items.length === 0 ? (
            <div className="surface-panel flex min-h-[200px] flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
              {t("normalize.empty")}
            </div>
          ) : null}

          {!loading && items.length > 0 ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={renameable.length === 0 || applying}
                  onClick={() => toggleAll(!(renameable.length > 0 && selectedCount === renameable.length))}
                >
                  {renameable.length > 0 && selectedCount === renameable.length
                    ? t("tv.batchDeleteClearSelection")
                    : t("tv.batchDeleteSelectAll")}
                </Button>
                <span className="ml-auto text-xs text-muted-foreground">
                  {t("normalize.selectRenames", { count: String(selectedCount) })}
                  <span className="mx-1.5 text-border">·</span>
                  {t("normalize.counts", {
                    total: String(items.length),
                    rename: String(renameable.length)
                  })}
                </span>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden">
                <ScrollArea className="h-full">
                  <Table className="w-full table-fixed" containerClassName="overflow-x-hidden border-0 rounded-none">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10" />
                        <TableHead>{t("normalize.from")}</TableHead>
                        <TableHead>{t("normalize.to")}</TableHead>
                        <TableHead className="w-12 text-center" title={t("normalize.statusLabel")}>
                          <span className="sr-only">{t("normalize.statusLabel")}</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item) => {
                        const key = itemKey(item);
                        const canSelect = item.status === "rename";
                        const status = statusMeta(item);
                        const StatusIcon = status.icon;
                        return (
                          <TableRow key={key}>
                            <TableCell className="w-10">
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
                            <TableCell className="min-w-0 overflow-hidden font-mono text-xs">
                              <span className="block truncate" title={item.fromFileName}>
                                {item.fromFileName}
                              </span>
                            </TableCell>
                            <TableCell className="min-w-0 overflow-hidden font-mono text-xs">
                              <span
                                className="block truncate"
                                title={item.toLabel ? `${item.toFileName} (${item.toLabel})` : item.toFileName}
                              >
                                {item.toFileName}
                                {item.toLabel ? <span className="ml-1 text-muted-foreground">({item.toLabel})</span> : null}
                              </span>
                            </TableCell>
                            <TableCell className="w-12 text-center">
                              <button
                                ref={(node) => {
                                  statusButtonRefs.current[key] = node;
                                }}
                                type="button"
                                className={cn(
                                  "inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                  status.className,
                                  statusPopoverKey === key && "bg-muted"
                                )}
                                aria-expanded={statusPopoverKey === key}
                                aria-haspopup="dialog"
                                aria-label={status.label}
                                onClick={() => {
                                  if (statusPopoverKey === key) {
                                    setStatusPopoverKey(null);
                                    setStatusBubble(null);
                                  } else {
                                    openStatusBubble(key, status.label);
                                  }
                                }}
                              >
                                <StatusIcon className="h-4 w-4 shrink-0" aria-hidden />
                              </button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </div>
            </>
          ) : null}

          {applying ? <p className="text-xs text-muted-foreground">{t("normalize.applying")}</p> : null}
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={applying} onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="default" disabled={loading || applying || selectedCount === 0} onClick={() => void handleApply()}>
            {applying ? t("normalize.applying") : t("normalize.apply", { count: String(selectedCount) })}
          </Button>
        </DialogFooter>
      </DialogContent>

      {typeof document !== "undefined" && statusBubble
        ? createPortal(
            <div
              ref={statusBubbleRef}
              role="tooltip"
              className="fixed z-[200] w-max max-w-none rounded-md border border-border bg-popover px-2.5 py-2 text-left text-xs font-normal leading-none text-popover-foreground shadow-lg"
              style={{ top: statusBubble.pos.top, left: statusBubble.pos.left, width: statusBubble.pos.width }}
            >
              <p className="whitespace-nowrap">{statusBubble.label}</p>
            </div>,
            document.body
          )
        : null}
    </Dialog>
  );
}
