import { Activity, AlertTriangle, FolderTree } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import type { DirectoryScanResult, ScanStatus, UiPendingState } from "@/lib/types";

import { QuickStatCard } from "./quick-stat-card";

export function DashboardPanel({
  scanStatus,
  directoryScan,
  pending
}: {
  scanStatus: ScanStatus | null;
  directoryScan: DirectoryScanResult;
  pending: UiPendingState;
}) {
  const movieCount = directoryScan.movieCount || 0;
  const tvSeriesCount = directoryScan.tvSeriesCount || 0;
  const discoveredDirCount = movieCount + tvSeriesCount;
  const { t } = useI18n();

  return (
    <div className="flex min-h-0 flex-col lg:h-full">
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <QuickStatCard
          icon={<Activity className="h-5 w-5" />}
          label={t("dashboard.lastScanVideos")}
          value={String(scanStatus?.videoCount ?? 0)}
          hint={scanStatus?.running ? t("dashboard.scanInProgress") : t("dashboard.scannerIdle")}
          tone="success"
          pending={pending.scan || pending.bootstrapping}
          className="animate-fade-in-up w-full max-w-md"
        />
        <QuickStatCard
          icon={<FolderTree className="h-5 w-5" />}
          label={t("dashboard.discoveredDirs")}
          value={String(discoveredDirCount)}
          hint={t("dashboard.movieTvCount", { movie: movieCount, tv: tvSeriesCount })}
          tone="info"
          pending={pending.scan || pending.bootstrapping}
          className="animate-fade-in-up w-full max-w-md"
        />
        <QuickStatCard
          icon={<AlertTriangle className="h-5 w-5" />}
          label={t("dashboard.directoryWarnings")}
          value={String(directoryScan.errors.length)}
          hint={directoryScan.errors.length > 0 ? t("dashboard.needsReview") : t("dashboard.allClear")}
          tone={directoryScan.errors.length > 0 ? "destructive" : "warning"}
          pending={pending.scan || pending.bootstrapping}
          className="animate-fade-in-up w-full max-w-md"
        />
      </div>
    </div>
  );
}
