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
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

import { EmptyPanel } from "./empty-panel";
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
  const { t } = useI18n();
  const statusLabel = pending.logs ? t("logs.refreshing") : t("dashboard.logCount", { count: logsPager.total });

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
        <DialogContent size="lg">
          <DialogHeader>
            <div className="flex flex-col gap-3 pr-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <DialogTitle>{t("logs.title")}</DialogTitle>
                <DialogDescription>{statusLabel}</DialogDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{statusLabel}</Badge>
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

          <DialogBody className="gap-0">
            <div className="relative min-h-0 flex-1 overflow-hidden">
              <ScrollArea viewportRef={logsViewportRef} className={cn("h-full min-h-0", pending.logs && "is-pending")}>
                <ul className="divide-y divide-border">
                  {logs.map((log) => (
                    <li key={log.id} className="animate-fade-in-up space-y-2 p-3 text-sm sm:p-4">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="font-semibold">{log.action}</p>
                          <p className="text-xs text-muted-foreground">{formatTime(log.timestamp)}</p>
                        </div>
                        <Badge variant={log.status === "ok" ? "success" : log.status === "error" ? "destructive" : "secondary"}>
                          {log.status}
                        </Badge>
                      </div>
                      <p className="break-all text-sm">{log.targetPath || log.videoId || "-"}</p>
                      {log.message && (
                        <p className="break-all text-xs text-muted-foreground">{t("logs.details", { details: log.message })}</p>
                      )}
                    </li>
                  ))}
                  {logs.length === 0 && (
                    <li>
                      <EmptyPanel className="min-h-[12rem] border-0 bg-transparent" padded>
                        {t("logs.empty")}
                      </EmptyPanel>
                    </li>
                  )}
                </ul>
              </ScrollArea>
              {pending.logs && <PanelLoadingOverlay label={t("logs.refreshing")} />}
            </div>
            <PagerView pager={logsPager} onSetPage={onSetLogsPage} disabled={pending.logs} />
          </DialogBody>
        </DialogContent>
      </Dialog>

      <AlertDialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <AlertDialogContent size="sm">
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
