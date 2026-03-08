"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
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
  DirectoryScanResult,
  OperationLog,
  Pager,
  ScanStatus,
  Subtitle,
  Video,
  VisibleTreeNode
} from "@/lib/types";
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

export function SubtitleManagerApp() {
  const {
    activeTab,
    movieQuery,
    tvQuery,
    movieVideos,
    sortedTvVideos,
    selectedVideoIdByType,
    selectedVideo,
    moviePager,
    tvPager,
    tvVisibleNodes,
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
    toggleTvNode,
    isTvExpanded,
    setMoviePage,
    setTvPage,
    uploadSubtitle,
    replaceSubtitle,
    removeSubtitle,
    setMovieQuery,
    setTvQuery,
    formatTime
  } = useSubtitleManager();

  const isMobile = useIsMobile(960);
  const [movieMobileView, setMovieMobileView] = useState<MobileView>("list");
  const [tvMobileView, setTvMobileView] = useState<MobileView>("list");

  const refreshText = useMemo(() => {
    if (activeTab === "dashboard") return "Refresh Dashboard";
    if (activeTab === "logs") return "Refresh Logs";
    return "Refresh";
  }, [activeTab]);

  useEffect(() => {
    if (!isMobile) {
      setMovieMobileView("list");
      setTvMobileView("list");
      return;
    }

    if (activeTab === "movie") {
      setMovieMobileView("list");
    }

    if (activeTab === "tv") {
      setTvMobileView("list");
    }
  }, [activeTab, isMobile]);

  function handleMovieSelect(video: Video) {
    selectMovieVideo(video);
    if (isMobile) {
      setMovieMobileView("details");
    }
  }

  function handleTvSelect(video: Video) {
    selectTvVideo(video);
    if (isMobile) {
      setTvMobileView("details");
    }
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
          {isMobile && (
            <MobileViewSwitch
              listLabel="Movie List"
              detailsLabel="Subtitle Details"
              activeView={movieMobileView}
              detailsDisabled={!selectedVideoIdByType.movie}
              onShowList={() => setMovieMobileView("list")}
              onShowDetails={() => {
                if (selectedVideoIdByType.movie) {
                  setMovieMobileView("details");
                }
              }}
            />
          )}

          <div className="grid gap-3 xl:grid-cols-[360px_minmax(0,1fr)]">
            {(!isMobile || movieMobileView === "list") && (
              <MovieListPanel
                query={movieQuery}
                onQueryChange={setMovieQuery}
                videos={movieVideos}
                selectedVideoId={selectedVideoIdByType.movie}
                pager={moviePager}
                onSelectVideo={handleMovieSelect}
                onSetPage={setMoviePage}
              />
            )}

            {(!isMobile || movieMobileView === "details") && (
              <SubtitleDetailsPanel
                panelTitle="Movie Subtitle Management"
                selectedVideo={selectedVideo}
                emptyText="Select a movie from the list."
                showBack={isMobile && movieMobileView === "details"}
                onBack={() => setMovieMobileView("list")}
                infoRows={[]}
                onUpload={uploadSubtitle}
                onReplace={replaceSubtitle}
                onRemove={removeSubtitle}
                formatTime={formatTime}
                busy={loading}
              />
            )}
          </div>
        </TabsContent>

        <TabsContent value="tv" className="space-y-3">
          {isMobile && (
            <MobileViewSwitch
              listLabel="TV List"
              detailsLabel="Subtitle Details"
              activeView={tvMobileView}
              detailsDisabled={!selectedVideoIdByType.tv}
              onShowList={() => setTvMobileView("list")}
              onShowDetails={() => {
                if (selectedVideoIdByType.tv) {
                  setTvMobileView("details");
                }
              }}
            />
          )}

          <div className="grid gap-3 xl:grid-cols-[360px_minmax(0,1fr)]">
            {(!isMobile || tvMobileView === "list") && (
              <TvListPanel
                query={tvQuery}
                onQueryChange={setTvQuery}
                treeNodes={tvVisibleNodes}
                selectedDir={selectedTvDirPath}
                tvVideos={sortedTvVideos}
                selectedVideoId={selectedVideoIdByType.tv}
                pager={tvPager}
                onToggleNode={toggleTvNode}
                onSelectDirectory={(path) => void selectTvDirectory(path)}
                onSelectVideo={handleTvSelect}
                onSetPage={setTvPage}
                isExpanded={isTvExpanded}
              />
            )}

            {(!isMobile || tvMobileView === "details") && (
              <SubtitleDetailsPanel
                panelTitle="TV Subtitle Management"
                selectedVideo={selectedVideo}
                emptyText="Select a TV video from the tree view."
                showBack={isMobile && tvMobileView === "details"}
                onBack={() => setTvMobileView("list")}
                infoRows={[
                  {
                    label: "Directory",
                    value: selectedTvDirPath || "-"
                  }
                ]}
                onUpload={uploadSubtitle}
                onReplace={replaceSubtitle}
                onRemove={removeSubtitle}
                formatTime={formatTime}
                busy={loading}
              />
            )}
          </div>
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

interface MobileViewSwitchProps {
  listLabel: string;
  detailsLabel: string;
  activeView: MobileView;
  detailsDisabled: boolean;
  onShowList: () => void;
  onShowDetails: () => void;
}

function MobileViewSwitch({
  listLabel,
  detailsLabel,
  activeView,
  detailsDisabled,
  onShowList,
  onShowDetails
}: MobileViewSwitchProps) {
  return (
    <Card className="border bg-card p-2">
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant={activeView === "list" ? "default" : "outline"}
          className="h-9"
          onClick={onShowList}
        >
          {listLabel}
        </Button>
        <Button
          type="button"
          variant={activeView === "details" ? "default" : "outline"}
          className="h-9"
          onClick={onShowDetails}
          disabled={detailsDisabled}
        >
          {detailsLabel}
        </Button>
      </div>
    </Card>
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
}

function MovieListPanel({
  query,
  onQueryChange,
  videos,
  selectedVideoId,
  pager,
  onSelectVideo,
  onSetPage
}: MovieListPanelProps) {
  return (
    <Card className="border bg-card">
      <CardHeader className="space-y-3 p-4">
        <CardTitle className="text-lg">Movies</CardTitle>
        <Input
          value={query}
          aria-label="Filter movies by title or path"
          placeholder="Filter by title/path"
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </CardHeader>

      <CardContent className="space-y-3 p-4 pt-0">
        <ScrollArea className="h-[360px] rounded-md border bg-background">
          <ul className="space-y-2 p-2">
            {videos.map((video) => {
              const active = selectedVideoId === video.id;
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
                    <div className="truncate text-sm font-semibold">{video.title}</div>
                    <div className="truncate text-xs text-muted-foreground">{video.fileName}</div>
                    <div className="text-xs text-muted-foreground">Subtitles: {video.subtitles.length}</div>
                  </button>
                </li>
              );
            })}

            {videos.length === 0 && (
              <li className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                No movies found.
              </li>
            )}
          </ul>
        </ScrollArea>

        <PagerView pager={pager} onSetPage={onSetPage} />
      </CardContent>
    </Card>
  );
}

interface TvListPanelProps {
  query: string;
  onQueryChange: (value: string) => void;
  treeNodes: VisibleTreeNode[];
  selectedDir: string;
  tvVideos: Video[];
  selectedVideoId: string;
  pager: Pager;
  onToggleNode: (node: VisibleTreeNode) => void;
  onSelectDirectory: (path: string) => void;
  onSelectVideo: (video: Video) => void;
  onSetPage: (page: number) => void;
  isExpanded: (path: string) => boolean;
}

function TvListPanel({
  query,
  onQueryChange,
  treeNodes,
  selectedDir,
  tvVideos,
  selectedVideoId,
  pager,
  onToggleNode,
  onSelectDirectory,
  onSelectVideo,
  onSetPage,
  isExpanded
}: TvListPanelProps) {
  return (
    <Card className="border bg-card">
      <CardHeader className="space-y-3 p-4">
        <CardTitle className="text-lg">TV Directory Tree</CardTitle>
        <Input
          value={query}
          aria-label="Filter TV videos in selected directory"
          placeholder="Filter videos in selected directory"
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </CardHeader>

      <CardContent className="space-y-3 p-4 pt-0">
        <ScrollArea className="h-[220px] rounded-md border bg-background">
          <ul className="space-y-1 p-2" aria-label="TV directory tree">
            {treeNodes.map((node, index) => {
              const active = selectedDir === node.path;
              return (
                <li key={`${node.path || "root"}-${index}`}>
                  <div
                    className={cn(
                      "flex items-center gap-1 rounded-md py-1 pr-2",
                      active ? "bg-primary/10" : "hover:bg-accent"
                    )}
                    style={{ paddingLeft: `${node.depth * 14 + 6}px` }}
                  >
                    <button
                      type="button"
                      className="flex h-6 w-6 items-center justify-center rounded border border bg-background disabled:opacity-50"
                      disabled={!node.hasChildren}
                      onClick={() => onToggleNode(node)}
                      aria-label={node.hasChildren ? "Toggle directory" : "Directory leaf"}
                    >
                      {node.hasChildren ? (
                        isExpanded(node.path) || node.depth === 0 ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground">.</span>
                      )}
                    </button>

                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-sm"
                      onClick={() => onSelectDirectory(node.path)}
                    >
                      {node.label}
                    </button>

                    {(node.videoCount > 0 || node.metadataCount > 0) && (
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        V{node.videoCount} / N{node.metadataCount}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}

            {treeNodes.length === 0 && (
              <li className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                No TV directories found.
              </li>
            )}
          </ul>
        </ScrollArea>

        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Videos In Selected Directory</p>

        <ScrollArea className="h-[220px] rounded-md border bg-background">
          <ul className="space-y-2 p-2">
            {tvVideos.map((video) => {
              const active = selectedVideoId === video.id;
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
                    <div className="truncate text-sm font-semibold">{video.title}</div>
                    <div className="truncate text-xs text-muted-foreground">{video.fileName}</div>
                    <div className="text-xs text-muted-foreground">Subtitles: {video.subtitles.length}</div>
                  </button>
                </li>
              );
            })}

            {tvVideos.length === 0 && (
              <li className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                No TV videos in this directory.
              </li>
            )}
          </ul>
        </ScrollArea>

        <PagerView pager={pager} onSetPage={onSetPage} />
      </CardContent>
    </Card>
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
  busy
}: SubtitleDetailsPanelProps) {
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<Record<string, HTMLInputElement | null>>({});

  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [uploadLabel, setUploadLabel] = useState("zh");

  function resetUploadState() {
    setUploadDialogOpen(false);
    setPendingUploadFile(null);
    setUploadLabel("zh");
  }

  useEffect(() => {
    resetUploadState();
  }, [selectedVideo?.id]);

  function openUploadPicker() {
    uploadInputRef.current?.click();
  }

  function onUploadFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
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
    await onReplace(selectedVideo, subtitle, file);
  }

  return (
    <Card className="border bg-card">
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

      <CardContent className="space-y-4 p-4 pt-0">
        {!selectedVideo ? (
          <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
            {emptyText}
          </div>
        ) : (
          <>
            <div className="grid gap-2 text-sm md:grid-cols-2">
              <InfoItem label="Title" value={selectedVideo.title || "-"} />
              <InfoItem label="Year" value={selectedVideo.year || "-"} />
              <InfoItem label="Media Type" value={selectedVideo.mediaType || "-"} />
              <InfoItem label="Metadata" value={selectedVideo.metadataSource || "-"} />
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
                accept=".srt,.ass,.ssa,.vtt,.sub"
                className="hidden"
                onChange={onUploadFileChange}
              />
              <Button type="button" onClick={openUploadPicker} disabled={busy}>
                Upload Subtitle
              </Button>
            </div>

            <div className="rounded-md border">
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
                            accept=".srt,.ass,.ssa,.vtt,.sub"
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
                                  &quot;{subtitle.fileName}&quot; will be deleted and backed up on disk.
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
            </div>
          </>
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
    <Card className="border bg-card">
      <CardHeader className="flex flex-row items-center justify-between p-4">
        <CardTitle className="text-lg">Operation Logs</CardTitle>
        <Badge variant="secondary">Recent {logs.length} records</Badge>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <ScrollArea className="h-[560px] rounded-md border bg-background">
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

