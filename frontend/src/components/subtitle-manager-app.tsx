"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  Film,
  FileText,
  FolderTree,
  LayoutDashboard,
  RefreshCw,
  Search,
  Trash2,
  Tv
} from "lucide-react";
import { useTheme } from "next-themes";

import { useIsMobile } from "@/hooks/use-is-mobile";
import { useSubtitleManager } from "@/hooks/use-subtitle-manager";
import type {
  ActiveTab,
  BatchSubtitleUploadItem,
  BatchSubtitleUploadResult,
  DirectoryScanResult,
  OperationLog,
  Pager,
  ScanStatus,
  Subtitle,
  TvSeasonOption,
  TvSeriesSummary,
  Video,
} from "@/lib/types";
import { buildSubtitleSearchLinks, buildSubtitleSearchLinksByKeyword } from "@/lib/subtitle-search";
import {
  extractSubtitleEntriesFromZip,
  isSubtitleFileName,
  isZipFileName,
  toSubtitleFile,
  type ZipSubtitleEntry
} from "@/lib/subtitle-zip";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type MobileView = "list" | "details";
interface SeasonEpisodeInfo {
  season: number;
  episode: number;
}

interface SeasonBatchMappingRow {
  id: string;
  entry: ZipSubtitleEntry;
  season: number | null;
  episode: number | null;
  autoVideoId: string;
  selectedVideoId: string;
}

function parseSeasonEpisode(text: string): SeasonEpisodeInfo | null {
  const patterns = [
    /\bs(\d{1,2})e(\d{1,3})\b/i,
    /\b(\d{1,2})x(\d{1,3})\b/i,
    /\bseason[\s._-]*(\d{1,2})[\s._-]*episode[\s._-]*(\d{1,3})\b/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }
    return {
      season: Number.parseInt(match[1], 10),
      episode: Number.parseInt(match[2], 10)
    };
  }

  return null;
}

function parseVideoSeasonEpisode(video: Video): SeasonEpisodeInfo | null {
  return parseSeasonEpisode(`${video.fileName ?? ""} ${video.title ?? ""}`);
}

