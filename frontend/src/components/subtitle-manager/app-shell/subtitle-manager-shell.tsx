import { memo, useCallback } from "react";

import Image from "next/image";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { APP_REPOSITORY_URL, APP_VERSION } from "@/lib/app-version";
import { useI18n } from "@/lib/i18n";
import type { TvSeriesSummary } from "@/lib/types";
import { emitToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogDrawerContent } from "@/components/ui/dialog";

import type { SubtitleManagerScreenModel } from "../hooks/use-subtitle-manager-screen-model";
import { DashboardPanel } from "../dashboard/dashboard-panel";
import { MovieListPanel } from "../movie/movie-list-panel";
import { MovieSubtitleDrawer } from "../movie/movie-subtitle-drawer";
import { UploadBlockingOverlay } from "../shared/upload-blocking-overlay";
import { TvSubtitleDrawer } from "../tv/tv-subtitle-drawer";
import { TvSeriesListPanel } from "../tv/tv-series-list-panel";

const ActiveWorkspace = memo(function ActiveWorkspace({
  activeTab,
  operationLocked,
  onRefresh,
  refreshPending,
  refreshDisabled,
  refreshLabel,
  triggerScan,
  formatTime,
  dashboardScanStatus,
  dashboardDirectoryScan,
  dashboardLogs,
  dashboardLogsPager,
  dashboardVersionInfo,
  dashboardSetLogsPage,
  dashboardRefreshLogs,
  dashboardClearLogs,
  dashboardSetLogsDialogOpen,
  dashboardPending,
  dashboardFormatTime,
  movieQuery,
  movieSetQuery,
  movieVideos,
  moviePager,
  movieViewMode,
  movieYearSortOrder,
  movieToggleYearSort,
  movieSetViewMode,
  movieSetPage,
  movieOpenManager,
  moviePending,
  tvQuery,
  tvSetQuery,
  tvRows,
  tvPager,
  tvViewMode,
  tvYearSortOrder,
  tvSetPage,
  tvToggleYearSort,
  tvSetViewMode,
  tvOpenManagerForSeries,
  tvShowScanPrompt,
  tvScanLoading,
  tvPendingList
}: {
  activeTab: SubtitleManagerScreenModel["shell"]["activeTab"];
  operationLocked: boolean;
  onRefresh: SubtitleManagerScreenModel["shell"]["refreshActiveTab"];
  refreshPending: boolean;
  refreshDisabled: boolean;
  refreshLabel: string;
  triggerScan: SubtitleManagerScreenModel["shell"]["triggerScan"];
  formatTime: SubtitleManagerScreenModel["subtitleActions"]["formatTime"];
  dashboardScanStatus: SubtitleManagerScreenModel["dashboard"]["scanStatus"];
  dashboardDirectoryScan: SubtitleManagerScreenModel["dashboard"]["directoryScan"];
  dashboardLogs: SubtitleManagerScreenModel["dashboard"]["logs"];
  dashboardLogsPager: SubtitleManagerScreenModel["dashboard"]["logsPager"];
  dashboardVersionInfo: SubtitleManagerScreenModel["dashboard"]["versionInfo"];
  dashboardSetLogsPage: SubtitleManagerScreenModel["dashboard"]["setLogsPage"];
  dashboardRefreshLogs: SubtitleManagerScreenModel["dashboard"]["refreshLogs"];
  dashboardClearLogs: SubtitleManagerScreenModel["dashboard"]["clearLogs"];
  dashboardSetLogsDialogOpen: SubtitleManagerScreenModel["dashboard"]["setLogsDialogOpen"];
  dashboardPending: SubtitleManagerScreenModel["dashboard"]["pending"];
  dashboardFormatTime: SubtitleManagerScreenModel["dashboard"]["formatTime"];
  movieQuery: SubtitleManagerScreenModel["movie"]["query"];
  movieSetQuery: SubtitleManagerScreenModel["movie"]["setQuery"];
  movieVideos: SubtitleManagerScreenModel["movie"]["videos"];
  moviePager: SubtitleManagerScreenModel["movie"]["pager"];
  movieViewMode: SubtitleManagerScreenModel["movie"]["viewMode"];
  movieYearSortOrder: SubtitleManagerScreenModel["movie"]["yearSortOrder"];
  movieToggleYearSort: SubtitleManagerScreenModel["movie"]["toggleYearSort"];
  movieSetViewMode: SubtitleManagerScreenModel["movie"]["setViewMode"];
  movieSetPage: SubtitleManagerScreenModel["movie"]["setPage"];
  movieOpenManager: SubtitleManagerScreenModel["movie"]["openManager"];
  moviePending: SubtitleManagerScreenModel["movie"]["pending"];
  tvQuery: SubtitleManagerScreenModel["tv"]["query"];
  tvSetQuery: SubtitleManagerScreenModel["tv"]["setQuery"];
  tvRows: SubtitleManagerScreenModel["tv"]["rows"];
  tvPager: SubtitleManagerScreenModel["tv"]["pager"];
  tvViewMode: SubtitleManagerScreenModel["tv"]["viewMode"];
  tvYearSortOrder: SubtitleManagerScreenModel["tv"]["yearSortOrder"];
  tvSetPage: SubtitleManagerScreenModel["tv"]["setPage"];
  tvToggleYearSort: SubtitleManagerScreenModel["tv"]["toggleYearSort"];
  tvSetViewMode: SubtitleManagerScreenModel["tv"]["setViewMode"];
  tvOpenManagerForSeries: SubtitleManagerScreenModel["tv"]["openManagerForSeries"];
  tvShowScanPrompt: SubtitleManagerScreenModel["tv"]["showScanPrompt"];
  tvScanLoading: SubtitleManagerScreenModel["tv"]["scanLoading"];
  tvPendingList: SubtitleManagerScreenModel["tv"]["pendingList"];
}) {
  const openTvManagerForRow = useCallback(
    (series: TvSeriesSummary) => {
      tvOpenManagerForSeries(series.path);
    },
    [tvOpenManagerForSeries]
  );

  return (
    <div key={activeTab} className="animate-fade-in-up flex min-h-0 flex-1 flex-col">
      {activeTab === "dashboard" && (
        <div className="min-h-0 flex-1 lg:h-full">
          <DashboardPanel
            scanStatus={dashboardScanStatus}
            directoryScan={dashboardDirectoryScan}
            pending={dashboardPending}
            operationLocked={operationLocked}
            scanPending={dashboardPending.scan}
            triggerScan={triggerScan}
            logs={dashboardLogs}
            logsPager={dashboardLogsPager}
            versionInfo={dashboardVersionInfo}
            onSetLogsPage={dashboardSetLogsPage}
            onRefreshLogs={dashboardRefreshLogs}
            onClearLogs={dashboardClearLogs}
            onLogsDialogOpenChange={dashboardSetLogsDialogOpen}
            formatTime={dashboardFormatTime}
          />
        </div>
      )}

      {activeTab === "movie" && (
        <div className="min-h-[var(--panel-min-h)] flex-1 lg:h-full">
          <MovieListPanel
            query={movieQuery}
            onQueryChange={movieSetQuery}
            videos={movieVideos}
            pager={moviePager}
            viewMode={movieViewMode}
            yearSortOrder={movieYearSortOrder}
            onToggleYearSort={movieToggleYearSort}
            onViewModeChange={movieSetViewMode}
            onSetPage={movieSetPage}
            onOpenManager={movieOpenManager}
            operationLocked={operationLocked}
            onRefresh={onRefresh}
            refreshing={refreshPending}
            refreshDisabled={refreshDisabled}
            refreshLabel={refreshLabel}
            pending={moviePending}
            formatTime={formatTime}
          />
        </div>
      )}

      {activeTab === "tv" && (
        <div className="min-h-[var(--panel-min-h)] flex-1 lg:h-full">
          <TvSeriesListPanel
            query={tvQuery}
            onQueryChange={tvSetQuery}
            rows={tvRows}
            pager={tvPager}
            viewMode={tvViewMode}
            yearSortOrder={tvYearSortOrder}
            onSetPage={tvSetPage}
            onToggleYearSort={tvToggleYearSort}
            onViewModeChange={tvSetViewMode}
            onOpenManager={openTvManagerForRow}
            operationLocked={operationLocked}
            onRefresh={onRefresh}
            refreshing={refreshPending}
            refreshDisabled={refreshDisabled}
            refreshLabel={refreshLabel}
            showScanPrompt={tvShowScanPrompt}
            onTriggerScan={triggerScan}
            loading={tvScanLoading}
            pending={tvPendingList}
            formatTime={formatTime}
          />
        </div>
      )}

    </div>
  );
});

