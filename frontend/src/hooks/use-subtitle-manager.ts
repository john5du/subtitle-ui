"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ActiveTab,
  DirectoryScanResult,
  MediaType,
  OperationLog,
  Pager,
  ScanDirectory,
  ScanStatus,
  Subtitle,
  TreeNode,
  Video,
  VideoPage,
  VisibleTreeNode
} from "@/lib/types";

const DEFAULT_PAGE_SIZE = 30;

const EMPTY_DIRECTORY_SCAN: DirectoryScanResult = {
  generatedAt: "",
  movieRoot: "",
  tvRoot: "",
  movie: [],
  tv: [],
  errors: []
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeForCompare(pathValue: string | undefined | null) {
  return String(pathValue ?? "")
    .replace(/[\\/]+/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function basenamePath(pathValue: string | undefined | null) {
  const cleaned = String(pathValue ?? "").replace(/[\\/]+$/, "");
  const parts = cleaned.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0) return cleaned || "Root";
  return parts[parts.length - 1];
}

function joinPath(base: string, segment: string) {
  if (!base) return segment;
  const useBackslash = base.includes("\\");
  const separator = useBackslash ? "\\" : "/";
  if (base.endsWith("\\") || base.endsWith("/")) {
    return `${base}${segment}`;
  }
  return `${base}${separator}${segment}`;
}

function sortTree(node: TreeNode) {
  node.children.sort((a, b) => a.label.localeCompare(b.label));
  for (const child of node.children) {
    sortTree(child);
  }
}

function buildDirectoryTree(entries: ScanDirectory[], rootPath: string, fallbackLabel: string): TreeNode {
  const root: TreeNode = {
    path: rootPath || "",
    label: basenamePath(rootPath || "") || fallbackLabel,
    videoCount: 0,
    metadataCount: 0,
    children: []
  };

  const index = new Map<string, TreeNode>();
  index.set(root.path || "__ROOT__", root);

  const rootNorm = normalizeForCompare(rootPath);
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));

  for (const item of sorted) {
    const fullPath = item.path;
    const fullNorm = normalizeForCompare(fullPath);

    let relative = "";
    if (rootNorm && fullNorm.startsWith(rootNorm)) {
      relative = fullPath.slice(rootPath.length).replace(/^[\\/]+/, "");
    } else {
      relative = fullPath;
    }

    const segments = String(relative).split(/[\\/]+/).filter(Boolean);
    let current = root;
    let currentPath = root.path;

    if (segments.length === 0) {
      current.videoCount += item.videoFileCount || 0;
      current.metadataCount += item.metadataFileCount || 0;
      continue;
    }

    for (const segment of segments) {
      const childPath = joinPath(currentPath, segment);
      let child = index.get(childPath);
      if (!child) {
        child = {
          path: childPath,
          label: segment,
          videoCount: 0,
          metadataCount: 0,
          children: []
        };
        index.set(childPath, child);
        current.children.push(child);
      }
      current = child;
      currentPath = childPath;
    }

    current.videoCount += item.videoFileCount || 0;
    current.metadataCount += item.metadataFileCount || 0;
  }

  sortTree(root);
  return root;
}

function flattenTree(
  node: TreeNode,
  depth: number,
  out: VisibleTreeNode[],
  isExpanded: (path: string) => boolean
) {
  const expanded = depth === 0 ? true : isExpanded(node.path);
  out.push({
    path: node.path,
    label: depth === 0 ? node.label || "TV Root" : node.label,
    depth,
    hasChildren: node.children.length > 0,
    videoCount: node.videoCount || 0,
    metadataCount: node.metadataCount || 0,
    expanded
  });

  if (!expanded) return;

  for (const child of node.children) {
    flattenTree(child, depth + 1, out, isExpanded);
  }
}