function formatSeasonEpisodeText(season: number | null, episode: number | null) {
  if (season === null || episode === null) {
    return "-";
  }
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

function compareTvVideosByEpisode(a: Video, b: Video) {
  const aa = parseVideoSeasonEpisode(a);
  const bb = parseVideoSeasonEpisode(b);

  const seasonA = aa?.season ?? Number.MAX_SAFE_INTEGER;
  const seasonB = bb?.season ?? Number.MAX_SAFE_INTEGER;
  if (seasonA !== seasonB) {
    return seasonA - seasonB;
  }

  const episodeA = aa?.episode ?? Number.MAX_SAFE_INTEGER;
  const episodeB = bb?.episode ?? Number.MAX_SAFE_INTEGER;
  if (episodeA !== episodeB) {
    return episodeA - episodeB;
  }

  const byName = (a.fileName ?? "").localeCompare(b.fileName ?? "");
  if (byName !== 0) {
    return byName;
  }

  return (a.title ?? "").localeCompare(b.title ?? "");
}

function buildSeasonBatchRows(videos: Video[], entries: ZipSubtitleEntry[]) {
  const byEpisode = new Map<string, Video[]>();
  for (const video of videos) {
    const parsed = parseVideoSeasonEpisode(video);
    if (!parsed) {
      continue;
    }
    const key = `${parsed.season}-${parsed.episode}`;
    const list = byEpisode.get(key) ?? [];
    list.push(video);
    byEpisode.set(key, list);
  }

  const rows = entries.map((entry) => {
    const parsed = parseSeasonEpisode(`${entry.path} ${entry.fileName}`);
    const season = parsed?.season ?? null;
    const episode = parsed?.episode ?? null;
    let autoVideoId = "";
    if (season !== null && episode !== null) {
      const key = `${season}-${episode}`;
      const candidates = byEpisode.get(key) ?? [];
      if (candidates.length === 1) {
        autoVideoId = candidates[0].id;
      }
    }

    return {
      id: entry.id,
      entry,
      season,
      episode,
      autoVideoId,
      selectedVideoId: autoVideoId
    } satisfies SeasonBatchMappingRow;
  });

  rows.sort((a, b) => {
    const seasonA = a.season ?? Number.MAX_SAFE_INTEGER;
    const seasonB = b.season ?? Number.MAX_SAFE_INTEGER;
    if (seasonA !== seasonB) {
      return seasonA - seasonB;
    }

    const episodeA = a.episode ?? Number.MAX_SAFE_INTEGER;
    const episodeB = b.episode ?? Number.MAX_SAFE_INTEGER;
    if (episodeA !== episodeB) {
      return episodeA - episodeB;
    }

    return a.entry.path.localeCompare(b.entry.path);
  });

  return rows;
}

function candidateVideosForBatchRow(row: SeasonBatchMappingRow, videos: Video[]) {
  if (row.season === null) {
    return [...videos].sort(compareTvVideosByEpisode);
  }

  const sameSeason = videos.filter((video) => parseVideoSeasonEpisode(video)?.season === row.season);
  if (sameSeason.length > 0) {
    sameSeason.sort(compareTvVideosByEpisode);
    return sameSeason;
  }

  return [...videos].sort(compareTvVideosByEpisode);
}

export function SubtitleManagerApp() {
  const {
    activeTab,
    movieQuery,
    tvQuery,
    movieVideos,
    tvSeriesRows,
    selectedTvSeries,
    sortedTvVideos,
    tvSeasonOptions,
    selectedTvSeason,
    selectedVideoIdByType,
    selectedVideo,
    moviePager,
    selectedTvDirPath,
    logs,
    scanStatus,
    directoryScan,
    loading,
    message,
    switchTab,
    triggerScan,
    refreshActiveTab,
    selectMovieVideo,
    selectTvVideo,
    selectTvDirectory,
    setMoviePage,
    uploadSubtitle,
    replaceSubtitle,
    removeSubtitle,
    loadTvBatchCandidates,
    uploadBatchSubtitles,
    setMovieQuery,
    setTvQuery,
    setSelectedTvSeason,
    formatTime
  } = useSubtitleManager();

  const isMobile = useIsMobile(960);
  const [movieMobileView, setMovieMobileView] = useState<MobileView>("list");
  const [tvManagerOpen, setTvManagerOpen] = useState(false);
  const [tvBatchOpen, setTvBatchOpen] = useState(false);

  const refreshText = useMemo(() => {
    if (activeTab === "dashboard") return "Refresh Dashboard";
    if (activeTab === "logs") return "Refresh Logs";
    return "Refresh";
  }, [activeTab]);

  useEffect(() => {
    if (!isMobile) {
      setMovieMobileView("list");
      return;
    }

    if (activeTab === "movie") {
      setMovieMobileView("list");
    }
  }, [activeTab, isMobile]);

  function handleMovieSelect(video: Video) {
    selectMovieVideo(video);
  }

  function handleTvSelect(video: Video) {
    selectTvVideo(video);
  }

  return (
    <div className="mx-auto grid w-full max-w-[1440px] gap-3 p-3 md:gap-4 md:p-6">
      <Tabs value={activeTab} onValueChange={(value) => void switchTab(value as ActiveTab)} className="space-y-3">
        <Card className="border bg-card dark:border-slate-800 dark:bg-[linear-gradient(180deg,rgba(7,12,27,0.95),rgba(3,8,20,0.94))]">
          <CardContent className="flex items-center justify-between gap-3 overflow-x-auto p-3">
            <div className="min-w-max">
              <TabsList className="inline-flex h-11 w-auto min-w-max items-center gap-1 rounded-2xl border border-slate-200 bg-slate-50 p-1 text-slate-600 dark:border-slate-700/70 dark:bg-[#050810]/90 dark:text-slate-300">
                <TabsTrigger
                  value="dashboard"
                  className="h-9 gap-2 rounded-xl px-3 text-sm font-medium transition-all hover:text-slate-900 data-[state=active]:bg-[radial-gradient(circle_at_12%_12%,rgba(96,165,250,0.28),rgba(9,28,63,0.9)_60%)] data-[state=active]:text-white data-[state=active]:shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_8px_24px_rgba(0,0,0,0.45)] dark:hover:text-white"
                >
                  <LayoutDashboard className="h-4 w-4" />
                  Dashboard
                </TabsTrigger>
                <TabsTrigger
                  value="movie"
                  className="h-9 gap-2 rounded-xl px-3 text-sm font-medium transition-all hover:text-slate-900 data-[state=active]:bg-[radial-gradient(circle_at_12%_12%,rgba(255,94,94,0.32),rgba(46,8,18,0.9)_58%)] data-[state=active]:text-white data-[state=active]:shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_8px_24px_rgba(0,0,0,0.45)] dark:hover:text-white"
                >
                  <Film className="h-4 w-4" />
                  Movie
                </TabsTrigger>
                <TabsTrigger
                  value="tv"
                  className="h-9 gap-2 rounded-xl px-3 text-sm font-medium transition-all hover:text-slate-900 data-[state=active]:bg-[radial-gradient(circle_at_12%_12%,rgba(96,165,250,0.28),rgba(9,28,63,0.9)_60%)] data-[state=active]:text-white data-[state=active]:shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_8px_24px_rgba(0,0,0,0.45)] dark:hover:text-white"
                >
                  <Tv className="h-4 w-4" />
                  TV
                </TabsTrigger>
                <TabsTrigger
                  value="logs"
                  className="h-9 gap-2 rounded-xl px-3 text-sm font-medium transition-all hover:text-slate-900 data-[state=active]:bg-[radial-gradient(circle_at_12%_12%,rgba(248,113,113,0.3),rgba(71,15,17,0.9)_58%)] data-[state=active]:text-white data-[state=active]:shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_8px_24px_rgba(0,0,0,0.45)] dark:hover:text-white"
                >
                  <FileText className="h-4 w-4" />
                  Logs
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <ThemeModeSelect />
              <Button type="button" onClick={() => void triggerScan()} disabled={loading} className="h-9 gap-2">
                <Search className="h-4 w-4" />
                Scan
              </Button>
              <Button type="button" variant="secondary" onClick={() => void refreshActiveTab()} disabled={loading} className="h-9 gap-2">
                <RefreshCw className="h-4 w-4" />
                {refreshText}
              </Button>
            </div>
          </CardContent>
        </Card>

        <TabsContent value="dashboard" className="space-y-3">
          <DashboardPanel
            scanStatus={scanStatus}
            directoryScan={directoryScan}
            message={message}
          />
        </TabsContent>

        <TabsContent value="movie" className="space-y-3">
          <MovieActionsPanel
            selectedVideo={selectedVideo}
            onOpenManager={() => {
              if (!selectedVideoIdByType.movie && movieVideos.length > 0) {
                selectMovieVideo(movieVideos[0]);
              }
              setMovieMobileView("details");
            }}
          />

          <div className="xl:h-[calc(100vh-260px)]">
            <MovieListPanel
              query={movieQuery}
              onQueryChange={setMovieQuery}
              videos={movieVideos}
              selectedVideoId={selectedVideoIdByType.movie}
              pager={moviePager}
              onSelectVideo={handleMovieSelect}
              onSetPage={setMoviePage}
              formatTime={formatTime}
            />
          </div>

          <Dialog
            open={movieMobileView === "details"}
            onOpenChange={(open) => {
              if (!open) {
                setMovieMobileView("list");
                return;
              }
              setMovieMobileView("details");
            }}
          >
            <DialogContent className="flex h-[90vh] max-h-[90vh] w-[min(1100px,96vw)] max-w-none overflow-hidden p-0">
              <SubtitleDetailsPanel
                panelTitle="Movie Subtitle Management"
                selectedVideo={selectedVideo}
                emptyText="Select a movie from the list."
                showBack={false}
                onBack={() => setMovieMobileView("list")}
                infoRows={[]}
                onUpload={uploadSubtitle}
                onReplace={replaceSubtitle}
                onRemove={removeSubtitle}
                formatTime={formatTime}
                busy={loading}
                showSearchLinks={false}
              />
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="tv" className="space-y-3">
          <TvActionsPanel
            selectedSeries={selectedTvSeries}
            onOpenManager={() => {
              if (!selectedVideoIdByType.tv && sortedTvVideos.length > 0) {
                selectTvVideo(sortedTvVideos[0]);
              }
              setTvManagerOpen(true);
            }}
            onOpenSeasonBatch={() => {
              setTvBatchOpen(true);
            }}
          />

          <div className="xl:h-[calc(100vh-260px)]">
            <TvSeriesListPanel
              query={tvQuery}
              onQueryChange={setTvQuery}
              rows={tvSeriesRows}
              selectedSeriesPath={selectedTvDirPath}
              onSelectSeries={selectTvDirectory}
              formatTime={formatTime}
            />
          </div>

          <Dialog open={tvManagerOpen} onOpenChange={setTvManagerOpen}>
            <DialogContent className="flex h-[90vh] max-h-[90vh] w-[min(1280px,96vw)] max-w-none overflow-hidden p-0 [&>button]:right-3 [&>button]:top-3 [&>button]:z-50">
              <TvSubtitleManagementPanel
                selectedSeries={selectedTvSeries}
                selectedSeason={selectedTvSeason}
                seasonOptions={tvSeasonOptions}
                videos={sortedTvVideos}
                selectedVideo={selectedVideo}
                selectedVideoId={selectedVideoIdByType.tv}
                onSelectVideo={handleTvSelect}
                onSeasonChange={setSelectedTvSeason}
                onUpload={uploadSubtitle}
                onReplace={replaceSubtitle}
                onRemove={removeSubtitle}
                formatTime={formatTime}
                busy={loading}
              />
            </DialogContent>
          </Dialog>

          <TvSeasonBatchUploadDialog
            open={tvBatchOpen}
            onOpenChange={setTvBatchOpen}
            busy={loading}
            onLoadBatchCandidates={loadTvBatchCandidates}
            onUploadBatch={uploadBatchSubtitles}
          />
        </TabsContent>

        <TabsContent value="logs">
          <LogsPanel logs={logs} formatTime={formatTime} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DashboardPanel({
  scanStatus,
  directoryScan,
  message
}: {
  scanStatus: ScanStatus | null;
  directoryScan: DirectoryScanResult;
  message: string;
}) {
  return (
    <>
      <div className="grid gap-3 md:grid-cols-3">
        <QuickStatCard
          icon={<Activity className="h-4 w-4" />}
          label="Last Scan Videos"
          value={String(scanStatus?.videoCount ?? 0)}
          hint={scanStatus?.running ? "Scan in progress" : "Scanner idle"}
          tone="emerald"
        />
        <QuickStatCard
          icon={<FolderTree className="h-4 w-4" />}
          label="Discovered Dirs"
          value={String(directoryScan.movie.length + directoryScan.tv.length)}
          hint={`Movie ${directoryScan.movie.length} / TV ${directoryScan.tv.length}`}
          tone="blue"
        />
        <QuickStatCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Directory Warnings"
          value={String(directoryScan.errors.length)}
          hint={directoryScan.errors.length > 0 ? "Needs review" : "All clear"}
          tone={directoryScan.errors.length > 0 ? "rose" : "amber"}
        />
      </div>

      <Card className="border bg-card dark:border-slate-800 dark:bg-[linear-gradient(180deg,rgba(7,12,27,0.92),rgba(5,10,22,0.9))]">
        <CardContent className="flex items-center gap-3 p-4 text-sm">
          <Badge variant="outline">Status</Badge>
          <p className="max-w-full break-all font-medium text-foreground" role="status" aria-live="polite">
            {message || "Ready"}
          </p>
        </CardContent>
      </Card>
    </>
  );
}

function ThemeModeSelect() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const value = mounted ? theme || "system" : "system";

  return (
    <div className="flex items-center gap-2 rounded-lg border bg-background px-2 py-1 dark:border-slate-700 dark:bg-slate-900/80">
      <span className="text-xs font-semibold text-muted-foreground">Theme</span>
      <Select value={value} onValueChange={setTheme}>
        <SelectTrigger className="h-8 w-[126px] border-none bg-transparent px-2 text-xs shadow-none focus:ring-0">
          <SelectValue placeholder="Theme" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="system">System</SelectItem>
          <SelectItem value="light">Light</SelectItem>
          <SelectItem value="dark">Dark</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

interface MovieListPanelProps {
  query: string;
  onQueryChange: (value: string) => void;
  videos: Video[];
  selectedVideoId: string;
  pager: Pager;
  onSelectVideo: (video: Video) => void;
  onSetPage: (page: number) => void;
  formatTime: (value: string | undefined | null) => string;
}

function MovieListPanel({
  query,
  onQueryChange,
  videos,
  selectedVideoId,
  pager,
  onSelectVideo,
  onSetPage,
  formatTime
}: MovieListPanelProps) {
  return (
    <Card className="flex h-full flex-col border bg-card">
      <CardHeader className="space-y-3 p-4">
        <CardTitle className="text-lg">Movie List</CardTitle>
        <Input
          value={query}
          aria-label="Filter movies by title or path"
          placeholder="Filter by title/path"
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-4 pt-0">
        <ScrollArea className="min-h-0 flex-1 rounded-md border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead className="w-[80px]">Year</TableHead>
                <TableHead className="w-[170px]">Updated Time</TableHead>
                <TableHead className="w-[100px] text-right">Subtitles</TableHead>
                <TableHead className="w-[360px]">File Name</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {videos.map((video) => {
                const active = selectedVideoId === video.id;
                return (
                  <TableRow
                    key={video.id}
                    className={cn("cursor-pointer", active ? "bg-primary/10" : "hover:bg-accent")}
                    onClick={() => onSelectVideo(video)}
                    aria-selected={active}
                  >
                    <TableCell className="max-w-[240px] truncate font-medium" title={video.title}>
                      {video.title || "-"}
                    </TableCell>
                    <TableCell>{video.year || "-"}</TableCell>
                    <TableCell>{formatTime(video.updatedAt)}</TableCell>
                    <TableCell className="text-right">{video.subtitles.length}</TableCell>
                    <TableCell className="max-w-[360px] truncate" title={video.fileName}>
                      {video.fileName || "-"}
                    </TableCell>
                  </TableRow>
                );
              })}

              {videos.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    No movies found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>

        <PagerView pager={pager} onSetPage={onSetPage} />
      </CardContent>
    </Card>
  );
}

function MovieActionsPanel({
  selectedVideo,
  onOpenManager
}: {
  selectedVideo: Video | null;
  onOpenManager: () => void;
}) {
  const [open, setOpen] = useState(false);
  const searchLinks = useMemo(() => {
    if (!selectedVideo) {
      return null;
    }
    return buildSubtitleSearchLinks(selectedVideo);
  }, [selectedVideo]);

  return (
    <Card className="border bg-card">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Selected Movie</p>
          <p className="truncate text-sm font-semibold">{selectedVideo?.title || "Please select a movie from the list"}</p>
        </div>
        <Button type="button" onClick={() => setOpen(true)} disabled={!selectedVideo}>
          Actions
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Movie Actions</DialogTitle>
            <DialogDescription>
              {selectedVideo ? selectedVideo.title : "Select a movie first."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenManager();
                setOpen(false);
              }}
              disabled={!selectedVideo}
            >
              Open Movie Subtitle Management
            </Button>
            {searchLinks && (
              <Button type="button" variant="outline" asChild>
                <a href={searchLinks.zimuku} target="_blank" rel="noreferrer" className="gap-2">
                  Search on Zimuku
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
            )}
            {searchLinks && (
              <Button type="button" variant="outline" asChild>
                <a href={searchLinks.subhd} target="_blank" rel="noreferrer" className="gap-2">
                  Search on SubHD
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function TvActionsPanel({
  selectedSeries,
  onOpenManager,
  onOpenSeasonBatch
}: {
  selectedSeries: TvSeriesSummary | null;
  onOpenManager: () => void;
  onOpenSeasonBatch: () => void;
}) {
  const [open, setOpen] = useState(false);
  const searchLinks = useMemo(() => {
    if (!selectedSeries?.title) {
      return null;
    }
    return buildSubtitleSearchLinksByKeyword(selectedSeries.title);
  }, [selectedSeries?.title]);

  return (
    <Card className="border bg-card">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Selected TV Series</p>
          <p className="truncate text-sm font-semibold">{selectedSeries?.title || "Please select a series from the list"}</p>
        </div>
        <Button type="button" onClick={() => setOpen(true)} disabled={!selectedSeries}>
          Actions
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>TV Actions</DialogTitle>
            <DialogDescription>
              {selectedSeries ? selectedSeries.title : "Select a TV series first."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenManager();
                setOpen(false);
              }}
              disabled={!selectedSeries}
            >
              Open TV Subtitle Management
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenSeasonBatch();
                setOpen(false);
              }}
              disabled={!selectedSeries}
            >
              TV Season Batch Upload
            </Button>
            {searchLinks && (
              <Button type="button" variant="outline" asChild>
                <a href={searchLinks.zimuku} target="_blank" rel="noreferrer" className="gap-2">
                  Search on Zimuku
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
            )}
            {searchLinks && (
              <Button type="button" variant="outline" asChild>
                <a href={searchLinks.subhd} target="_blank" rel="noreferrer" className="gap-2">
                  Search on SubHD
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

interface TvSeriesListPanelProps {
  query: string;
  onQueryChange: (value: string) => void;
  rows: TvSeriesSummary[];
  selectedSeriesPath: string;
  onSelectSeries: (path: string) => void;
  formatTime: (value: string | undefined | null) => string;
}

function TvSeriesListPanel({
  query,
  onQueryChange,
  rows,
  selectedSeriesPath,
  onSelectSeries,
  formatTime
}: TvSeriesListPanelProps) {
  return (
    <Card className="flex h-full flex-col border bg-card">
      <CardHeader className="space-y-3 p-4">
        <CardTitle className="text-lg">TV Series List</CardTitle>
        <Input
          value={query}
          aria-label="Filter TV series by name or path"
          placeholder="Filter by series title/path"
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-4 pt-0">
        <ScrollArea className="min-h-0 flex-1 rounded-md border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead className="w-[130px]">Latest Year</TableHead>
                <TableHead className="w-[170px]">Updated Time</TableHead>
                <TableHead className="w-[110px] text-right">Videos</TableHead>
                <TableHead className="w-[140px] text-right">No Subtitles</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const active = row.path === selectedSeriesPath;
                return (
                  <TableRow
                    key={row.key}
                    className={cn("cursor-pointer", active ? "bg-primary/10" : "hover:bg-accent")}
                    onClick={() => onSelectSeries(row.path)}
                    aria-selected={active}
                  >
                    <TableCell className="max-w-[280px] truncate font-medium" title={row.title}>
                      {row.title || "-"}
                    </TableCell>
                    <TableCell>{row.latestEpisodeYear || "-"}</TableCell>
                    <TableCell>{formatTime(row.updatedAt)}</TableCell>
                    <TableCell className="text-right">{row.videoCount}</TableCell>
                    <TableCell className="text-right">{row.noSubtitleCount}</TableCell>
                  </TableRow>
                );
              })}

              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    No TV series found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

interface TvSeasonBatchUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  onLoadBatchCandidates: () => Promise<Video[]>;
  onUploadBatch: (items: BatchSubtitleUploadItem[]) => Promise<BatchSubtitleUploadResult>;
}

function TvSeasonBatchUploadDialog({
  open,
  onOpenChange,
  busy,
  onLoadBatchCandidates,
  onUploadBatch
}: TvSeasonBatchUploadDialogProps) {
  const batchInputRef = useRef<HTMLInputElement | null>(null);
  const [batchPreparing, setBatchPreparing] = useState(false);
  const [batchZipFileName, setBatchZipFileName] = useState("");
  const [batchRows, setBatchRows] = useState<SeasonBatchMappingRow[]>([]);
  const [batchCandidates, setBatchCandidates] = useState<Video[]>([]);
  const [batchLabel, setBatchLabel] = useState("zh");
  const [batchError, setBatchError] = useState("");
  const [batchResult, setBatchResult] = useState<BatchSubtitleUploadResult | null>(null);

  function resetBatchState() {
    setBatchPreparing(false);
    setBatchZipFileName("");
    setBatchRows([]);
    setBatchCandidates([]);
    setBatchLabel("zh");
    setBatchError("");
    setBatchResult(null);
  }

  useEffect(() => {
    if (!open) {
      resetBatchState();
    }
  }, [open]);

  async function onBatchZipSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) {
      return;
    }

    if (!isZipFileName(file.name)) {
      setBatchError("Season batch upload only accepts .zip files.");
      return;
    }

    setBatchPreparing(true);
    setBatchError("");
    setBatchResult(null);

    try {
      const candidates = await onLoadBatchCandidates();
      if (candidates.length === 0) {
        setBatchError("No TV episodes available in selected series.");
        return;
      }

      const entries = await extractSubtitleEntriesFromZip(file);
      if (entries.length === 0) {
        setBatchError("No subtitle files found inside the ZIP archive.");
        return;
      }

      const rows = buildSeasonBatchRows(candidates, entries);
      setBatchZipFileName(file.name);
      setBatchCandidates(candidates);
      setBatchRows(rows);
    } catch (error) {
      const errText = error instanceof Error ? error.message : String(error);
      setBatchError(`Parse ZIP failed: ${errText}`);
    } finally {
      setBatchPreparing(false);
    }
  }

  async function submitSeasonBatch() {
    if (batchRows.length === 0 || batchCandidates.length === 0) {
      return;
    }

    const map = new Map(batchCandidates.map((video) => [video.id, video]));
    const label = batchLabel.trim();
    const items: BatchSubtitleUploadItem[] = [];
    for (const row of batchRows) {
      if (!row.selectedVideoId) {
        continue;
      }
      const matchedVideo = map.get(row.selectedVideoId);
      if (!matchedVideo) {
        continue;
      }
      items.push({
        video: matchedVideo,
        file: toSubtitleFile(row.entry),
        label,
        sourceName: row.entry.path
      });
    }

    if (items.length === 0) {
      setBatchError("Please map at least one subtitle file to an episode.");
      return;
    }

    setBatchError("");
    const result = await onUploadBatch(items);
    setBatchResult(result);
  }

  const autoMatchedCount = batchRows.filter((row) => row.autoVideoId !== "").length;
  const mappedCount = batchRows.filter((row) => row.selectedVideoId !== "").length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[86vh] flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>TV Season Batch Upload</DialogTitle>
          <DialogDescription>
            ZIP: {batchZipFileName || "-"} | Auto matched: {autoMatchedCount}/{batchRows.length} | Selected: {mappedCount}
          </DialogDescription>
        </DialogHeader>

        <input
          ref={batchInputRef}
          type="file"
          accept=".zip"
          className="hidden"
          onChange={(event) => {
            void onBatchZipSelected(event);
          }}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy || batchPreparing}
            onClick={() => batchInputRef.current?.click()}
          >
            Select ZIP File
          </Button>
          <span className="text-xs text-muted-foreground">
            Match rules use SxxEyy / x / Season Episode patterns.
          </span>
          {batchError && <p className="text-xs text-rose-600">{batchError}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Label</span>
          <Input
            className="w-[140px]"
            value={batchLabel}
            maxLength={32}
            placeholder="zh"
            onChange={(event) => setBatchLabel(event.target.value)}
          />
          <span className="text-xs text-muted-foreground">
            Saved as media-name[.label].ext. Leave empty for default naming.
          </span>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold">ZIP Subtitle Mapping</p>
          <div className="max-h-[52vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subtitle File</TableHead>
                  <TableHead className="w-[120px]">Parsed</TableHead>
                  <TableHead>Target Episode</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batchRows.map((row) => {
                  const candidates = candidateVideosForBatchRow(row, batchCandidates);
                  const selectValue = row.selectedVideoId || "__UNASSIGNED__";
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="break-all text-xs">{row.entry.path}</TableCell>
                      <TableCell className="text-xs">{formatSeasonEpisodeText(row.season, row.episode)}</TableCell>
                      <TableCell>
                        <Select
                          value={selectValue}
                          onValueChange={(value) => {
                            setBatchRows((prev) =>
                              prev.map((item) =>
                                item.id === row.id
                                  ? {
                                      ...item,
                                      selectedVideoId: value === "__UNASSIGNED__" ? "" : value
                                    }
                                  : item
                              )
                            );
                          }}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="Choose episode" />
                          </SelectTrigger>
                          <SelectContent className="max-h-72">
                            <SelectItem value="__UNASSIGNED__">Skip</SelectItem>
                            {candidates.map((video) => (
                              <SelectItem key={`${row.id}-${video.id}`} value={video.id}>
                                {video.fileName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  );
                })}

                {batchRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                      Select a ZIP file to start mapping.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        {batchResult && (
          <div className="rounded-md border bg-muted/30 p-3 text-xs">
            <p>
              Result: {batchResult.success}/{batchResult.total} succeeded, {batchResult.failed} failed.
            </p>
            {batchResult.errors.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {batchResult.errors.slice(0, 8).map((item) => (
                  <li key={item} className="break-all">
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button type="button" disabled={busy || batchPreparing || batchRows.length === 0} onClick={() => void submitSeasonBatch()}>
            Upload Mapped Subtitles
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface TvSubtitleManagementPanelProps {
  selectedSeries: TvSeriesSummary | null;
  selectedSeason: string;
  seasonOptions: TvSeasonOption[];
  videos: Video[];
  selectedVideo: Video | null;
  selectedVideoId: string;
  onSelectVideo: (video: Video) => void;
  onSeasonChange: (value: string) => void;
  onUpload: (video: Video, file: File, label: string) => Promise<void>;
  onReplace: (video: Video, subtitle: Subtitle, file: File) => Promise<void>;
  onRemove: (video: Video, subtitle: Subtitle) => Promise<void>;
  formatTime: (value: string | undefined | null) => string;
  busy: boolean;
}

function TvSubtitleManagementPanel({
  selectedSeries,
  selectedSeason,
  seasonOptions,
  videos,
  selectedVideo,
  selectedVideoId,
  onSelectVideo,
  onSeasonChange,
  onUpload,
  onReplace,
  onRemove,
  formatTime,
  busy
}: TvSubtitleManagementPanelProps) {
  const selectedSeasonLabel = seasonOptions.find((option) => option.value === selectedSeason)?.label || "All Seasons";
  const searchKeyword = useMemo(() => {
    if (!selectedVideo) {
      return "";
    }
    const parsed = parseVideoSeasonEpisode(selectedVideo);
    const series = (selectedSeries?.title || selectedVideo.title || "").trim();
    const episodeCode = parsed ? formatSeasonEpisodeText(parsed.season, parsed.episode) : "";
    return `${series} ${episodeCode}`.trim();
  }, [selectedSeries?.title, selectedVideo]);

  return (
    <div className="grid h-full min-h-0 gap-3 p-3 md:grid-cols-[340px_minmax(0,1fr)] md:p-4">
      <Card className="flex min-h-0 flex-col border bg-card">
        <CardHeader className="space-y-3 p-4">
          <CardTitle className="text-lg">Episodes</CardTitle>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Series</p>
            <p className="truncate text-sm font-semibold">{selectedSeries?.title || "-"}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Season</p>
            <Select value={selectedSeason} onValueChange={onSeasonChange} disabled={!selectedSeries}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select season" />
              </SelectTrigger>
              <SelectContent>
                {seasonOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent className="min-h-0 flex-1 p-4 pt-0">
          <ScrollArea className="h-full rounded-md border bg-background">
            <ul className="space-y-2 p-2">
              {videos.map((video) => {
                const active = selectedVideoId === video.id;
                const parsed = parseVideoSeasonEpisode(video);
                const episodeCode = parsed ? formatSeasonEpisodeText(parsed.season, parsed.episode) : "-";
                return (
                  <li key={video.id}>
                    <button
                      type="button"
                      onClick={() => onSelectVideo(video)}
                      className={cn(
                        "w-full rounded-md border px-3 py-2 text-left transition-colors",
                        active
                          ? "border-primary/70 bg-primary/10"
                          : "border bg-background hover:bg-accent"
                      )}
                      aria-pressed={active}
                    >
                      <div className="text-xs font-semibold text-muted-foreground">{episodeCode}</div>
                      <div className="truncate text-sm font-semibold">{video.title || "-"}</div>
                      <div className="text-xs text-muted-foreground">Subtitles: {video.subtitles.length}</div>
                    </button>
                  </li>
                );
              })}

              {videos.length === 0 && (
                <li className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No episodes in {selectedSeasonLabel}.
                </li>
              )}
            </ul>
          </ScrollArea>
        </CardContent>
      </Card>

      <div className="min-h-0">
        <SubtitleDetailsPanel
          panelTitle="TV Subtitle Management"
          selectedVideo={selectedVideo}
          emptyText="Select an episode from the list."
          showBack={false}
          onBack={() => {}}
          infoRows={[
            { label: "Series", value: selectedSeries?.title || "-" }
          ]}
          onUpload={onUpload}
          onReplace={onReplace}
          onRemove={onRemove}
          formatTime={formatTime}
          busy={busy}
          showSearchLinks={true}
          searchKeyword={searchKeyword}
          showMediaType={false}
          showMetadata={false}
        />
      </div>
    </div>
  );
}

interface SubtitleDetailsPanelProps {
  panelTitle: string;
  selectedVideo: Video | null;
  emptyText: string;
  showBack: boolean;
  onBack: () => void;
  infoRows: Array<{ label: string; value: string }>;
  onUpload: (video: Video, file: File, label: string) => Promise<void>;
  onReplace: (video: Video, subtitle: Subtitle, file: File) => Promise<void>;
  onRemove: (video: Video, subtitle: Subtitle) => Promise<void>;
  formatTime: (value: string | undefined | null) => string;
  busy: boolean;
  showSearchLinks: boolean;
  searchKeyword?: string;
  showMediaType?: boolean;
  showMetadata?: boolean;
}

function SubtitleDetailsPanel({
  panelTitle,
  selectedVideo,
  emptyText,
  showBack,
  onBack,
  infoRows,
  onUpload,
  onReplace,
  onRemove,
  formatTime,
  busy,
  showSearchLinks,
  searchKeyword,
  showMediaType = true,
  showMetadata = true
}: SubtitleDetailsPanelProps) {
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<Record<string, HTMLInputElement | null>>({});

  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [uploadLabel, setUploadLabel] = useState("zh");
  const [zipPickDialogOpen, setZipPickDialogOpen] = useState(false);
  const [zipPickMode, setZipPickMode] = useState<"upload" | "replace">("upload");
  const [zipPickFileName, setZipPickFileName] = useState("");
  const [zipPickEntries, setZipPickEntries] = useState<ZipSubtitleEntry[]>([]);
  const [zipPickTargetSubtitle, setZipPickTargetSubtitle] = useState<Subtitle | null>(null);
  const [zipUploadLabel, setZipUploadLabel] = useState("zh");
  const [zipPickError, setZipPickError] = useState("");
  const [zipLoading, setZipLoading] = useState(false);

  const searchLinks = useMemo(() => {
    if (searchKeyword && searchKeyword.trim()) {
      return buildSubtitleSearchLinksByKeyword(searchKeyword);
    }
    if (!selectedVideo) {
      return null;
    }
    return buildSubtitleSearchLinks(selectedVideo);
  }, [searchKeyword, selectedVideo]);

  function resetZipPickState() {
    setZipPickDialogOpen(false);
    setZipPickMode("upload");
    setZipPickFileName("");
    setZipPickEntries([]);
    setZipPickTargetSubtitle(null);
    setZipUploadLabel("zh");
    setZipPickError("");
    setZipLoading(false);
  }

  function resetUploadState() {
    setUploadDialogOpen(false);
    setPendingUploadFile(null);
    setUploadLabel("zh");
  }

  useEffect(() => {
    resetUploadState();
    resetZipPickState();
  }, [selectedVideo?.id]);

  function openUploadPicker() {
    uploadInputRef.current?.click();
  }

  async function openZipPicker(file: File, mode: "upload" | "replace", targetSubtitle: Subtitle | null) {
    setZipLoading(true);
    setZipPickError("");

    try {
      const entries = await extractSubtitleEntriesFromZip(file);
      if (entries.length === 0) {
        setZipPickError("No subtitle files found in the ZIP archive.");
        return;
      }
      setZipPickMode(mode);
      setZipPickTargetSubtitle(targetSubtitle);
      if (mode === "upload") {
        setZipUploadLabel(uploadLabel.trim() || "zh");
      }
      setZipPickFileName(file.name);
      setZipPickEntries(entries);
      setZipPickDialogOpen(true);
    } catch (error) {
      const errText = error instanceof Error ? error.message : String(error);
      setZipPickError(`Parse ZIP failed: ${errText}`);
    } finally {
      setZipLoading(false);
    }
  }

  function onUploadFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    if (isZipFileName(file.name)) {
      void openZipPicker(file, "upload", null);
      return;
    }
    if (!isSubtitleFileName(file.name)) {
      setZipPickError("Unsupported file type. Please select subtitle files or ZIP.");
      return;
    }
    setPendingUploadFile(file);
    setUploadDialogOpen(true);
  }

  async function confirmUpload() {
    if (!selectedVideo || !pendingUploadFile) return;
    await onUpload(selectedVideo, pendingUploadFile, uploadLabel.trim());
    resetUploadState();
  }

  async function onReplaceFilePicked(subtitle: Subtitle, event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file || !selectedVideo) return;
    if (isZipFileName(file.name)) {
      await openZipPicker(file, "replace", subtitle);
      return;
    }
    if (!isSubtitleFileName(file.name)) {
      setZipPickError("Unsupported file type. Please select subtitle files or ZIP.");
      return;
    }
    await onReplace(selectedVideo, subtitle, file);
  }

  async function onZipEntryPicked(entry: ZipSubtitleEntry) {
    if (!selectedVideo) {
      return;
    }

    const selectedFile = toSubtitleFile(entry);
    if (zipPickMode === "upload") {
      await onUpload(selectedVideo, selectedFile, zipUploadLabel.trim());
      resetZipPickState();
      return;
    }

    if (!zipPickTargetSubtitle) {
      setZipPickError("Missing target subtitle for replace.");
      return;
    }

    await onReplace(selectedVideo, zipPickTargetSubtitle, selectedFile);
    resetZipPickState();
  }

  return (
    <Card className="flex h-full flex-col border bg-card">
      <CardHeader className="p-4">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg">{panelTitle}</CardTitle>
          {showBack && (
            <Button type="button" variant="outline" size="sm" className="gap-1" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />
              Back to list
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-4 p-4 pt-0">
        {!selectedVideo ? (
          <div className="flex flex-1 items-center justify-center rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
            {emptyText}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="grid gap-2 text-sm md:grid-cols-2">
              <InfoItem label="Title" value={selectedVideo.title || "-"} />
              <InfoItem label="Year" value={selectedVideo.year || "-"} />
              {showMediaType && <InfoItem label="Media Type" value={selectedVideo.mediaType || "-"} />}
              {showMetadata && <InfoItem label="Metadata" value={selectedVideo.metadataSource || "-"} />}
              {infoRows.map((item) => (
                <InfoItem key={item.label} label={item.label} value={item.value || "-"} />
              ))}
              <InfoItem label="Path" value={selectedVideo.path || "-"} />
              <InfoItem label="Updated" value={formatTime(selectedVideo.updatedAt)} />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={uploadInputRef}
                type="file"
                accept=".srt,.ass,.ssa,.vtt,.sub,.zip"
                className="hidden"
                onChange={onUploadFileChange}
              />
              <Button type="button" onClick={openUploadPicker} disabled={busy || zipLoading}>
                Upload Subtitle / ZIP
              </Button>
              {showSearchLinks && searchLinks && (
                <>
                  <Button type="button" variant="outline" asChild>
                    <a href={searchLinks.zimuku} target="_blank" rel="noreferrer" className="gap-1">
                      Zimuku
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </Button>
                  <Button type="button" variant="outline" asChild>
                    <a href={searchLinks.subhd} target="_blank" rel="noreferrer" className="gap-1">
                      SubHD
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </Button>
                </>
              )}
              {zipLoading && <span className="text-xs text-muted-foreground">Parsing ZIP...</span>}
              {zipPickError && <span className="text-xs text-rose-600">{zipPickError}</span>}
            </div>

            <div className="min-h-0 flex-1 rounded-md border">
              <ScrollArea className="h-full max-h-[48vh] xl:max-h-full">
                <Table>
                  <TableCaption>Subtitle list for selected video.</TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Lang</TableHead>
                      <TableHead>Format</TableHead>
                      <TableHead>Modified</TableHead>
                      <TableHead className="w-[180px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedVideo.subtitles.map((subtitle) => (
                      <TableRow key={subtitle.id}>
                        <TableCell className="break-all">{subtitle.fileName}</TableCell>
                        <TableCell>{subtitle.language || "-"}</TableCell>
                        <TableCell>{subtitle.format || "-"}</TableCell>
                        <TableCell>{formatTime(subtitle.modTime)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            <input
                              ref={(node) => {
                                replaceInputRef.current[subtitle.id] = node;
                              }}
                              type="file"
                              accept=".srt,.ass,.ssa,.vtt,.sub,.zip"
                              className="hidden"
                              onChange={(event) => {
                                void onReplaceFilePicked(subtitle, event);
                              }}
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => replaceInputRef.current[subtitle.id]?.click()}
                              disabled={busy}
                            >
                              Replace
                            </Button>

                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button type="button" size="sm" variant="destructive" className="gap-1" disabled={busy}>
                                  <Trash2 className="h-4 w-4" />
                                  Delete
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete subtitle?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    &quot;{subtitle.fileName}&quot; will be deleted permanently.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => {
                                      if (!selectedVideo) return;
                                      void onRemove(selectedVideo, subtitle);
                                    }}
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}

                    {selectedVideo.subtitles.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                          No subtitles found.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          </div>
        )}
      </CardContent>

      <Dialog
        open={uploadDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            resetUploadState();
            return;
          }
          setUploadDialogOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload subtitle label</DialogTitle>
            <DialogDescription>
              {pendingUploadFile ? `File: ${pendingUploadFile.name}` : "Choose subtitle language/label before upload."}
            </DialogDescription>
          </DialogHeader>

          <Input
            value={uploadLabel}
            maxLength={32}
            placeholder="zh"
            onChange={(event) => setUploadLabel(event.target.value)}
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={resetUploadState}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void confirmUpload()}
              disabled={!pendingUploadFile || !selectedVideo || busy}
            >
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={zipPickDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            resetZipPickState();
            return;
          }
          setZipPickDialogOpen(true);
        }}
      >
        <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Select Subtitle From ZIP</DialogTitle>
            <DialogDescription>
              ZIP: {zipPickFileName || "-"} | {zipPickEntries.length} subtitle files found.
            </DialogDescription>
          </DialogHeader>

          {zipPickMode === "upload" && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">Upload Subtitle Label</p>
              <Input
                value={zipUploadLabel}
                maxLength={32}
                placeholder="zh"
                onChange={(event) => setZipUploadLabel(event.target.value)}
              />
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm font-semibold">ZIP Subtitle Files</p>
            <div className="max-h-[55vh] overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>File Path</TableHead>
                      <TableHead className="w-[100px] text-right">Size</TableHead>
                      <TableHead className="w-[120px]">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {zipPickEntries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="break-all text-xs">{entry.path}</TableCell>
                        <TableCell className="text-right text-xs">{Math.max(1, Math.round(entry.size / 1024))} KB</TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void onZipEntryPicked(entry)}
                          >
                            Use This File
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}

                    {zipPickEntries.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                          No subtitle entries.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={resetZipPickState}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl border bg-background p-3 shadow-sm dark:border-slate-800 dark:bg-[linear-gradient(145deg,rgba(8,14,31,0.96),rgba(6,11,24,0.86))]">
      <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-cyan-400/80 via-blue-500/70 to-indigo-500/70 dark:opacity-100" />
      <p className="pl-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="break-all pl-2 text-sm font-semibold">{value}</p>
    </div>
  );
}

interface QuickStatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  tone: "emerald" | "blue" | "amber" | "rose";
}

function QuickStatCard({ icon, label, value, hint, tone }: QuickStatCardProps) {
  const toneClass: Record<QuickStatCardProps["tone"], { iconBg: string; iconText: string; hintText: string }> = {
    emerald: {
      iconBg: "bg-emerald-500/15 dark:bg-emerald-500/20",
      iconText: "text-emerald-500 dark:text-emerald-400",
      hintText: "text-emerald-600 dark:text-emerald-400"
    },
    blue: {
      iconBg: "bg-blue-500/15 dark:bg-blue-500/20",
      iconText: "text-blue-600 dark:text-blue-400",
      hintText: "text-blue-600 dark:text-blue-400"
    },
    amber: {
      iconBg: "bg-amber-500/15 dark:bg-amber-500/20",
      iconText: "text-amber-600 dark:text-amber-400",
      hintText: "text-amber-600 dark:text-amber-400"
    },
    rose: {
      iconBg: "bg-rose-500/15 dark:bg-rose-500/20",
      iconText: "text-rose-600 dark:text-rose-400",
      hintText: "text-rose-600 dark:text-rose-400"
    }
  };

  const style = toneClass[tone];

  return (
    <Card className="border bg-card dark:border-slate-800 dark:bg-[radial-gradient(120%_150%_at_5%_0%,rgba(24,44,86,0.45),rgba(6,11,25,0.94)_68%)]">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-3">
          <span className={cn("inline-flex h-8 w-8 items-center justify-center rounded-lg", style.iconBg, style.iconText)}>
            {icon}
          </span>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
        <p className="text-4xl font-bold tracking-tight">{value}</p>
        <p className={cn("text-xs font-medium", style.hintText)}>{hint}</p>
      </CardContent>
    </Card>
  );
}

function PagerView({ pager, onSetPage }: { pager: Pager; onSetPage: (page: number) => void }) {
  const totalPages = Math.max(1, pager.totalPages);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Button type="button" variant="outline" size="sm" disabled={pager.page <= 1} onClick={() => onSetPage(pager.page - 1)}>
        Prev
      </Button>
      <span className="text-xs text-muted-foreground">
        Page {pager.page} / {totalPages} ({pager.total})
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pager.page >= totalPages}
        onClick={() => onSetPage(pager.page + 1)}
      >
        Next
      </Button>
    </div>
  );
}

function LogsPanel({ logs, formatTime }: { logs: OperationLog[]; formatTime: (value: string | undefined | null) => string }) {
  return (
    <Card className="flex h-[calc(100vh-220px)] flex-col border bg-card">
      <CardHeader className="flex flex-row items-center justify-between p-4">
        <CardTitle className="text-lg">Operation Logs</CardTitle>
        <Badge variant="secondary">Recent {logs.length} records</Badge>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 p-4 pt-0">
        <ScrollArea className="min-h-0 flex-1 rounded-md border bg-background">
          <ul className="divide-y divide-border">
            {logs.map((log) => (
              <li key={log.id} className="space-y-1 p-3 text-sm">
                <p className="text-xs text-muted-foreground">{formatTime(log.timestamp)}</p>
                <p className="font-semibold">{log.action}</p>
                <p className="break-all text-xs text-muted-foreground">{log.targetPath || "-"}</p>
                <p className="text-xs text-muted-foreground">videoId: {log.videoId} | status: {log.status}</p>
              </li>
            ))}

            {logs.length === 0 && (
              <li className="p-8 text-center text-sm text-muted-foreground">No operation logs yet.</li>
            )}
          </ul>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

