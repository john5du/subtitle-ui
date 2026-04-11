import Image from "next/image";
import { RefreshCw, Search } from "lucide-react";

import { useI18n } from "@/lib/i18n";
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

export function SubtitleManagerShell({ model }: { model: SubtitleManagerScreenModel }) {
  const { t } = useI18n();
  const { shell, dashboard, movie, tv, logs, subtitleActions, dialogs } = model;

  function handleMovieManagerOpenChange(open: boolean) {
    if (!open && subtitleActions.uploading) {
      return;
    }
    dialogs.setMovieManagerOpen(open);
    if (open) {
      void dialogs.loadMovieWorkspaceOnDemand();
    }
  }

  function handleTvDrawerOpenChange(open: boolean) {
    if (!open && subtitleActions.uploading) {
      return;
    }
    dialogs.setTvDrawerOpen(open);
    if (open) {
      void dialogs.loadTvWorkspaceOnDemand();
      if (dialogs.tvDrawerMode === "batch") {
        void dialogs.loadTvBatchCandidates();
      }
    }
  }

  function handleTvDrawerModeChange(mode: typeof dialogs.tvDrawerMode) {
    dialogs.setTvDrawerMode(mode);
    if (mode === "batch") {
      void dialogs.loadTvBatchCandidates();
      return;
    }
    void dialogs.loadTvWorkspaceOnDemand();
  }

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
                >
                  {shell.refreshPending ? <SpinnerIcon className="h-5 w-5" /> : <RefreshCw className="h-5 w-5" />}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="min-h-0 min-w-0 lg:flex lg:h-full lg:flex-col">
          <div key={shell.activeTab} className="surface-panel animate-fade-in-up min-h-0 p-2 sm:p-3 lg:flex-1">
            {shell.activeTab === "dashboard" && (
              <div className="lg:h-full lg:overflow-auto lg:pr-1">
                <DashboardPanel
                  scanStatus={dashboard.scanStatus}
                  directoryScan={dashboard.directoryScan}
                  message={dashboard.message}
                  logs={dashboard.logs}
                  pending={dashboard.pending}
                  formatTime={dashboard.formatTime}
                />
              </div>
            )}

            {shell.activeTab === "movie" && (
              <div className="min-h-[360px] lg:h-full">
                <MovieListPanel
                  query={movie.query}
                  onQueryChange={movie.setQuery}
                  videos={movie.videos}
                  pager={movie.pager}
                  viewMode={movie.viewMode}
                  yearSortOrder={movie.yearSortOrder}
                  onToggleYearSort={movie.toggleYearSort}
                  onViewModeChange={movie.setViewMode}
                  onSetPage={movie.setPage}
                  onOpenManager={movie.openManager}
                  operationLocked={shell.operationLocked}
                  pending={movie.pending}
                  formatTime={subtitleActions.formatTime}
                />
              </div>
            )}

            {shell.activeTab === "tv" && (
              <div className="min-h-[400px] lg:h-full">
                <TvSeriesListPanel
                  query={tv.query}
                  onQueryChange={tv.setQuery}
                  rows={tv.rows}
                  pager={tv.pager}
                  viewMode={tv.viewMode}
                  yearSortOrder={tv.yearSortOrder}
                  onSetPage={tv.setPage}
                  onToggleYearSort={tv.toggleYearSort}
                  onViewModeChange={tv.setViewMode}
                  onOpenManager={(series) => tv.openManagerForSeries(series.path)}
                  operationLocked={shell.operationLocked}
                  showScanPrompt={tv.showScanPrompt}
                  onTriggerScan={shell.triggerScan}
                  loading={tv.scanLoading}
                  pending={tv.pendingList}
                  formatTime={subtitleActions.formatTime}
                />
              </div>
            )}

            {shell.activeTab === "logs" && (
              <div className="min-h-[340px] lg:h-full">
                <LogsPanel logs={logs.items} pending={logs.pending} formatTime={logs.formatTime} />
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog
        open={dialogs.movieManagerOpen}
        onOpenChange={handleMovieManagerOpenChange}
      >
        <DialogDrawerContent className="p-0 [&>button]:right-5 [&>button]:top-5 [&>button]:z-50">
          <MovieSubtitleDrawer
            ref={dialogs.movieDetailsRef}
            selectedVideo={movie.selectedVideo}
            emptyText={t("details.movieEmpty")}
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
        <DialogDrawerContent className="p-0 xl:w-[min(1240px,92vw)] [&>button]:right-5 [&>button]:top-5 [&>button]:z-50">
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

      {subtitleActions.uploading && <UploadBlockingOverlay message={subtitleActions.uploadingMessage} />}
    </div>
  );
}
