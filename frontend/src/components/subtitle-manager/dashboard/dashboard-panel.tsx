import { useState, type ReactNode } from "react";

import { Activity, AlertTriangle, Database, FolderTree, Search, ScrollText } from "lucide-react";

import { useI18n, type TranslateFn } from "@/lib/i18n";
import type {
  DirectoryScanResult,
  OperationLog,
  Pager,
  ScanStatus,
  UiPendingState,
  VersionInfo
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { LocaleSelect, SubtitleConversionSettingsButton } from "../shared/settings-controls";
import { OperationLogsDialog } from "../shared/operation-logs-dialog";
import { SpinnerIcon } from "../shared/pending-state";
import { ThemeToggle } from "../shared/theme-toggle";
import { QuickStatCard } from "./quick-stat-card";

function SettingsSection({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-display text-xs font-semibold uppercase tracking-section text-foreground-muted">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function SettingsActionRow({
  label,
  children
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="surface-subtle flex min-h-[64px] items-center justify-between gap-3 p-3">
      <p className="min-w-0 text-sm font-semibold text-foreground">{label}</p>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

function formatDatabaseType(databaseType: VersionInfo["databaseType"] | undefined, t: TranslateFn) {
  switch (String(databaseType || "").toLowerCase()) {
    case "postgres":
      return t("settings.databaseType.postgres");
    case "sqlite":
      return t("settings.databaseType.sqlite");
    default:
      return "-";
  }
}

export function DashboardPanel({
  scanStatus,
  directoryScan,
  pending,
  operationLocked,
  scanPending,
  triggerScan,
  logs,
  logsPager,
  versionInfo,
  onSetLogsPage,
  onRefreshLogs,
  onClearLogs,
  onLogsDialogOpenChange,
  formatTime
}: {
  scanStatus: ScanStatus | null;
  directoryScan: DirectoryScanResult;
  pending: UiPendingState;
  operationLocked: boolean;
  scanPending: boolean;
  triggerScan: () => Promise<void>;
  logs: OperationLog[];
  logsPager: Pager;
  versionInfo: VersionInfo | null;
  onSetLogsPage: (page: number) => void;
  onRefreshLogs: (page?: number) => Promise<void>;
  onClearLogs: () => Promise<boolean>;
  onLogsDialogOpenChange?: (open: boolean) => void;
  formatTime: (value: string | undefined | null) => string;
}) {
  const movieCount = directoryScan.movieCount || 0;
  const tvSeriesCount = directoryScan.tvSeriesCount || 0;
  const discoveredDirCount = movieCount + tvSeriesCount;
  const { t } = useI18n();
  const [logsOpen, setLogsOpen] = useState(false);

  function handleLogsOpenChange(open: boolean) {
    setLogsOpen(open);
    onLogsDialogOpenChange?.(open);
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4 lg:h-full">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <QuickStatCard
            icon={<Activity className="h-5 w-5" />}
            label={t("dashboard.lastScanVideos")}
            value={String(scanStatus?.videoCount ?? 0)}
            hint={scanStatus?.running ? t("dashboard.scanInProgress") : t("dashboard.scannerIdle")}
            tone="success"
            pending={pending.scan || pending.bootstrapping}
            className="animate-fade-in-up w-full"
          />
          <QuickStatCard
            icon={<FolderTree className="h-5 w-5" />}
            label={t("dashboard.discoveredDirs")}
            value={String(discoveredDirCount)}
            hint={t("dashboard.movieTvCount", { movie: movieCount, tv: tvSeriesCount })}
            tone="info"
            pending={pending.scan || pending.bootstrapping}
            className="animate-fade-in-up w-full"
          />
          <QuickStatCard
            icon={<AlertTriangle className="h-5 w-5" />}
            label={t("dashboard.directoryWarnings")}
            value={String(directoryScan.errors.length)}
            hint={directoryScan.errors.length > 0 ? t("dashboard.needsReview") : t("dashboard.allClear")}
            tone={directoryScan.errors.length > 0 ? "destructive" : "warning"}
            pending={pending.scan || pending.bootstrapping}
            className="animate-fade-in-up w-full"
          />
        </div>

        <div className="surface-panel animate-fade-in-up flex min-h-0 flex-col gap-6 p-4 sm:p-5">
          <div className="space-y-1">
            <h1 className="text-display text-lg font-semibold uppercase tracking-section text-foreground">{t("settings.title")}</h1>
          </div>

          <div className="grid gap-5">
            <SettingsSection title={t("settings.system")}>
              <SettingsActionRow label={t("settings.databaseType")}>
                <Badge variant="secondary" title={t("settings.databaseType")} aria-label={t("settings.databaseType")} className="gap-2 py-2">
                  <Database className="h-3.5 w-3.5" />
                  {formatDatabaseType(versionInfo?.databaseType, t)}
                </Badge>
              </SettingsActionRow>
            </SettingsSection>

            <SettingsSection title={t("settings.appearance")}>
              <SettingsActionRow label={t("locale.label")}>
                <LocaleSelect menuDirection="down" />
              </SettingsActionRow>
              <SettingsActionRow label={t("sidebar.changeTheme")}>
                <ThemeToggle menuDirection="down" />
              </SettingsActionRow>
            </SettingsSection>

            <SettingsSection title={t("settings.subtitleConversion")}>
              <SettingsActionRow label={t("conversion.settings")}>
                <SubtitleConversionSettingsButton />
              </SettingsActionRow>
            </SettingsSection>

            <SettingsSection title={t("settings.mediaLibrary")}>
              <SettingsActionRow label={t("sidebar.scanMediaLibrary")}>
                <Button
                  type="button"
                  onClick={() => void triggerScan()}
                  disabled={operationLocked}
                  className="h-10"
                  aria-label={scanPending ? t("sidebar.scanningMediaLibrary") : t("sidebar.scanMediaLibrary")}
                  title={scanPending ? t("sidebar.scanningMediaLibrary") : t("sidebar.scanMediaLibrary")}
                >
                  {scanPending ? <SpinnerIcon className="h-4 w-4" /> : <Search className="h-4 w-4" />}
                  {scanPending ? t("sidebar.scanningMediaLibrary") : t("sidebar.scanMediaLibrary")}
                </Button>
              </SettingsActionRow>
            </SettingsSection>

            <SettingsSection title={t("settings.operationLogs")}>
              <SettingsActionRow label={t("logs.title")}>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10"
                  onClick={() => handleLogsOpenChange(true)}
                >
                  <ScrollText className="h-4 w-4" />
                  {t("settings.viewOperationLogs")}
                </Button>
              </SettingsActionRow>
            </SettingsSection>
          </div>
        </div>
      </div>

      <OperationLogsDialog
        open={logsOpen}
        onOpenChange={handleLogsOpenChange}
        logs={logs}
        logsPager={logsPager}
        onSetLogsPage={onSetLogsPage}
        onRefreshLogs={onRefreshLogs}
        onClearLogs={onClearLogs}
        pending={pending}
        formatTime={formatTime}
      />
    </div>
  );
}
