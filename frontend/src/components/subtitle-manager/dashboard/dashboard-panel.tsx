import { useState, type ReactNode } from "react";

import { Database, PanelLeftClose, PanelLeftOpen, Search, ScrollText } from "lucide-react";

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
import { cn } from "@/lib/utils";

import {
  LocaleSelect,
  SonarrSettingsPanel,
  SubHDSettingsPanel,
  SubtitleConversionSettingsPanel
} from "../shared/settings-controls";
import { OperationLogsDialog } from "../shared/operation-logs-dialog";
import { SpinnerIcon } from "../shared/pending-state";
import { ThemeToggle } from "../shared/theme-toggle";

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
    <div className="surface-panel flex min-h-[56px] items-center justify-between gap-3 p-3">
      <p className="min-w-0 shrink text-sm font-semibold text-foreground">{label}</p>
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

function StatusSummaryBar({
  scanStatus,
  directoryScan,
  pending,
  operationLocked,
  scanPending,
  triggerScan
}: {
  scanStatus: ScanStatus | null;
  directoryScan: DirectoryScanResult;
  pending: UiPendingState;
  operationLocked: boolean;
  scanPending: boolean;
  triggerScan: () => Promise<void>;
}) {
  const { t } = useI18n();
  const movieCount = directoryScan.movieCount || 0;
  const tvSeriesCount = directoryScan.tvSeriesCount || 0;
  const discoveredDirCount = movieCount + tvSeriesCount;
  const warningCount = directoryScan.errors.length;
  const scanning = Boolean(scanStatus?.running || scanPending);
  const isPending = pending.scan || pending.bootstrapping;

  const scanLabel = scanPending ? t("sidebar.scanningMediaLibrary") : t("sidebar.scanMediaLibrary");

  return (
    <div
      className={cn(
        "surface-panel flex items-start gap-2 p-3 sm:items-center sm:gap-4",
        isPending && "animate-pulse-soft"
      )}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground">
        <span className={cn("font-medium", scanning ? "text-info-muted" : "text-success-muted")}>
          {scanning ? t("dashboard.scanInProgress") : t("dashboard.scannerIdle")}
        </span>
        <span className="text-border" aria-hidden>
          ·
        </span>
        <span className="text-muted-foreground">{t("dashboard.statusVideos", { count: scanStatus?.videoCount ?? 0 })}</span>
        <span className="text-border" aria-hidden>
          ·
        </span>
        <span className="text-muted-foreground">
          {t("dashboard.statusDirs", { count: discoveredDirCount })}
          <span className="text-foreground-muted"> ({t("dashboard.movieTvCount", { movie: movieCount, tv: tvSeriesCount })})</span>
        </span>
        <span className="text-border" aria-hidden>
          ·
        </span>
        <span className={warningCount > 0 ? "font-medium text-warning-muted" : "text-muted-foreground"}>
          {t("dashboard.statusWarnings", { count: warningCount })}
        </span>
      </div>

      <Button
        type="button"
        size="icon"
        onClick={() => void triggerScan()}
        disabled={operationLocked}
        className="h-9 w-9 shrink-0"
        aria-label={scanLabel}
        title={scanLabel}
      >
        {scanPending ? <SpinnerIcon className="h-4 w-4" /> : <Search className="h-4 w-4" />}
      </Button>
    </div>
  );
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
  formatTime,
  sidebarCollapsed,
  sidebarToggleLabel,
  onToggleSidebar
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
  sidebarCollapsed?: boolean;
  sidebarToggleLabel?: string;
  onToggleSidebar?: () => void;
}) {
  const { t } = useI18n();
  const [logsOpen, setLogsOpen] = useState(false);

  function handleLogsOpenChange(open: boolean) {
    setLogsOpen(open);
    onLogsDialogOpenChange?.(open);
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4 lg:h-full">
      <div className="flex items-start gap-2">
        {onToggleSidebar && sidebarToggleLabel ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="mt-0.5 hidden h-9 w-9 shrink-0 lg:inline-flex"
            onClick={onToggleSidebar}
            aria-label={sidebarToggleLabel}
            title={sidebarToggleLabel}
          >
            {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        ) : null}
        <div className="mx-auto flex min-w-0 w-full max-w-5xl flex-1 flex-col gap-5">
          <StatusSummaryBar
            scanStatus={scanStatus}
            directoryScan={directoryScan}
            pending={pending}
            operationLocked={operationLocked}
            scanPending={scanPending}
            triggerScan={triggerScan}
          />

          <div className="animate-fade-in-up space-y-6">
            <div className="space-y-1">
              <h1 className="text-display text-lg font-semibold uppercase tracking-section text-foreground">{t("settings.title")}</h1>
            </div>

            <div className="grid gap-6">
              <SettingsSection title={t("settings.appearance")}>
                <div className="surface-panel divide-y divide-border">
                  <div className="flex min-h-[56px] items-center justify-between gap-3 p-3">
                    <p className="min-w-0 shrink text-sm font-semibold text-foreground">{t("locale.label")}</p>
                    <div className="shrink-0">
                      <LocaleSelect />
                    </div>
                  </div>
                  <div className="flex min-h-[56px] items-center justify-between gap-3 p-3">
                    <p className="min-w-0 shrink text-sm font-semibold text-foreground">{t("sidebar.changeTheme")}</p>
                    <div className="shrink-0">
                      <ThemeToggle />
                    </div>
                  </div>
                </div>
              </SettingsSection>

              <SettingsSection title={t("settings.subhd")}>
                <SubHDSettingsPanel />
              </SettingsSection>

              <SettingsSection title={t("settings.sonarr")}>
                <SonarrSettingsPanel />
              </SettingsSection>

              <SettingsSection title={t("settings.subtitleConversion")}>
                <SubtitleConversionSettingsPanel />
              </SettingsSection>

              <SettingsSection title={t("settings.system")}>
                <div className="surface-panel divide-y divide-border">
                  <div className="flex min-h-[56px] items-center justify-between gap-3 p-3">
                    <p className="min-w-0 shrink text-sm font-semibold text-foreground">{t("settings.databaseType")}</p>
                    <div className="shrink-0">
                      <Badge variant="secondary" title={t("settings.databaseType")} aria-label={t("settings.databaseType")} className="gap-2 py-2">
                        <Database className="h-3.5 w-3.5" />
                        {formatDatabaseType(versionInfo?.databaseType, t)}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex min-h-[56px] items-center justify-between gap-3 p-3">
                    <p className="min-w-0 shrink text-sm font-semibold text-foreground">{t("logs.title")}</p>
                    <div className="shrink-0">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-9 w-9"
                        onClick={() => handleLogsOpenChange(true)}
                        aria-label={t("settings.viewOperationLogs")}
                        title={t("settings.viewOperationLogs")}
                      >
                        <ScrollText className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </SettingsSection>
            </div>
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
