import { Activity, AlertTriangle, FolderTree } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import type { DirectoryScanResult, OperationLog, ScanStatus, UiPendingState } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

import { InlinePending, PanelLoadingOverlay } from "../shared/pending-state";
import { QuickStatCard } from "./quick-stat-card";

export function DashboardPanel({
  scanStatus,
  directoryScan,
  message,
  logs,
  pending,
  formatTime
}: {
  scanStatus: ScanStatus | null;
  directoryScan: DirectoryScanResult;
  message: string;
  logs: OperationLog[];
  pending: UiPendingState;
  formatTime: (value: string | undefined | null) => string;
}) {
  const recentLogs = logs.slice(0, 8);
  const movieCount = directoryScan.movieCount || 0;
  const tvSeriesCount = directoryScan.tvSeriesCount || 0;
  const discoveredDirCount = movieCount + tvSeriesCount;
  const { t } = useI18n();

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
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

      <div className="grid gap-3 xl:grid-cols-[1.2fr_1fr]">
        <Card className="surface-panel animate-fade-in-up">
          <CardHeader className="p-4">
            <CardTitle className="text-lg">{t("dashboard.scanStatusTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0">
            <div className="surface-subtle p-3 text-sm">
              <p role="status" aria-live="polite" className="font-medium">
                {message || t("status.ready")}
              </p>
              {pending.scan && <p className="mt-2"><InlinePending label={t("dashboard.scannerWorking")} /></p>}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("dashboard.directoryWarningsTitle")}</p>
              {directoryScan.errors.length > 0 ? (
                <ul className="space-y-2">
                  {directoryScan.errors.slice(0, 6).map((error) => (
                    <li key={error} className="border border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.03)] p-2 text-xs text-muted-foreground">
                      {error}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">{t("dashboard.noDirectoryWarnings")}</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="surface-panel animate-fade-in-up">
          <CardHeader className="flex flex-row items-center justify-between p-4">
            <CardTitle className="text-lg">{t("dashboard.recentOperationsTitle")}</CardTitle>
            <Badge variant="secondary">{pending.logs ? t("logs.refreshing") : t("dashboard.recentCount", { count: recentLogs.length })}</Badge>
          </CardHeader>
          <CardContent className="relative p-4 pt-0">
            <ScrollArea className={cn("surface-subtle h-[300px]", pending.logs && "animate-pulse-soft")}>
              <ul className="divide-y divide-border">
                {recentLogs.map((log) => (
                  <li key={log.id} className="animate-fade-in-up space-y-1 p-3 text-xs">
                    <p className="font-medium">{log.action}</p>
                    <p className="text-muted-foreground">{formatTime(log.timestamp)}</p>
                    <p className="break-all text-muted-foreground">{log.targetPath || "-"}</p>
                    <p className="text-muted-foreground">{t("dashboard.logStatus", { status: log.status })}</p>
                    {log.message && <p className="break-all text-muted-foreground">{t("dashboard.logDetails", { details: log.message })}</p>}
                  </li>
                ))}
                {recentLogs.length === 0 && (
                  <li className="p-6 text-center text-sm text-muted-foreground">{t("dashboard.logsEmpty")}</li>
                )}
              </ul>
            </ScrollArea>
            {pending.logs && <PanelLoadingOverlay label={t("logs.refreshing")} />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