ActiveWorkspace.displayName = "ActiveWorkspace";

const ManagementDialogs = memo(function ManagementDialogs({
  dialogs,
  movie,
  tv,
  subtitleActions,
  movieEmptyText
}: {
  dialogs: SubtitleManagerScreenModel["dialogs"];
  movie: SubtitleManagerScreenModel["movie"];
  tv: SubtitleManagerScreenModel["tv"];
  subtitleActions: SubtitleManagerScreenModel["subtitleActions"];
  movieEmptyText: string;
}) {
  const { t } = useI18n();
  const notifyUploadInProgress = useCallback(() => {
    emitToast({
      level: "info",
      title: t("toast.uploadInProgressTitle"),
      message: t("toast.uploadInProgressMessage")
    });
  }, [t]);

  const handleMovieManagerOpenChange = useCallback(
    (open: boolean) => {
      if (!open && subtitleActions.uploading) {
        notifyUploadInProgress();
        return;
      }
      dialogs.setMovieManagerOpen(open);
      if (open) {
        void dialogs.loadMovieWorkspaceOnDemand();
      }
    },
    [dialogs, subtitleActions.uploading, notifyUploadInProgress]
  );

  const handleTvDrawerOpenChange = useCallback(
    (open: boolean) => {
      if (!open && subtitleActions.uploading) {
        notifyUploadInProgress();
        return;
      }
      dialogs.setTvDrawerOpen(open);
      if (open) {
        void dialogs.loadTvWorkspaceOnDemand();
        if (dialogs.tvDrawerMode === "batch") {
          void dialogs.loadTvBatchCandidates();
        }
      }
    },
    [dialogs, subtitleActions.uploading, notifyUploadInProgress]
  );

  const handleTvDrawerModeChange = useCallback(
    (mode: typeof dialogs.tvDrawerMode) => {
      dialogs.setTvDrawerMode(mode);
      if (mode === "batch") {
        void dialogs.loadTvBatchCandidates();
        return;
      }
      void dialogs.loadTvWorkspaceOnDemand();
    },
    [dialogs]
  );

  return (
    <>
      <Dialog
        open={dialogs.movieManagerOpen}
        onOpenChange={handleMovieManagerOpenChange}
      >
        <DialogDrawerContent className="p-0 sm:w-[min(680px,94vw)] xl:w-[min(760px,88vw)] [&_[data-slot=close]]:right-5 [&_[data-slot=close]]:top-5 [&_[data-slot=close]]:z-50">
          <MovieSubtitleDrawer
            ref={dialogs.movieDetailsRef}
            selectedVideo={movie.selectedVideo}
            emptyText={movieEmptyText}
            onUpload={subtitleActions.uploadSubtitle}
            onReplace={subtitleActions.replaceSubtitle}
            onConvertSubtitle={subtitleActions.convertSubtitleToAss}
            onOffsetSubtitle={subtitleActions.offsetSubtitleTiming}
            onRemove={subtitleActions.removeSubtitle}
            onPreviewSubtitle={subtitleActions.previewSubtitle}
            onSearchSubHD={subtitleActions.searchSubHDSubtitles}
            onDownloadSubHD={subtitleActions.downloadSubHDSubtitle}
            formatTime={subtitleActions.formatTime}
            busy={subtitleActions.operationLocked}
            uploading={subtitleActions.uploading}
            uploadingMessage={subtitleActions.uploadingMessage}
            subtitleAction={subtitleActions.subtitleAction}
          />
        </DialogDrawerContent>
      </Dialog>

      <Dialog
        open={dialogs.tvDrawerOpen}
        onOpenChange={handleTvDrawerOpenChange}
      >
        <DialogDrawerContent className="p-0 xl:w-[min(1240px,92vw)] [&_[data-slot=close]]:right-5 [&_[data-slot=close]]:top-5 [&_[data-slot=close]]:z-50">
          <TvSubtitleDrawer
            selectedSeries={tv.selectedSeries}
            selectedSeason={tv.selectedSeason}
            seasonOptions={tv.seasonOptions}
            videos={tv.videos}
            seriesVideos={tv.seriesVideos}
            selectedVideo={tv.selectedVideo}
            selectedVideoId={tv.selectedVideoId}
            onSelectVideo={tv.selectVideo}
            onSeasonChange={tv.setSelectedSeason}
            onUpload={subtitleActions.uploadSubtitle}
            onReplace={subtitleActions.replaceSubtitle}
            onConvertSubtitle={subtitleActions.convertSubtitleToAss}
            onOffsetSubtitle={subtitleActions.offsetSubtitleTiming}
            onRemove={subtitleActions.removeSubtitle}
            onPreviewSubtitle={subtitleActions.previewSubtitle}
            onSearchSubHD={subtitleActions.searchSubHDSubtitles}
            onDownloadSubHD={subtitleActions.downloadSubHDSubtitle}
            formatTime={subtitleActions.formatTime}
            busy={subtitleActions.operationLocked}
            uploading={subtitleActions.uploading}
            uploadingMessage={subtitleActions.uploadingMessage}
            episodesPending={tv.episodesPending}
            subtitleAction={subtitleActions.subtitleAction}
            drawerMode={dialogs.tvDrawerMode}
            onModeChange={handleTvDrawerModeChange}
            onLoadBatchCandidates={dialogs.loadTvBatchCandidates}
            onUploadBatch={dialogs.uploadBatchSubtitles}
            onDeleteBatch={dialogs.removeSubtitlesBatch}
            onSearchSubHDSeasonPacks={dialogs.searchSubHDSeasonPacks}
            onPrepareSubHDSeason={dialogs.prepareSubHDSeasonPack}
            onInstallSubHDSeason={dialogs.installSubHDSeasonPack}
          />
        </DialogDrawerContent>
      </Dialog>
    </>
  );
});