function parseTvSeasonEpisode(video: Video) {
  const text = `${video.fileName ?? ""} ${video.title ?? ""}`;
  const patterns = [
    /\bs(\d{1,2})e(\d{1,3})\b/i,
    /\b(\d{1,2})x(\d{1,3})\b/i,
    /\bseason[\s._-]*(\d{1,2})[\s._-]*episode[\s._-]*(\d{1,3})\b/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return {
        season: Number.parseInt(match[1], 10),
        episode: Number.parseInt(match[2], 10)
      };
    }
  }

  const seasonOnly = text.match(/\bseason[\s._-]*(\d{1,2})\b/i) ?? text.match(/\bs(\d{1,2})\b/i);
  const episodeOnly = text.match(/\bepisode[\s._-]*(\d{1,3})\b/i) ?? text.match(/\be(\d{1,3})\b/i);

  return {
    season: seasonOnly ? Number.parseInt(seasonOnly[1], 10) : Number.MAX_SAFE_INTEGER,
    episode: episodeOnly ? Number.parseInt(episodeOnly[1], 10) : Number.MAX_SAFE_INTEGER
  };
}

function normalizePagedVideosResponse(payload: unknown, fallbackPage: number, fallbackPageSize: number): VideoPage {
  if (Array.isArray(payload)) {
    return {
      items: payload as Video[],
      total: payload.length,
      page: fallbackPage,
      pageSize: fallbackPageSize,
      totalPages: payload.length > 0 ? 1 : 0
    };
  }

  const body = isRecord(payload) ? payload : {};
  const items = Array.isArray(body.items) ? (body.items as Video[]) : [];
  const total = typeof body.total === "number" ? body.total : items.length;
  const page = typeof body.page === "number" ? body.page : fallbackPage;
  const pageSize = typeof body.pageSize === "number" ? body.pageSize : fallbackPageSize;
  const totalPages =
    typeof body.totalPages === "number"
      ? body.totalPages
      : total > 0
        ? Math.ceil(total / Math.max(1, pageSize))
        : 0;

  return { items, total, page, pageSize, totalPages };
}

function normalizeDirectoryScanResult(payload: unknown): DirectoryScanResult {
  const body = isRecord(payload) ? payload : {};
  return {
    generatedAt: typeof body.generatedAt === "string" ? body.generatedAt : "",
    movieRoot: typeof body.movieRoot === "string" ? body.movieRoot : "",
    tvRoot: typeof body.tvRoot === "string" ? body.tvRoot : "",
    movie: Array.isArray(body.movie) ? (body.movie as ScanDirectory[]) : [],
    tv: Array.isArray(body.tv) ? (body.tv as ScanDirectory[]) : [],
    errors: Array.isArray(body.errors) ? (body.errors.filter((item): item is string => typeof item === "string")) : []
  };
}

function normalizeScanStatus(payload: unknown): ScanStatus | null {
  if (!isRecord(payload)) return null;
  const videoCount = typeof payload.videoCount === "number" ? payload.videoCount : 0;
  return {
    running: Boolean(payload.running),
    lastStartedAt: typeof payload.lastStartedAt === "string" ? payload.lastStartedAt : undefined,
    lastFinishedAt: typeof payload.lastFinishedAt === "string" ? payload.lastFinishedAt : undefined,
    videoCount,
    error: typeof payload.error === "string" ? payload.error : undefined
  };
}

function normalizeLogs(payload: unknown): OperationLog[] {
  if (!Array.isArray(payload)) return [];
  return payload as OperationLog[];
}

function resolveApiBase() {
  const configured = (process.env.NEXT_PUBLIC_API_BASE ?? "").trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  if (typeof window !== "undefined" && window.location.port === "3000") {
    return "http://localhost:8080";
  }

  return "";
}

function buildApiURL(path: string) {
  const base = resolveApiBase();
  if (!base) return path;
  return `${base}${path}`;
}

