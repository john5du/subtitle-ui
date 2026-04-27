import { useState } from "react";

import { Activity, AlertTriangle, FolderTree, Trash2 } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import type { DirectoryScanResult, OperationLog, Pager, ScanStatus, UiPendingState } from "@/lib/types";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

import { PagerView } from "../shared/pager-view";
import { PanelLoadingOverlay } from "../shared/pending-state";
import { QuickStatCard } from "./quick-stat-card";

export function DashboardPanel({
  scanStatus,
  directoryScan,
  logs,
  logsPager,
  onSetLogsPage,
  onClearLogs,
  pending,
  formatTime
}: {
  scanStatus: ScanStatus | null;
  directoryScan: DirectoryScanResult;
  logs: OperationLog[];
  logsPager: Pager;
  onSetLogsPage: (page: number) => void;
  onClearLogs: () => Promise<boolean>;
  pending: UiPendingState;
  formatTime: (value: string | undefined | null) => string;
}) {
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const movieCount = directoryScan.movieCount || 0;
  const tvSeriesCount = directoryScan.tvSeriesCount || 0;
  const discoveredDirCount = movieCount + tvSeriesCount;
  const clearDisabled = pending.logs || logsPager.total <= 0;
  const { t } = useI18n();

  function confirmClearLogs() {
    void (async () => {
      const cleared = await onClearLogs();
      if (cleared) {
        setClearDialogOpen(false);
      }
    })();
  }

  return (
    <div className="flex min-h-0 flex-col gap-3 lg:h-full">
      <div className="grid shrink-0 gap-3 md:grid-cols-3">
        <QuickStatCard
          icon={<Activity className="h-5 w-5" />}
          label={t("dashboard.lastScanVideos")}
          value={String(scanStatus?.videoCount ?? 0)}
          hint={scanStatus?.running ? t("dashboard.scanInProgress") : t("dashboard.scannerIdle")}
          tone="success"
          pending={pending.scan || pending.bootstrapping}
          className="animate-fade-in-up"
        />
        <QuickStatCard
          icon={<FolderTree className="h-5 w-5" />}
          label={t("dashboard.discoveredDirs")}
          value={String(discoveredDirCount)}
          hint={t("dashboard.movieTvCount", { movie: movieCount, tv: tvSeriesCount })}
          tone="info"
          pending={pending.scan || pending.bootstrapping}
          className="animate-fade-in-up"
        />
        <QuickStatCard
          icon={<AlertTriangle className="h-5 w-5" />}
          label={t("dashboard.directoryWarnings")}
          value={String(directoryScan.errors.length)}
          hint={directoryScan.errors.length > 0 ? t("dashboard.needsReview") : t("dashboard.allClear")}
          tone={directoryScan.errors.length > 0 ? "destructive" : "warning"}
          pending={pending.scan || pending.bootstrapping}
          className="animate-fade-in-up"
        />
      </div>

      <Card className="surface-panel animate-fade-in-up flex min-h-[520px] flex-col lg:min-h-0 lg:flex-1">
        <CardHeader className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-lg">{t("dashboard.recentOperationsTitle")}</CardTitle>
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
        </CardHeader>
        <CardContent className="relative flex min-h-0 flex-1 flex-col p-4 pt-0">
          <ScrollArea className={cn("surface-subtle min-h-[360px] flex-1 lg:min-h-0", pending.logs && "animate-pulse-soft")}>
            <ul className="divide-y divide-border">
              {logs.map((log) => (
                <li key={log.id} className="animate-fade-in-up space-y-2 p-3 text-sm">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-semibold">{log.action}</p>
                      <p className="text-xs text-muted-foreground">{formatTime(log.timestamp)}</p>
                    </div>
                    <p className="shrink-0 text-xs text-muted-foreground">
                      {t("dashboard.logVideoStatus", { videoId: log.videoId || "-", status: log.status })}
                    </p>
                  </div>
                  <p className="break-all text-xs text-muted-foreground">{log.targetPath || "-"}</p>
                  {log.message && <p className="break-all text-xs text-muted-foreground">{t("dashboard.logDetails", { details: log.message })}</p>}
                </li>
              ))}
              {logs.length === 0 && (
                <li className="p-8 text-center text-sm text-muted-foreground">{t("dashboard.logsEmpty")}</li>
              )}
            </ul>
          </ScrollArea>
          <div className="mt-3 shrink-0">
            <PagerView pager={logsPager} onSetPage={onSetLogsPage} disabled={pending.logs} />
          </div>
          {pending.logs && <PanelLoadingOverlay label={t("logs.refreshing")} />}
        </CardContent>
      </Card>

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
    </div>
  );
}
