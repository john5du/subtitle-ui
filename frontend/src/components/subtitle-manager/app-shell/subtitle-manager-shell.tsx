import Image from "next/image";
import { RefreshCw, Search } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";

import type { SubtitleManagerScreenModel } from "../hooks/use-subtitle-manager-screen-model";
import { DashboardPanel } from "../dashboard/dashboard-panel";
import { LogsPanel } from "../logs/logs-panel";
import { MovieListPanel } from "../movie/movie-list-panel";
import { SubtitleDetailsPanel } from "../subtitle/subtitle-details-panel";
import { LocaleSelect, ThemeModeSelect } from "../shared/settings-controls";
import { SpinnerIcon } from "../shared/pending-state";
import { UploadBlockingOverlay } from "../shared/upload-blocking-overlay";
import { TvSeasonBatchUploadDialog } from "../tv/tv-season-batch-upload-dialog";
import { TvSeriesListPanel } from "../tv/tv-series-list-panel";
import { TvSubtitleManagementPanel } from "../tv/tv-subtitle-management-panel";

export function SubtitleManagerShell({ model }: { model: SubtitleManagerScreenModel }) {
  const { t } = useI18n();
  const { shell, dashboard, movie, tv, logs, subtitleActions, dialogs } = model;

  return (
    <div className="relative h-full w-full px-3 py-3 md:px-6 md:py-5">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-20 -top-24 h-72 w-72 rounded-full bg-cyan-500/12 blur-3xl" />
        <div className="absolute -right-20 bottom-0 h-80 w-80 rounded-full bg-orange-500/12 blur-3xl" />
      </div>
      <div className="mx-auto grid h-full w-full max-w-[1620px] gap-4 lg:grid-cols-[268px_minmax(0,1fr)]">
        <Card className="animate-fade-in-up border border-border/75 bg-card/90 lg:h-full">
          <CardContent className="flex h-full flex-col gap-5 p-5">
            <div>
              <Image
                src="/icon.svg"
                alt=""
                aria-hidden
                width={56}
                height={56}
                className="mb-2 h-14 w-14 rounded-2xl border border-primary/25 bg-background/80 p-2 shadow-[0_14px_28px_-20px_rgba(8,145,178,0.85)]"
              />
              <p className="text-display text-sm font-semibold uppercase tracking-[0.26em] text-primary/80">Subtitle UI</p>
              <p className="mt-2 max-w-[22ch] text-xs leading-relaxed text-muted-foreground">{t("sidebar.tagline")}</p>
            </div>

            <div className="grid gap-1.5">
              {shell.navItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={cn(
                    "group surface-transition flex items-center rounded-xl border px-3.5 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-60",
                    shell.activeTab === item.key
                      ? "border-primary/45 bg-gradient-to-r from-primary/16 to-primary/8 text-foreground shadow-[0_14px_32px_-24px_hsl(var(--primary))]"
                      : "border-transparent text-muted-foreground hover:border-border/80 hover:bg-accent/70 hover:text-foreground"
                  )}
                  disabled={subtitleActions.uploading || model.dashboard.pending.tabSwitch}
                  onClick={() => void shell.switchTab(item.key)}
                >
                  <span className="flex items-center gap-3 text-sm font-semibold">
                    <span className={cn("text-primary/70 group-hover:text-primary", shell.activeTab === item.key && "text-primary")}>{item.icon}</span>
                    {item.label}
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-auto space-y-3">
              <Badge variant="outline" className={cn("surface-transition flex w-full items-center justify-center rounded-xl px-3 py-1.5 text-center text-xs", shell.statusBadgeClass)}>
                {shell.statusBadgeText}
              </Badge>
              <div className="flex items-center justify-center gap-2 rounded-xl border border-border/70 bg-background/65 p-1.5">
                <LocaleSelect />
                <ThemeModeSelect />
                <Button
                  type="button"
                  size="icon"
                  onClick={() => void shell.triggerScan()}
                  disabled={shell.operationLocked}
                  className="h-10 w-10 rounded-xl"
                >
                  {shell.scanPending ? <SpinnerIcon className="h-5 w-5" /> : <Search className="h-5 w-5" />}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => void shell.refreshActiveTab()}
                  disabled={shell.operationLocked}
                  className="h-10 w-10 rounded-xl"
                >
                  {shell.refreshPending ? <SpinnerIcon className="h-5 w-5" /> : <RefreshCw className="h-5 w-5" />}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="min-h-0 min-w-0 lg:flex lg:h-full lg:flex-col">
          <div key={shell.activeTab} className="animate-fade-in-up min-h-0 rounded-2xl border border-border/65 bg-card/55 p-2 shadow-[0_24px_64px_-44px_rgba(15,23,42,0.7)] lg:flex-1">
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
              <div className="min-h-[430px] lg:h-full">
                <MovieListPanel
                  query={movie.query}
                  onQueryChange={movie.setQuery}
                  videos={movie.videos}
                  pager={movie.pager}
                  viewMode={movie.viewMode}
                  yearSortOrder={movie.yearSortOrder}
                  onToggleYearSort={movie.toggleYearSort}
                  onViewModeChange={movie.setViewMode}
                  onSelectVideo={movie.selectVideo}
                  onSetPage={movie.setPage}
                  onOpenUploadPicker={movie.openUploadPicker}
                  onOpenManager={movie.openManager}
                  operationLocked={shell.operationLocked}
                  pending={movie.pending}
                  formatTime={subtitleActions.formatTime}
                />
              </div>
            )}

            {shell.activeTab === "tv" && (
              <div className="min-h-[520px] lg:h-full">
                <TvSeriesListPanel
                  query={tv.query}
                  onQueryChange={tv.setQuery}
                  rows={tv.rows}
                  pager={tv.pager}
                  viewMode={tv.viewMode}
                  yearSortOrder={tv.yearSortOrder}
                  onSelectSeries={tv.selectSeries}
                  onSetPage={tv.setPage}
                  onToggleYearSort={tv.toggleYearSort}
                  onViewModeChange={tv.setViewMode}
                  onOpenManager={(series) => tv.openManagerForSeries(series.path)}
                  onOpenBatch={(series) => tv.openBatchForSeries(series.path)}
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
              <div className="min-h-[420px] lg:h-full">
                <LogsPanel logs={logs.items} pending={logs.pending} formatTime={logs.formatTime} />
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog
        open={dialogs.movieManagerOpen}
        onOpenChange={(open) => {
          if (!open && subtitleActions.uploading) {
            return;
          }
          dialogs.setMovieManagerOpen(open);
          if (open) {
            void dialogs.loadMovieWorkspaceOnDemand();
          }
        }}
      >
        <DialogContent className="flex h-[90vh] max-h-[90vh] w-[min(1100px,96vw)] max-w-none overflow-hidden p-0">
          <SubtitleDetailsPanel
            ref={dialogs.movieDetailsRef}
            panelTitle={t("details.movieManagementTitle")}
            selectedVideo={movie.selectedVideo}
            emptyText={t("details.movieEmpty")}
            showBack={false}
            onBack={() => {}}
            infoRows={[]}
            onUpload={subtitleActions.uploadSubtitle}
            onReplace={subtitleActions.replaceSubtitle}
            onRemove={subtitleActions.removeSubtitle}
            onPreviewSubtitle={subtitleActions.previewSubtitle}
            formatTime={subtitleActions.formatTime}
            busy={subtitleActions.operationLocked}
            uploading={subtitleActions.uploading}
            uploadingMessage={subtitleActions.uploadingMessage}
            subtitleAction={subtitleActions.subtitleAction}
            showSearchLinks={false}
            showUploadButton={false}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialogs.tvManagerOpen}
        onOpenChange={(open) => {
          if (!open && subtitleActions.uploading) {
            return;
          }
          dialogs.setTvManagerOpen(open);
          if (open) {
            void dialogs.loadTvWorkspaceOnDemand();
          }
        }}
      >
        <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none overflow-hidden rounded-none p-0 sm:h-[90vh] sm:max-h-[90vh] sm:w-[min(1280px,96vw)] sm:rounded-lg [&>button]:right-3 [&>button]:top-3 [&>button]:z-50">
          <TvSubtitleManagementPanel
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
          />
        </DialogContent>
      </Dialog>

      <TvSeasonBatchUploadDialog
        open={dialogs.tvBatchOpen}
        onOpenChange={(open) => {
          if (!open && subtitleActions.uploading) {
            return;
          }
          dialogs.setTvBatchOpen(open);
          if (open) {
            void dialogs.loadTvWorkspaceOnDemand();
          }
        }}
        busy={subtitleActions.operationLocked}
        uploading={subtitleActions.uploading}
        uploadingMessage={subtitleActions.uploadingMessage}
        onLoadBatchCandidates={dialogs.loadTvBatchCandidates}
        onUploadBatch={dialogs.uploadBatchSubtitles}
      />

      {subtitleActions.uploading && <UploadBlockingOverlay message={subtitleActions.uploadingMessage} />}
    </div>
  );
}
