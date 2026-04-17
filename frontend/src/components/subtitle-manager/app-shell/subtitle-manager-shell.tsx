import { memo, useCallback } from "react";

import Image from "next/image";
import { RefreshCw, Search } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import type { TvSeriesSummary } from "@/lib/types";
import { emitToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogDrawerContent } from "@/components/ui/dialog";

import type { SubtitleManagerScreenModel } from "../hooks/use-subtitle-manager-screen-model";
import { DashboardPanel } from "../dashboard/dashboard-panel";
import { LogsPanel } from "../logs/logs-panel";
import { MovieListPanel } from "../movie/movie-list-panel";
import { MovieSubtitleDrawer } from "../movie/movie-subtitle-drawer";
import { LocaleSelect } from "../shared/settings-controls";
import { SpinnerIcon } from "../shared/pending-state";
import { UploadBlockingOverlay } from "../shared/upload-blocking-overlay";
import { TvSubtitleDrawer } from "../tv/tv-subtitle-drawer";
import { TvSeriesListPanel } from "../tv/tv-series-list-panel";

const ActiveWorkspace = memo(function ActiveWorkspace({
  activeTab,
  operationLocked,
  triggerScan,
  formatTime,
  dashboardScanStatus,
  dashboardDirectoryScan,
  dashboardMessage,
  dashboardLogs,
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
  tvPendingList,
  logsItems,
  logsPending,
  logsFormatTime
}: {
  activeTab: SubtitleManagerScreenModel["shell"]["activeTab"];
  operationLocked: boolean;
  triggerScan: SubtitleManagerScreenModel["shell"]["triggerScan"];
  formatTime: SubtitleManagerScreenModel["subtitleActions"]["formatTime"];
  dashboardScanStatus: SubtitleManagerScreenModel["dashboard"]["scanStatus"];
  dashboardDirectoryScan: SubtitleManagerScreenModel["dashboard"]["directoryScan"];
  dashboardMessage: SubtitleManagerScreenModel["dashboard"]["message"];
  dashboardLogs: SubtitleManagerScreenModel["dashboard"]["logs"];
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
  logsItems: SubtitleManagerScreenModel["logs"]["items"];
  logsPending: SubtitleManagerScreenModel["logs"]["pending"];
  logsFormatTime: SubtitleManagerScreenModel["logs"]["formatTime"];
}) {
  const openTvManagerForRow = useCallback(
    (series: TvSeriesSummary) => {
      tvOpenManagerForSeries(series.path);
    },
    [tvOpenManagerForSeries]
  );

  return (
    <div key={activeTab} className="surface-panel animate-fade-in-up min-h-0 p-2 sm:p-3 lg:flex-1">
      {activeTab === "dashboard" && (
        <div className="lg:h-full lg:overflow-auto lg:pr-1">
          <DashboardPanel
            scanStatus={dashboardScanStatus}
            directoryScan={dashboardDirectoryScan}
            message={dashboardMessage}
            logs={dashboardLogs}
            pending={dashboardPending}
            formatTime={dashboardFormatTime}
          />
        </div>
      )}

      {activeTab === "movie" && (
        <div className="min-h-[360px] lg:h-full">
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
            pending={moviePending}
            formatTime={formatTime}
          />
        </div>
      )}

      {activeTab === "tv" && (
        <div className="min-h-[400px] lg:h-full">
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
            showScanPrompt={tvShowScanPrompt}
            onTriggerScan={triggerScan}
            loading={tvScanLoading}
            pending={tvPendingList}
            formatTime={formatTime}
          />
        </div>
      )}

      {activeTab === "logs" && (
        <div className="min-h-[340px] lg:h-full">
          <LogsPanel logs={logsItems} pending={logsPending} formatTime={logsFormatTime} />
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
        <DialogDrawerContent className="p-0 [&_[data-slot=close]]:right-5 [&_[data-slot=close]]:top-5 [&_[data-slot=close]]:z-50">
          <MovieSubtitleDrawer
            ref={dialogs.movieDetailsRef}
            selectedVideo={movie.selectedVideo}
            emptyText={movieEmptyText}
            onUpload={subtitleActions.uploadSubtitle}
            onReplace={subtitleActions.replaceSubtitle}
            onRemove={subtitleActions.removeSubtitle}
            onPreviewSubtitle={subtitleActions.previewSubtitle}
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
            selectedVideo={tv.selectedVideo}
            selectedVideoId={tv.selectedVideoId}
            onSelectVideo={tv.selectVideo}
            onSeasonChange={tv.setSelectedSeason}
            onUpload={subtitleActions.uploadSubtitle}
            onReplace={subtitleActions.replaceSubtitle}
            onRemove={subtitleActions.removeSubtitle}
            onPreviewSubtitle={subtitleActions.previewSubtitle}
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
          />
        </DialogDrawerContent>
      </Dialog>
    </>
  );
});

ManagementDialogs.displayName = "ManagementDialogs";

export function SubtitleManagerShell({ model }: { model: SubtitleManagerScreenModel }) {
  const { t } = useI18n();
  const { shell, dashboard, movie, tv, logs, subtitleActions, dialogs } = model;
  const activeTabLabel = shell.navItems.find((item) => item.key === shell.activeTab)?.label ?? shell.activeTab;

  return (
    <div className="relative h-full w-full px-3 py-3 sm:px-4 md:px-6 md:py-5">
      <div className="mx-auto grid h-full w-full max-w-[1620px] gap-4 xl:gap-5 lg:grid-cols-[minmax(224px,252px)_minmax(0,1fr)] xl:grid-cols-[minmax(236px,272px)_minmax(0,1fr)]">
        <Card className="surface-panel animate-fade-in-up lg:h-full">
          <CardContent className="flex h-full flex-col gap-5 p-5">
            <div>
              <Image
                src="/icon.svg"
                alt=""
                aria-hidden
                width={56}
                height={56}
                className="mb-2 h-14 w-14 border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] p-2"
              />
              <p className="text-display text-sm font-semibold uppercase tracking-[0.26em] text-[rgba(255,255,255,0.5)]">Subtitle UI</p>
              <p className="mt-2 max-w-[22ch] text-xs leading-relaxed text-muted-foreground">{t("sidebar.tagline")}</p>
            </div>

            <div className="grid gap-1.5">
              {shell.navItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={cn(
                    "group surface-transition flex items-center border px-3.5 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-60",
                    shell.activeTab === item.key
                      ? "border-[rgba(255,255,255,0.2)] bg-[rgba(255,255,255,0.05)] text-foreground"
                      : "border-transparent text-[rgba(255,255,255,0.5)] hover:border-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.03)] hover:text-foreground"
                  )}
                  disabled={subtitleActions.uploading || model.dashboard.pending.tabSwitch}
                  onClick={() => void shell.switchTab(item.key)}
                >
                  <span className="flex items-center gap-3 text-sm font-semibold">
                    <span className={cn("text-[rgba(255,255,255,0.3)] group-hover:text-white", shell.activeTab === item.key && "text-white")}>{item.icon}</span>
                    {item.label}
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-auto space-y-3">
              <Badge variant="outline" className={cn("surface-transition flex w-full items-center justify-center px-3 py-1.5 text-center text-xs", shell.statusBadgeClass)}>
                {shell.statusBadgeText}
              </Badge>
              <div className="surface-subtle flex flex-wrap items-center justify-center gap-2 p-1.5 sm:flex-nowrap">
                <LocaleSelect />
                <Button
                  type="button"
                  size="icon"
                  onClick={() => void shell.triggerScan()}
                  disabled={shell.operationLocked}
                  className="h-10 w-10"
                  aria-label={shell.scanPending ? t("sidebar.scanningMediaLibrary") : t("sidebar.scanMediaLibrary")}
                  title={shell.scanPending ? t("sidebar.scanningMediaLibrary") : t("sidebar.scanMediaLibrary")}
                >
                  {shell.scanPending ? <SpinnerIcon className="h-5 w-5" /> : <Search className="h-5 w-5" />}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => void shell.refreshActiveTab()}
                  disabled={shell.operationLocked}
                  className="h-10 w-10"
                  aria-label={shell.refreshPending ? t("sidebar.refreshingTab", { tab: activeTabLabel }) : t("sidebar.refreshTab", { tab: activeTabLabel })}
                  title={shell.refreshPending ? t("sidebar.refreshingTab", { tab: activeTabLabel }) : t("sidebar.refreshTab", { tab: activeTabLabel })}
                >
                  {shell.refreshPending ? <SpinnerIcon className="h-5 w-5" /> : <RefreshCw className="h-5 w-5" />}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="min-h-0 min-w-0 lg:flex lg:h-full lg:flex-col">
          <ActiveWorkspace
            activeTab={shell.activeTab}
            operationLocked={shell.operationLocked}
            triggerScan={shell.triggerScan}
            formatTime={subtitleActions.formatTime}
            dashboardScanStatus={dashboard.scanStatus}
            dashboardDirectoryScan={dashboard.directoryScan}
            dashboardMessage={dashboard.message}
            dashboardLogs={dashboard.logs}
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
            logsItems={logs.items}
            logsPending={logs.pending}
            logsFormatTime={logs.formatTime}
          />
        </div>
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