export function formatTime(value: string | undefined | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

export function useSubtitleManager() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("dashboard");
  const [videosByType, setVideosByType] = useState<Record<MediaType, Video[]>>({ movie: [], tv: [] });
  const [selectedVideoIdByType, setSelectedVideoIdByType] = useState<Record<MediaType, string>>({
    movie: "",
    tv: ""
  });
  const [selectedTvDirPath, setSelectedTvDirPath] = useState("");
  const [tvExpandedMap, setTvExpandedMap] = useState<Record<string, boolean>>({});
  const [queryByType, setQueryByType] = useState<Record<MediaType, string>>({ movie: "", tv: "" });
  const [paginationByType, setPaginationByType] = useState<Record<MediaType, Pager>>({
    movie: { page: 1, pageSize: DEFAULT_PAGE_SIZE, total: 0, totalPages: 0 },
    tv: { page: 1, pageSize: DEFAULT_PAGE_SIZE, total: 0, totalPages: 0 }
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [directoryScan, setDirectoryScan] = useState<DirectoryScanResult>(EMPTY_DIRECTORY_SCAN);

  const pendingLoadsRef = useRef(0);
  const skipMovieQueryRef = useRef(true);
  const skipTvQueryRef = useRef(true);

  const movieVideos = useMemo(() => videosByType.movie ?? [], [videosByType.movie]);
  const tvVideos = useMemo(() => videosByType.tv ?? [], [videosByType.tv]);

  const sortedTvVideos = useMemo(() => {
    const items = [...tvVideos];
    items.sort((a, b) => {
      const aa = parseTvSeasonEpisode(a);
      const bb = parseTvSeasonEpisode(b);
      if (aa.season !== bb.season) return aa.season - bb.season;
      if (aa.episode !== bb.episode) return aa.episode - bb.episode;
      const byName = (a.fileName ?? "").localeCompare(b.fileName ?? "");
      if (byName !== 0) return byName;
      return (a.title ?? "").localeCompare(b.title ?? "");
    });
    return items;
  }, [tvVideos]);

  const moviePager = useMemo(() => paginationByType.movie, [paginationByType.movie]);
  const tvPager = useMemo(() => paginationByType.tv, [paginationByType.tv]);

  const tvRootPath = useMemo(() => {
    const configured = String(directoryScan.tvRoot || "").trim();
    if (configured) return configured;
    return String(directoryScan.tv?.[0]?.path ?? "").trim();
  }, [directoryScan.tv, directoryScan.tvRoot]);

  const tvTreeRoot = useMemo(() => {
    return buildDirectoryTree(directoryScan.tv ?? [], tvRootPath, "TV Root");
  }, [directoryScan.tv, tvRootPath]);

  const isTvExpanded = useCallback((path: string) => {
    return Boolean(tvExpandedMap[path]);
  }, [tvExpandedMap]);

  const tvVisibleNodes = useMemo(() => {
    const out: VisibleTreeNode[] = [];
    flattenTree(tvTreeRoot, 0, out, isTvExpanded);
    return out;
  }, [isTvExpanded, tvTreeRoot]);

  const selectedVideo = useMemo(() => {
    if (activeTab === "movie") {
      const currentId = selectedVideoIdByType.movie;
      return movieVideos.find((item) => item.id === currentId) ?? null;
    }

    if (activeTab === "tv") {
      const currentId = selectedVideoIdByType.tv;
      return sortedTvVideos.find((item) => item.id === currentId) ?? null;
    }

    return null;
  }, [activeTab, movieVideos, selectedVideoIdByType.movie, selectedVideoIdByType.tv, sortedTvVideos]);

  const beginLoading = () => {
    pendingLoadsRef.current += 1;
    setLoading(true);
  };

  const endLoading = () => {
    pendingLoadsRef.current = Math.max(0, pendingLoadsRef.current - 1);
    if (pendingLoadsRef.current === 0) {
      setLoading(false);
    }
  };

  async function request<T>(path: string, options: RequestInit = {}) {
    const res = await fetch(buildApiURL(path), options);
    const contentType = res.headers.get("content-type") ?? "";
    let payload: unknown = null;

    if (contentType.includes("application/json")) {
      payload = await res.json();
    } else {
      payload = await res.text();
    }

    if (!res.ok) {
      const errText =
        (isRecord(payload) && typeof payload.error === "string" ? payload.error : "") ||
        (typeof payload === "string" ? payload : "");
      throw new Error(errText || `request failed: ${res.status}`);
    }

    return payload as T;
  }

  function expandPathAncestors(pathValue: string) {
    const root = tvRootPath;
    if (!root || !pathValue) return;

    const rootNorm = normalizeForCompare(root);
    const pathNorm = normalizeForCompare(pathValue);
    if (!pathNorm.startsWith(rootNorm)) return;

    const relative = pathNorm.slice(rootNorm.length).replace(/^\/+/, "");
    const next: Record<string, boolean> = { ...tvExpandedMap, [root]: true };

    let current = root;
    for (const segment of relative.split("/").filter(Boolean)) {
      current = joinPath(current, segment);
      next[current] = true;
    }

    setTvExpandedMap(next);
  }

  function pickDefaultTvDirectory(fromScan: DirectoryScanResult) {
    const available = new Set((fromScan.tv ?? []).map((item) => item.path));
    const root = String(fromScan.tvRoot || "").trim() || String(fromScan.tv?.[0]?.path || "").trim();
    if (selectedTvDirPath && (available.has(selectedTvDirPath) || selectedTvDirPath === root)) {
      return selectedTvDirPath;
    }
    if (root) return root;
    return fromScan.tv?.[0]?.path || "";
  }

  async function loadVideosByType(mediaType: MediaType, options: { page?: number; dir?: string } = {}) {
    beginLoading();
    try {
      const currentPager = paginationByType[mediaType];
      const page = options.page || currentPager.page || 1;
      const pageSize = currentPager.pageSize || DEFAULT_PAGE_SIZE;
      const query = queryByType[mediaType] || "";

      const params = new URLSearchParams();
      params.set("mediaType", mediaType);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));

      if (query.trim()) {
        params.set("q", query.trim());
      }

      if (mediaType === "tv") {
        const dir = options.dir || selectedTvDirPath || tvRootPath;
        if (dir) {
          params.set("dir", dir);
          setSelectedTvDirPath(dir);
        }
      }

      const raw = await request<unknown>(`/api/videos?${params.toString()}`);
      const paged = normalizePagedVideosResponse(raw, page, pageSize);

      setVideosByType((prev) => ({ ...prev, [mediaType]: paged.items }));
      setPaginationByType((prev) => ({
        ...prev,
        [mediaType]: {
          page: paged.page,
          pageSize: paged.pageSize,
          total: paged.total,
          totalPages: paged.totalPages
        }
      }));
    } catch (error) {
      const errText = error instanceof Error ? error.message : String(error);
      setMessage(`Load ${mediaType} videos failed: ${errText}`);
    } finally {
      endLoading();
    }
  }

  async function loadScanStatus() {
    try {
      const payload = await request<unknown>("/api/scan/status");
      setScanStatus(normalizeScanStatus(payload));
    } catch (error) {
      const errText = error instanceof Error ? error.message : String(error);
      setMessage(`Load scan status failed: ${errText}`);
    }
  }

  async function loadDirectoryScanResult() {
    try {
      const payload = await request<unknown>("/api/scan/directories");
      const parsed = normalizeDirectoryScanResult(payload);
      setDirectoryScan(parsed);

      const defaultDir = pickDefaultTvDirectory(parsed);
      if (defaultDir) {
        setSelectedTvDirPath(defaultDir);
        expandPathAncestors(defaultDir);
      }
      return defaultDir;
    } catch (error) {
      const errText = error instanceof Error ? error.message : String(error);
      setMessage(`Load directory scan result failed: ${errText}`);
      return "";
    }
  }

  async function loadLogs() {
    try {
      const payload = await request<unknown>("/api/logs?limit=50");
      setLogs(normalizeLogs(payload));
    } catch (error) {
      const errText = error instanceof Error ? error.message : String(error);
      setMessage(`Load logs failed: ${errText}`);
    }
  }

  async function switchTab(tab: ActiveTab) {
    setActiveTab(tab);

    if (tab === "dashboard") {
      await Promise.all([loadScanStatus(), loadDirectoryScanResult(), loadLogs()]);
      return;
    }

    if (tab === "logs") {
      await loadLogs();
      return;
    }

    if (tab === "tv") {
      const defaultDir = await loadDirectoryScanResult();
      const dir = defaultDir || selectedTvDirPath || tvRootPath;
      await loadVideosByType("tv", { dir, page: tvPager.page || 1 });
      return;
    }

    await loadVideosByType("movie", { page: moviePager.page || 1 });
  }

  async function triggerScan() {
    beginLoading();
    setMessage("Step 1/2: scanning directories...");

    try {
      const discoveredPayload = await request<unknown>("/api/scan/directories", { method: "POST" });
      const discovered = normalizeDirectoryScanResult(discoveredPayload);
      setDirectoryScan(discovered);

      const defaultDir = pickDefaultTvDirectory(discovered);
      if (defaultDir) {
        setSelectedTvDirPath(defaultDir);
        expandPathAncestors(defaultDir);
      }

      setMessage("Step 2/2: scanning files from discovered directories...");

      const payload = {
        movieDirs: discovered.movie.map((item) => item.path),
        tvDirs: discovered.tv.map((item) => item.path)
      };

      const statusPayload = await request<unknown>("/api/scan/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      setScanStatus(normalizeScanStatus(statusPayload));

      await Promise.all([
        loadVideosByType("movie", { page: 1 }),
        loadVideosByType("tv", { page: 1, dir: defaultDir || selectedTvDirPath || tvRootPath }),
        loadLogs()
      ]);

      const warning = discovered.errors.length > 0 ? ` (directory warnings: ${discovered.errors.length})` : "";
      const videoCount = normalizeScanStatus(statusPayload)?.videoCount ?? 0;
      setMessage(`Scan completed. Videos: ${videoCount}${warning}`);
    } catch (error) {
      const errText = error instanceof Error ? error.message : String(error);
      setMessage(`Scan failed: ${errText}`);
    } finally {
      endLoading();
    }
  }

  async function refreshActiveTab() {
    if (activeTab === "dashboard") {
      await Promise.all([loadScanStatus(), loadDirectoryScanResult(), loadLogs()]);
      setMessage("Dashboard refreshed.");
      return;
    }

    if (activeTab === "logs") {
      await loadLogs();
      setMessage("Operation logs refreshed.");
      return;
    }

    if (activeTab === "tv") {
      await loadVideosByType("tv", {
        page: tvPager.page || 1,
        dir: selectedTvDirPath || tvRootPath
      });
      setMessage("TV data refreshed.");
      return;
    }

    await loadVideosByType("movie", { page: moviePager.page || 1 });
    setMessage("Movie data refreshed.");
  }

  function setMoviePage(nextPage: number) {
    const totalPages = Math.max(1, moviePager.totalPages || 1);
    if (nextPage < 1 || nextPage > totalPages) return;
    void loadVideosByType("movie", { page: nextPage });
  }

  function setTvPage(nextPage: number) {
    const totalPages = Math.max(1, tvPager.totalPages || 1);
    if (nextPage < 1 || nextPage > totalPages) return;
    void loadVideosByType("tv", { page: nextPage, dir: selectedTvDirPath || tvRootPath });
  }

  function selectMovieVideo(video: Video) {
    setSelectedVideoIdByType((prev) => ({ ...prev, movie: video.id }));
  }

  function selectTvVideo(video: Video) {
    setSelectedVideoIdByType((prev) => ({ ...prev, tv: video.id }));
  }

  async function selectTvDirectory(path: string) {
    setSelectedTvDirPath(path);
    expandPathAncestors(path);
    await loadVideosByType("tv", { page: 1, dir: path });
  }

  function toggleTvNode(node: VisibleTreeNode) {
    if (!node.hasChildren) return;
    setTvExpandedMap((prev) => ({ ...prev, [node.path]: !Boolean(prev[node.path]) }));
  }

  async function uploadSubtitle(video: Video, file: File, label: string) {
    const body = new FormData();
    body.append("file", file);
    body.append("label", label || "");

    try {
      await request(`/api/videos/${video.id}/subtitles`, { method: "POST", body });
      await Promise.all([
        loadVideosByType(video.mediaType || (activeTab === "tv" ? "tv" : "movie"), {
          page: paginationByType[video.mediaType || (activeTab === "tv" ? "tv" : "movie")].page || 1,
          dir: video.mediaType === "tv" ? selectedTvDirPath : ""
        }),
        loadLogs()
      ]);
      setMessage(`Uploaded subtitle for "${video.title}".`);
    } catch (error) {
      const errText = error instanceof Error ? error.message : String(error);
      setMessage(`Upload failed: ${errText}`);
    }
  }

  async function replaceSubtitle(video: Video, subtitle: Subtitle, file: File) {
    const body = new FormData();
    body.append("file", file);
    body.append("replaceId", subtitle.id);

    try {
      await request(`/api/videos/${video.id}/subtitles`, { method: "POST", body });
      await Promise.all([
        loadVideosByType(video.mediaType || (activeTab === "tv" ? "tv" : "movie"), {
          page: paginationByType[video.mediaType || (activeTab === "tv" ? "tv" : "movie")].page || 1,
          dir: video.mediaType === "tv" ? selectedTvDirPath : ""
        }),
        loadLogs()
      ]);
      setMessage(`Replaced subtitle "${subtitle.fileName}".`);
    } catch (error) {
      const errText = error instanceof Error ? error.message : String(error);
      setMessage(`Replace failed: ${errText}`);
    }
  }

  async function removeSubtitle(video: Video, subtitle: Subtitle) {
    try {
      await request(`/api/videos/${video.id}/subtitles/${subtitle.id}`, { method: "DELETE" });
      await Promise.all([
        loadVideosByType(video.mediaType || (activeTab === "tv" ? "tv" : "movie"), {
          page: paginationByType[video.mediaType || (activeTab === "tv" ? "tv" : "movie")].page || 1,
          dir: video.mediaType === "tv" ? selectedTvDirPath : ""
        }),
        loadLogs()
      ]);
      setMessage(`Deleted subtitle "${subtitle.fileName}".`);
    } catch (error) {
      const errText = error instanceof Error ? error.message : String(error);
      setMessage(`Delete failed: ${errText}`);
    }
  }

  useEffect(() => {
    if (!tvRootPath) return;
    setTvExpandedMap((prev) => ({ ...prev, [tvRootPath]: true }));
    setSelectedTvDirPath((prev) => prev || tvRootPath);
  }, [tvRootPath]);

  useEffect(() => {
    setSelectedVideoIdByType((prev) => {
      if (movieVideos.length === 0) {
        if (prev.movie === "") return prev;
        return { ...prev, movie: "" };
      }

      const exists = movieVideos.some((video) => video.id === prev.movie);
      if (exists) return prev;
      return { ...prev, movie: movieVideos[0].id };
    });
  }, [movieVideos]);

  useEffect(() => {
    setSelectedVideoIdByType((prev) => {
      if (sortedTvVideos.length === 0) {
        if (prev.tv === "") return prev;
        return { ...prev, tv: "" };
      }

      const exists = sortedTvVideos.some((video) => video.id === prev.tv);
      if (exists) return prev;
      return { ...prev, tv: sortedTvVideos[0].id };
    });
  }, [sortedTvVideos]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (skipMovieQueryRef.current) {
      skipMovieQueryRef.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      void loadVideosByType("movie", { page: 1 });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [queryByType.movie]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (skipTvQueryRef.current) {
      skipTvQueryRef.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      void loadVideosByType("tv", { page: 1, dir: selectedTvDirPath || tvRootPath });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [queryByType.tv, selectedTvDirPath, tvRootPath]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    void (async () => {
      await Promise.all([loadScanStatus(), loadLogs()]);
      const defaultDir = await loadDirectoryScanResult();
      await Promise.all([
        loadVideosByType("movie", { page: 1 }),
        loadVideosByType("tv", { page: 1, dir: defaultDir || selectedTvDirPath || tvRootPath })
      ]);
    })();
  }, []);

  return {
    activeTab,
    movieQuery: queryByType.movie,
    tvQuery: queryByType.tv,
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
    setMovieQuery: (value: string) => setQueryByType((prev) => ({ ...prev, movie: value })),
    setTvQuery: (value: string) => setQueryByType((prev) => ({ ...prev, tv: value })),
    formatTime
  };
}
