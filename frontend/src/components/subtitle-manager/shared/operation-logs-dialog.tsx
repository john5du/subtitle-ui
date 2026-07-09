import { useEffect, useRef, useState } from "react";

import { Trash2 } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import type { OperationLog, Pager, UiPendingState } from "@/lib/types";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

import { PagerView } from "./pager-view";
import { PanelLoadingOverlay } from "./pending-state";

export function OperationLogsDialog({
  open,
  onOpenChange,
  logs,
  logsPager,
  onSetLogsPage,
  onRefreshLogs,
  onClearLogs,
  pending,
  formatTime
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  logs: OperationLog[];
  logsPager: Pager;
  onSetLogsPage: (page: number) => void;
  onRefreshLogs: (page?: number) => Promise<void>;
  onClearLogs: () => Promise<boolean>;
  pending: UiPendingState;
  formatTime: (value: string | undefined | null) => string;
}) {
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const logsViewportRef = useRef<HTMLDivElement | null>(null);
  const clearDisabled = pending.logs || logsPager.total <= 0;
  const showLogsPager = Math.max(1, logsPager.totalPages) > 1 || logsPager.total > 0;
  const { t } = useI18n();

  useEffect(() => {
    if (open) {
      void onRefreshLogs(1);
    }
  }, [onRefreshLogs, open]);

  useEffect(() => {
    logsViewportRef.current?.scrollTo({ top: 0, left: 0 });
  }, [logsPager.page]);

  function confirmClearLogs() {
    void (async () => {
      const cleared = await onClearLogs();
      if (cleared) {
        setClearDialogOpen(false);
      }
    })();
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="h-[min(760px,88vh)] max-h-[88vh] max-w-4xl gap-0 overflow-hidden p-0 sm:max-w-4xl">
          <DialogHeader className="border-b border-border p-5 pr-14">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <DialogTitle>{t("logs.title")}</DialogTitle>
                <DialogDescription>{pending.logs ? t("logs.refreshing") : t("dashboard.logCount", { count: logsPager.total })}</DialogDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {pending.logs ? t("logs.refreshing") : t("dashboard.logCount", { count: logsPager.total })}
                </Badge>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={clearDisabled}
                  onClick={() => setClearDialogOpen(true)}
                >
                  <Trash2 className="h-4 w-4" />
                  {t("dashboard.clearLogs")}
                </Button>
              </div>
            </div>
          </DialogHeader>

          <div className="relative flex min-h-0 flex-1 flex-col">
            <ScrollArea viewportRef={logsViewportRef} className={cn("min-h-0 flex-1", pending.logs && "animate-pulse-soft")}>
              <ul className={cn("divide-y divide-border", showLogsPager && "pb-20")}>
                {logs.map((log) => (
                  <li key={log.id} className="animate-fade-in-up space-y-2 p-3 text-sm sm:p-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-semibold">{log.action}</p>
                        <p className="text-xs text-muted-foreground">{formatTime(log.timestamp)}</p>
                      </div>
                      <p className="shrink-0 text-xs text-muted-foreground">
                        {t("logs.videoStatus", { videoId: log.videoId || "-", status: log.status })}
                      </p>
                    </div>
                    <p className="break-all text-xs text-muted-foreground">{log.targetPath || "-"}</p>
                    {log.message && <p className="break-all text-xs text-muted-foreground">{t("logs.details", { details: log.message })}</p>}
                  </li>
                ))}
                {logs.length === 0 && (
                  <li className="p-8 text-center text-sm text-muted-foreground">{t("logs.empty")}</li>
                )}
              </ul>
            </ScrollArea>
            <PagerView pager={logsPager} onSetPage={onSetLogsPage} disabled={pending.logs} />
            {pending.logs && <PanelLoadingOverlay label={t("logs.refreshing")} />}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("dashboard.clearLogsTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("dashboard.clearLogsDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending.logs}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending.logs}
              onClick={(event) => {
                event.preventDefault();
                confirmClearLogs();
              }}
            >
              {t("dashboard.clearLogsConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