ManagementDialogs.displayName = "ManagementDialogs";

export function SubtitleManagerShell({ model }: { model: SubtitleManagerScreenModel }) {
  const { t } = useI18n();
  const { shell, dashboard, movie, tv, subtitleActions, dialogs } = model;
  const activeTabLabel = shell.navItems.find((item) => item.key === shell.activeTab)?.label ?? shell.activeTab;
  const sidebarCollapsed = shell.sidebarCollapsed;
  const sidebarToggleLabel = sidebarCollapsed ? t("sidebar.expand") : t("sidebar.collapse");
  const refreshDisabled = shell.operationLocked;
  const refreshLabel = shell.refreshPending
    ? t("sidebar.refreshingTab", { tab: activeTabLabel })
    : t("sidebar.refreshTab", { tab: activeTabLabel });

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-0 flex-col lg:flex-row">
        <div className="surface-panel flex shrink-0 flex-col gap-3 p-3 lg:hidden">
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <a
                href={APP_REPOSITORY_URL}
                target="_blank"
                rel="noreferrer"
                className="surface-transition focus-ring block h-8 w-8 bg-surface-subtle p-1"
                title={`Subtitle UI v${APP_VERSION}`}
                aria-label={`Open GitHub repository for Subtitle UI v${APP_VERSION}`}
              >
                <Image
                  src="/icon.svg"
                  alt=""
                  aria-hidden
                  width={32}
                  height={32}
                  className="h-full w-full"
                />
              </a>
            </div>
          </div>
          <div role="tablist" aria-label={t("sidebar.tagline")} className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-0.5">
            {shell.navItems.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={shell.activeTab === item.key}
                className={cn(
                  "surface-transition inline-flex shrink-0 items-center gap-2 px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60",
                  shell.activeTab === item.key
                    ? "bg-surface-strong text-foreground"
                    : "text-muted-foreground hover:bg-surface-subtle hover:text-foreground"
                )}
                disabled={subtitleActions.uploading || model.dashboard.pending.tabSwitch}
                onClick={() => void shell.switchTab(item.key)}
              >
                <span className="flex h-4 w-4 items-center justify-center">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <Card
          className={cn(
            "surface-panel hidden overflow-hidden transition-[width] duration-200 ease-out lg:block lg:h-full lg:shrink-0",
            sidebarCollapsed ? "lg:w-[var(--sidebar-width-collapsed)]" : "lg:w-[var(--sidebar-width)] xl:w-[var(--sidebar-width-xl)]"
          )}
        >
          <CardContent className="flex h-full flex-col gap-4 p-3">
            <div className={cn("flex items-center gap-2", sidebarCollapsed ? "justify-center" : "justify-start")}>
              <a
                href={APP_REPOSITORY_URL}
                target="_blank"
                rel="noreferrer"
                className="surface-transition focus-ring block h-10 w-10 shrink-0 bg-surface-subtle p-1.5 text-foreground-muted hover:text-foreground"
                title={`Subtitle UI v${APP_VERSION}`}
                aria-label={`Open GitHub repository for Subtitle UI v${APP_VERSION}`}
              >
                <Image
                  src="/icon.svg"
                  alt=""
                  aria-hidden
                  width={40}
                  height={40}
                  className="h-full w-full"
                />
              </a>
              {!sidebarCollapsed ? (
                <p className="min-w-0 truncate text-xs text-foreground-muted" title={`Subtitle UI v${APP_VERSION}`}>
                  {`v${APP_VERSION}`}
                </p>
              ) : null}
            </div>

            <div role="tablist" aria-label={t("sidebar.tagline")} className="flex w-full flex-col gap-1.5">
              {shell.navItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={shell.activeTab === item.key}
                  aria-label={item.label}
                  title={item.label}
                  className={cn(
                    "group surface-transition flex h-10 w-full items-center gap-3 overflow-hidden whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60",
                    sidebarCollapsed ? "justify-center px-0" : "justify-start px-3",
                    shell.activeTab === item.key
                      ? "bg-surface-strong text-foreground"
                      : "text-foreground-muted hover:bg-surface-subtle hover:text-foreground"
                  )}
                  disabled={subtitleActions.uploading || model.dashboard.pending.tabSwitch}
                  onClick={() => void shell.switchTab(item.key)}
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center text-foreground-subtle group-hover:text-foreground",
                      shell.activeTab === item.key && "text-foreground"
                    )}
                  >
                    {item.icon}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 truncate text-sm font-semibold transition-[opacity,max-width] duration-200 ease-out",
                      sidebarCollapsed ? "max-w-0 opacity-0" : "max-w-[9rem] opacity-100"
                    )}
                  >
                    {item.label}
                  </span>
                </button>
              ))}
            </div>

            <div className={cn("mt-auto flex", sidebarCollapsed ? "justify-center" : "justify-end")}>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                aria-label={sidebarToggleLabel}
                title={sidebarToggleLabel}
                onClick={shell.toggleSidebarCollapsed}
              >
                {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="min-h-0 min-w-0 flex-1 lg:flex lg:h-full lg:flex-col">
          <ActiveWorkspace
            activeTab={shell.activeTab}
            operationLocked={shell.operationLocked}
            onRefresh={shell.refreshActiveTab}
            refreshPending={shell.refreshPending}
            refreshDisabled={refreshDisabled}
            refreshLabel={refreshLabel}
            triggerScan={shell.triggerScan}
            formatTime={subtitleActions.formatTime}
            dashboardScanStatus={dashboard.scanStatus}
            dashboardDirectoryScan={dashboard.directoryScan}
            dashboardLogs={dashboard.logs}
            dashboardLogsPager={dashboard.logsPager}
            dashboardVersionInfo={dashboard.versionInfo}
            dashboardSetLogsPage={dashboard.setLogsPage}
            dashboardRefreshLogs={dashboard.refreshLogs}
            dashboardClearLogs={dashboard.clearLogs}
            dashboardSetLogsDialogOpen={dashboard.setLogsDialogOpen}
            dashboardPending={dashboard.pending}
            dashboardFormatTime={dashboard.formatTime}
            movieQuery={movie.query}
            movieSetQuery={movie.setQuery}
            movieVideos={movie.videos}
            moviePager={movie.pager}
            movieViewMode={movie.viewMode}
            movieYearSortOrder={movie.yearSortOrder}
            movieToggleYearSort={movie.toggleYearSort}
            movieSetViewMode={movie.setViewMode}
            movieSetPage={movie.setPage}
            movieOpenManager={movie.openManager}
            moviePending={movie.pending}
            tvQuery={tv.query}
            tvSetQuery={tv.setQuery}
            tvRows={tv.rows}
            tvPager={tv.pager}
            tvViewMode={tv.viewMode}
            tvYearSortOrder={tv.yearSortOrder}
            tvSetPage={tv.setPage}
            tvToggleYearSort={tv.toggleYearSort}
            tvSetViewMode={tv.setViewMode}
            tvOpenManagerForSeries={tv.openManagerForSeries}
            tvShowScanPrompt={tv.showScanPrompt}
            tvScanLoading={tv.scanLoading}
            tvPendingList={tv.pendingList}
          />
        </div>

      <ManagementDialogs
        dialogs={dialogs}
        movie={movie}
        tv={tv}
        subtitleActions={subtitleActions}
        movieEmptyText={t("details.movieEmpty")}
      />

      {subtitleActions.uploading && <UploadBlockingOverlay message={subtitleActions.uploadingMessage} />}
    </div>
  );
}
