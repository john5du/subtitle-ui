"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ActiveTab,
  BatchSubtitleUploadItem,
  BatchSubtitleUploadResult,
  DirectoryScanResult,
  MediaType,
  OperationLog,
  PendingSubtitleAction,
  Pager,
  ScanDirectory,
  ScanStatus,
  Subtitle,
  TvSeriesPage,
  TvSeasonOption,
  TvSeriesSummary,
  TreeNode,
  UiPendingState,
  Video,
  VideoPage,
  VisibleTreeNode
} from "@/lib/types";
import { useI18n, type MessageKey, type TranslationValues } from "@/lib/i18n";
import { emitToast } from "@/lib/toast";

const DEFAULT_PAGE_SIZE = 30;

const EMPTY_DIRECTORY_SCAN: DirectoryScanResult = {
  generatedAt: "",
  movieRoot: "",
  tvRoot: "",
  movieCount: 0,
  tvSeriesCount: 0,
  movie: [],
  tv: [],
  errors: []
};

const EMPTY_PENDING_STATE: UiPendingState = {
  bootstrapping: true,
  tabSwitch: false,
  scan: false,
  refreshTab: null,
  movieList: false,
  tvSeriesList: false,
  tvEpisodes: false,
  logs: false,
  subtitleAction: null
};

type LoadChannel = "movieList" | "tvSeriesList" | "tvEpisodes" | "logs";
type LocalizedText =
  | {
      key: MessageKey;
      values?: TranslationValues;
    }
  | {
      raw: string;
    }
  | null;

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

function deriveTreeRootPath(entries: ScanDirectory[], configuredRoot: string) {
  const preferred = String(configuredRoot || "").trim();
  if (preferred) {
    return preferred;
  }
  if (entries.length === 0) {
    return "";
  }

  const normalized = entries
    .map((entry) => normalizeForCompare(entry.path))
    .filter((value) => value !== "");
  if (normalized.length === 0) {
    return String(entries[0]?.path || "").trim();
  }

  let prefix = normalized[0];
  for (let i = 1; i < normalized.length; i += 1) {
    const current = normalized[i];
    let nextLen = Math.min(prefix.length, current.length);
    while (nextLen > 0 && prefix.slice(0, nextLen) !== current.slice(0, nextLen)) {
      nextLen -= 1;
    }
    prefix = prefix.slice(0, nextLen);
    if (!prefix) {
      break;
    }
  }

  const slash = prefix.lastIndexOf("/");
  const trimmed = slash >= 0 ? prefix.slice(0, slash) : prefix;
  if (!trimmed) {
    return String(entries[0]?.path || "").trim();
  }

  const useBackslash = String(entries[0]?.path || "").includes("\\");
  const separator = useBackslash ? "\\" : "/";
  return trimmed.replace(/\//g, separator);
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
    label: depth === 0 ? node.label || "" : node.label,
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

function normalizeTvSeriesPage(payload: unknown, fallbackPage: number, fallbackPageSize: number): TvSeriesPage {
  if (Array.isArray(payload)) {
    return {
      items: payload as TvSeriesSummary[],
      total: payload.length,
      page: fallbackPage,
      pageSize: fallbackPageSize,
      totalPages: payload.length > 0 ? 1 : 0
    };
  }

  const body = isRecord(payload) ? payload : {};
  const items = Array.isArray(body.items) ? (body.items as TvSeriesSummary[]) : [];
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
    movieCount: typeof body.movieCount === "number" ? body.movieCount : 0,
    tvSeriesCount: typeof body.tvSeriesCount === "number" ? body.tvSeriesCount : 0,
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

  if (typeof window !== "undefined" && window.location.port === "3300") {
    return "http://localhost:9307";
  }

  return "";
}

function buildApiURL(path: string) {
  const base = resolveApiBase();
  if (!base) return path;
  return `${base}${path}`;
}

function resolveLocalizedText(value: LocalizedText, t: (key: MessageKey, values?: TranslationValues) => string) {
  if (!value) {
    return "";
  }
  if ("raw" in value) {
    return value.raw;
  }
  return t(value.key, value.values);
}

function formatTimeWithLocale(locale: string, value: string | undefined | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString(locale);
}

export function useSubtitleManager() {
  const { locale, t } = useI18n();
  const [activeTab, setActiveTab] = useState<ActiveTab>("dashboard");
  const [videosByType, setVideosByType] = useState<Record<MediaType, Video[]>>({ movie: [], tv: [] });
  const [selectedVideoIdByType, setSelectedVideoIdByType] = useState<Record<MediaType, string>>({
    movie: "",
    tv: ""
  });
  const [tvEpisodes, setTvEpisodes] = useState<Video[]>([]);
  const [tvEpisodesPath, setTvEpisodesPath] = useState("");
  const [tvVideosRequestedPath, setTvVideosRequestedPath] = useState("");
  const [selectedTvDirPath, setSelectedTvDirPath] = useState("");
  const [selectedTvSeason, setSelectedTvSeason] = useState("all");
  const [tvSeriesRows, setTvSeriesRows] = useState<TvSeriesSummary[]>([]);
  const [tvSeriesPager, setTvSeriesPager] = useState<Pager>({
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    total: 0,
    totalPages: 0
  });
  const [tvExpandedMap, setTvExpandedMap] = useState<Record<string, boolean>>({});
  const [queryByType, setQueryByType] = useState<Record<MediaType, string>>({ movie: "", tv: "" });
  const [paginationByType, setPaginationByType] = useState<Record<MediaType, Pager>>({
    movie: { page: 1, pageSize: DEFAULT_PAGE_SIZE, total: 0, totalPages: 0 },
    tv: { page: 1, pageSize: DEFAULT_PAGE_SIZE, total: 0, totalPages: 0 }
  });
  const [movieYearSortOrder, setMovieYearSortOrder] = useState<"asc" | "desc">("desc");
  const [tvSeriesYearSortOrder, setTvSeriesYearSortOrder] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<UiPendingState>(EMPTY_PENDING_STATE);
  const [uploading, setUploading] = useState(false);
  const [uploadingMessageState, setUploadingMessageState] = useState<LocalizedText>(null);
  const [messageState, setMessageState] = useState<LocalizedText>(null);
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [directoryScan, setDirectoryScan] = useState<DirectoryScanResult>(EMPTY_DIRECTORY_SCAN);
  const [loadedTabs, setLoadedTabs] = useState<Record<ActiveTab, boolean>>({
    dashboard: false,
    movie: false,
    tv: false,
    logs: false
  });

  const pendingLoadsRef = useRef(0);
  const pendingUploadsRef = useRef(0);
  const pendingLoadChannelsRef = useRef<Record<LoadChannel, number>>({
    movieList: 0,
    tvSeriesList: 0,
    tvEpisodes: 0,
    logs: 0
  });
  const pendingTvEpisodesPathRef = useRef("");
  const pendingTvEpisodesRequestRef = useRef<{ path: string; promise: Promise<Video[]> } | null>(null);
  const skipMovieQueryRef = useRef(true);
  const skipTvQueryRef = useRef(true);
  const skipMovieSortRef = useRef(true);
  const skipTvSortRef = useRef(true);

  const movieVideos = useMemo(() => videosByType.movie ?? [], [videosByType.movie]);
  const uploadingMessage = useMemo(() => resolveLocalizedText(uploadingMessageState, t), [t, uploadingMessageState]);
  const message = useMemo(() => resolveLocalizedText(messageState, t), [messageState, t]);
  const formatTime = useCallback((value: string | undefined | null) => {
    return formatTimeWithLocale(locale, value);
  }, [locale]);

  const moviePager = useMemo(() => paginationByType.movie, [paginationByType.movie]);
  const tvPager = useMemo(() => tvSeriesPager, [tvSeriesPager]);

  const tvRootPath = useMemo(() => {
    return deriveTreeRootPath(directoryScan.tv ?? [], directoryScan.tvRoot);
  }, [directoryScan.tv, directoryScan.tvRoot]);

  const tvTreeRoot = useMemo(() => {
    if ((directoryScan.tv ?? []).length === 0 && !tvRootPath) {
      return null;
    }
    return buildDirectoryTree(directoryScan.tv ?? [], tvRootPath, t("tv.listTitle"));
  }, [directoryScan.tv, t, tvRootPath]);

  const isTvExpanded = useCallback((path: string) => {
    return Boolean(tvExpandedMap[path]);
  }, [tvExpandedMap]);

  const tvVisibleNodes = useMemo(() => {
    if (!tvTreeRoot) {
      return [] as VisibleTreeNode[];
    }
    const out: VisibleTreeNode[] = [];
    flattenTree(tvTreeRoot, 0, out, isTvExpanded);
    return out;
  }, [isTvExpanded, tvTreeRoot]);

  const selectedTvSeries = useMemo(() => {
    const selectedNorm = normalizeForCompare(selectedTvDirPath);
    return tvSeriesRows.find((item) => normalizeForCompare(item.path) === selectedNorm) ?? null;
  }, [selectedTvDirPath, tvSeriesRows]);

  const tvVideosRequestedForSelectedSeries = useMemo(() => {
    const selectedNorm = normalizeForCompare(selectedTvSeries?.path || selectedTvDirPath);
    const requestedNorm = normalizeForCompare(tvVideosRequestedPath);
    return Boolean(selectedNorm && selectedNorm === requestedNorm);
  }, [selectedTvDirPath, selectedTvSeries?.path, tvVideosRequestedPath]);

  const tvVideosReadyForSelectedSeries = useMemo(() => {
    const selectedNorm = normalizeForCompare(selectedTvSeries?.path || selectedTvDirPath);
    const loadedNorm = normalizeForCompare(tvEpisodesPath);
    const requestedNorm = normalizeForCompare(tvVideosRequestedPath);
    return Boolean(selectedNorm && selectedNorm === loadedNorm && selectedNorm === requestedNorm);
  }, [selectedTvDirPath, selectedTvSeries?.path, tvEpisodesPath, tvVideosRequestedPath]);

  const selectedTvSeriesVideos = useMemo(() => {
    const selectedNorm = normalizeForCompare(selectedTvSeries?.path || selectedTvDirPath);
    const loadedNorm = normalizeForCompare(tvEpisodesPath);
    const requestedNorm = normalizeForCompare(tvVideosRequestedPath);
    if (!selectedNorm || selectedNorm !== loadedNorm || selectedNorm !== requestedNorm) {
      return [] as Video[];
    }

    const items = [...tvEpisodes];
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
  }, [selectedTvDirPath, selectedTvSeries?.path, tvEpisodes, tvEpisodesPath, tvVideosRequestedPath]);

  const tvSeasonOptions = useMemo(() => {
    const seasons = new Set<number>();
    for (const video of selectedTvSeriesVideos) {
      const parsed = parseTvSeasonEpisode(video);
      if (Number.isFinite(parsed.season) && parsed.season !== Number.MAX_SAFE_INTEGER) {
        seasons.add(parsed.season);
      }
    }

    const sortedSeasons = Array.from(seasons).sort((a, b) => a - b);
    const options: TvSeasonOption[] = [
      { value: "all", label: t("tv.allSeasons") },
      ...sortedSeasons.map((season) => ({
        value: `s${String(season).padStart(2, "0")}`,
        label: t("tv.seasonOption", { season: String(season).padStart(2, "0") }),
        season
      }))
    ];

    return options;
  }, [selectedTvSeriesVideos, t]);

  const sortedTvVideos = useMemo(() => {
    if (selectedTvSeason === "all") {
      return selectedTvSeriesVideos;
    }
    const selectedOption = tvSeasonOptions.find((item) => item.value === selectedTvSeason);
    if (!selectedOption?.season) {
      return selectedTvSeriesVideos;
    }
    return selectedTvSeriesVideos.filter((video) => parseTvSeasonEpisode(video).season === selectedOption.season);
  }, [selectedTvSeason, selectedTvSeriesVideos, tvSeasonOptions]);

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

  const beginLoadChannel = useCallback((channel: LoadChannel) => {
    pendingLoadChannelsRef.current[channel] += 1;
    setPending((prev) => ({ ...prev, [channel]: true }));
  }, []);

  const endLoadChannel = useCallback((channel: LoadChannel) => {
    pendingLoadChannelsRef.current[channel] = Math.max(0, pendingLoadChannelsRef.current[channel] - 1);
    if (pendingLoadChannelsRef.current[channel] === 0) {
      setPending((prev) => ({ ...prev, [channel]: false }));
    }
  }, []);

  const setSubtitleActionPending = useCallback((action: PendingSubtitleAction | null) => {
    setPending((prev) => ({ ...prev, subtitleAction: action }));
  }, []);

  const finishBootstrapping = useCallback(() => {
    setPending((prev) => (prev.bootstrapping ? { ...prev, bootstrapping: false } : prev));
  }, []);

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

  const setTranslatedMessage = useCallback((key: MessageKey, values?: TranslationValues) => {
    setMessageState({ key, values });
  }, []);

  const beginUpload = (key: MessageKey, values?: TranslationValues) => {
    pendingUploadsRef.current += 1;
    setUploadingMessageState({ key, values });
    setUploading(true);
  };

  const updateUploadMessage = (key: MessageKey, values?: TranslationValues) => {
    setUploadingMessageState({ key, values });
  };

  const endUpload = () => {
    pendingUploadsRef.current = Math.max(0, pendingUploadsRef.current - 1);
    if (pendingUploadsRef.current === 0) {
      setUploading(false);
      setUploadingMessageState(null);
    }
  };

  const reportRequestError = useCallback((prefix: MessageKey, error: unknown) => {
    const errText = error instanceof Error ? error.message : String(error);
    const title = t(prefix);
    setMessageState({ raw: `${title}: ${errText}` });
    emitToast({
      level: "error",
      title,
      message: errText,
      detail: t("toast.operationFailedDetail")
    });
  }, [t]);

  const notifySuccess = useCallback((title: string, messageText: string, detail?: string) => {
    emitToast({
      level: "success",
      title,
      message: messageText,
      detail
    });
  }, []);

  const notifyInfo = useCallback((title: string, messageText: string, detail?: string) => {
    emitToast({
      level: "info",
      title,
      message: messageText,
      detail
    });
  }, []);

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
    const root = String(fromScan.tvRoot || "").trim() || String(fromScan.tv?.[0]?.path || "").trim();
    if (root) return root;
    return fromScan.tv?.[0]?.path || "";
  }

  async function loadVideosByType(mediaType: MediaType, options: { page?: number; dir?: string } = {}) {
    const channel: LoadChannel = mediaType === "movie" ? "movieList" : "tvEpisodes";
    beginLoadChannel(channel);
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

      if (mediaType === "movie") {
        params.set("sortBy", "year");
        params.set("sortOrder", movieYearSortOrder);
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
      reportRequestError(mediaType === "movie" ? "error.loadMovieVideos" : "error.loadTvEpisodes", error);
    } finally {
      endLoading();
      endLoadChannel(channel);
    }
  }

  async function loadTvSeriesPage(options: { page?: number } = {}) {
    beginLoadChannel("tvSeriesList");
    beginLoading();
    try {
      const page = options.page || tvSeriesPager.page || 1;
      const pageSize = tvSeriesPager.pageSize || DEFAULT_PAGE_SIZE;
      const query = queryByType.tv || "";

      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      params.set("sortYear", "year");
      params.set("sortOrder", tvSeriesYearSortOrder);
      if (query.trim()) {
        params.set("q", query.trim());
      }

      const raw = await request<unknown>(`/api/tv/series?${params.toString()}`);
      const paged = normalizeTvSeriesPage(raw, page, pageSize);
      setTvSeriesRows(paged.items);
      setTvSeriesPager({
        page: paged.page,
        pageSize: paged.pageSize,
        total: paged.total,
        totalPages: paged.totalPages
      });
      return paged.items;
    } catch (error) {
      reportRequestError("error.loadTvSeries", error);
      return [];
    } finally {
      endLoading();
      endLoadChannel("tvSeriesList");
    }
  }

  async function listAllTvVideos(directoryPath = "") {
    const dir = directoryPath.trim();
    const out: Video[] = [];
    let page = 1;
    let totalPages = 1;
    const pageSize = 200;

    while (page <= totalPages) {
      const params = new URLSearchParams();
      params.set("mediaType", "tv");
      if (dir) {
        params.set("dir", dir);
      }
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));

      const raw = await request<unknown>(`/api/videos?${params.toString()}`);
      const paged = normalizePagedVideosResponse(raw, page, pageSize);
      out.push(...paged.items);
      totalPages = Math.max(1, paged.totalPages || 1);
      page += 1;
    }

    return out;
  }

  async function listAllTvVideosInDirectory(directoryPath: string) {
    return listAllTvVideos(directoryPath);
  }

  async function loadTvEpisodesForSeries(seriesPath: string) {
    const dir = seriesPath.trim();
    if (!dir) {
      setTvEpisodes([]);
      setTvEpisodesPath("");
      pendingTvEpisodesPathRef.current = "";
      setSelectedVideoIdByType((prev) => ({ ...prev, tv: "" }));
      return [] as Video[];
    }

    pendingTvEpisodesPathRef.current = dir;
    beginLoadChannel("tvEpisodes");
    beginLoading();
    try {
      const videos = await listAllTvVideosInDirectory(dir);
      setTvEpisodes(videos);
      setTvEpisodesPath(dir);
      setVideosByType((prev) => ({ ...prev, tv: videos }));
      setPaginationByType((prev) => ({
        ...prev,
        tv: {
          page: 1,
          pageSize: videos.length > 0 ? videos.length : DEFAULT_PAGE_SIZE,
          total: videos.length,
          totalPages: videos.length > 0 ? 1 : 0
        }
      }));
      setSelectedVideoIdByType((prev) => ({
        ...prev,
        tv: videos.some((video) => video.id === prev.tv) ? prev.tv : videos.length > 0 ? videos[0].id : ""
      }));
      return videos;
    } catch (error) {
      reportRequestError("error.loadTvEpisodes", error);
      return [] as Video[];
    } finally {
      if (normalizeForCompare(pendingTvEpisodesPathRef.current) === normalizeForCompare(dir)) {
        pendingTvEpisodesPathRef.current = "";
      }
      endLoading();
      endLoadChannel("tvEpisodes");
    }
  }

  async function requestTvVideosForPath(seriesPath: string, options: { force?: boolean } = {}) {
    const dir = seriesPath.trim();
    if (!dir) {
      setTvVideosRequestedPath("");
      return [] as Video[];
    }

    setTvVideosRequestedPath(dir);

    const targetNorm = normalizeForCompare(dir);
    const loadedNorm = normalizeForCompare(tvEpisodesPath);
    if (!options.force && targetNorm && targetNorm === loadedNorm) {
      return tvEpisodes;
    }

    const pendingRequest = pendingTvEpisodesRequestRef.current;
    if (pendingRequest && normalizeForCompare(pendingRequest.path) === targetNorm) {
      return pendingRequest.promise;
    }

    const promise = loadTvEpisodesForSeries(dir).finally(() => {
      const current = pendingTvEpisodesRequestRef.current;
      if (current && normalizeForCompare(current.path) === targetNorm) {
        pendingTvEpisodesRequestRef.current = null;
      }
    });
    pendingTvEpisodesRequestRef.current = { path: dir, promise };
    return promise;
  }

  function shouldRefreshTvVideosForPath(seriesPath: string) {
    const targetNorm = normalizeForCompare(seriesPath);
    if (!targetNorm) {
      return false;
    }

    const requestedNorm = normalizeForCompare(tvVideosRequestedPath);
    const loadedNorm = normalizeForCompare(tvEpisodesPath);
    return targetNorm === requestedNorm || targetNorm === loadedNorm;
  }

  async function refreshTvVideosForPath(seriesPath: string) {
    const dir = seriesPath.trim();
    if (!dir || !shouldRefreshTvVideosForPath(dir)) {
      return [] as Video[];
    }

    return requestTvVideosForPath(dir, { force: true });
  }

  async function loadScanStatus() {
    try {
      const payload = await request<unknown>("/api/scan/status");
      setScanStatus(normalizeScanStatus(payload));
    } catch (error) {
      reportRequestError("error.loadScanStatus", error);
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
      reportRequestError("error.loadDirectoryScan", error);
      return "";
    }
  }

  async function loadLogs() {
    beginLoadChannel("logs");
    try {
      const payload = await request<unknown>("/api/logs?limit=50");
      setLogs(normalizeLogs(payload));
    } catch (error) {
      reportRequestError("error.loadLogs", error);
    } finally {
      endLoadChannel("logs");
    }
  }

  async function switchTab(tab: ActiveTab) {
    setPending((prev) => ({ ...prev, tabSwitch: true }));
    setActiveTab(tab);

    try {
      if (tab === "dashboard") {
        await Promise.all([loadScanStatus(), loadDirectoryScanResult(), loadLogs()]);
        setLoadedTabs((prev) => ({ ...prev, dashboard: true }));
        return;
      }

      if (tab === "logs") {
        await loadLogs();
        setLoadedTabs((prev) => ({ ...prev, logs: true }));
        return;
      }

      if (tab === "tv") {
        if (!loadedTabs.tv) {
          const defaultDir = directoryScan.generatedAt ? selectedTvDirPath : await loadDirectoryScanResult();
          const seriesRows = await loadTvSeriesPage({ page: tvSeriesPager.page || 1 });
          const selectedNorm = normalizeForCompare(selectedTvDirPath);
          const targetDir =
            seriesRows.find((item) => normalizeForCompare(item.path) === selectedNorm)?.path ||
            seriesRows.find((item) => item.path)?.path ||
            selectedTvDirPath ||
            defaultDir ||
            directoryScan.tvRoot;
          if (targetDir) {
            setSelectedTvDirPath(targetDir);
            expandPathAncestors(targetDir);
          } else {
            setTvEpisodes([]);
            setTvEpisodesPath("");
          }
          setLoadedTabs((prev) => ({ ...prev, tv: true }));
        }
        return;
      }

      await loadVideosByType("movie", { page: moviePager.page || 1 });
      setLoadedTabs((prev) => ({ ...prev, movie: true }));
    } finally {
      setPending((prev) => ({ ...prev, tabSwitch: false }));
    }
  }

  async function triggerScan() {
    beginLoading();
    setPending((prev) => ({ ...prev, scan: true }));
    setTranslatedMessage("status.scanStepDirs");

    try {
      const discoveredPayload = await request<unknown>("/api/scan/directories", { method: "POST" });
      const discovered = normalizeDirectoryScanResult(discoveredPayload);
      setDirectoryScan(discovered);

      const defaultDir = pickDefaultTvDirectory(discovered);
      if (defaultDir) {
        setSelectedTvDirPath(defaultDir);
        expandPathAncestors(defaultDir);
      }

      setTranslatedMessage("status.scanStepFiles");

      const payload = {
        movieDirs: discovered.movie.map((item) => item.path),
        tvDirs: discovered.tv.map((item) => item.path)
      };

      const statusPayload = await request<unknown>("/api/scan/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const normalizedStatus = normalizeScanStatus(statusPayload);
      setScanStatus(normalizedStatus);

      const targetDir = defaultDir || tvRootPath || discovered.tvRoot || "";
      await Promise.all([
        loadVideosByType("movie", { page: 1 }),
        loadTvSeriesPage({ page: 1 }),
        refreshTvVideosForPath(selectedTvSeries?.path || selectedTvDirPath || tvEpisodesPath || targetDir),
        loadLogs()
      ]);

      const warningCount = discovered.errors.length;
      const videoCount = normalizedStatus?.videoCount ?? 0;
      if (warningCount > 0) {
        setTranslatedMessage("status.scanCompletedWithWarnings", { count: videoCount, warnings: warningCount });
      } else {
        setTranslatedMessage("status.scanCompletedNoWarnings", { count: videoCount });
      }
      if (warningCount > 0) {
        notifyInfo(
          t("toast.scanWarningsTitle"),
          t("toast.scanWarningsMessage", { count: videoCount }),
          t("toast.scanWarningsDetail", { warnings: warningCount })
        );
      } else {
        notifySuccess(
          t("toast.scanSuccessTitle"),
          t("toast.scanSuccessMessage", { count: videoCount }),
          t("toast.scanSuccessDetail")
        );
      }
    } catch (error) {
      reportRequestError("error.scanFailed", error);
    } finally {
      setPending((prev) => ({ ...prev, scan: false }));
      endLoading();
    }
  }

  async function refreshActiveTab() {
    setPending((prev) => ({ ...prev, refreshTab: activeTab }));
    try {
      if (activeTab === "dashboard") {
        await Promise.all([loadScanStatus(), loadDirectoryScanResult(), loadLogs()]);
        setTranslatedMessage("status.dashboardRefreshed");
        notifySuccess(t("toast.dashboardRefreshedTitle"), t("toast.dashboardRefreshedMessage"));
        return;
      }

      if (activeTab === "logs") {
        await loadLogs();
        setTranslatedMessage("status.logsRefreshed");
        notifySuccess(t("toast.logsRefreshedTitle"), t("toast.logsRefreshedMessage"));
        return;
      }

      if (activeTab === "tv") {
        const targetDir = selectedTvSeries?.path || selectedTvDirPath || tvRootPath || directoryScan.tvRoot || "";
        const reloadEpisodes = shouldRefreshTvVideosForPath(targetDir);
        await Promise.all([loadTvSeriesPage({ page: tvSeriesPager.page || 1 }), refreshTvVideosForPath(targetDir)]);
        setTranslatedMessage("status.tvRefreshed");
        notifySuccess(
          t("toast.tvRefreshedTitle"),
          reloadEpisodes ? t("toast.tvRefreshedMessageAll") : t("toast.tvRefreshedMessageList")
        );
        return;
      }

      await loadVideosByType("movie", { page: moviePager.page || 1 });
      setTranslatedMessage("status.movieRefreshed");
      notifySuccess(t("toast.movieRefreshedTitle"), t("toast.movieRefreshedMessage"));
    } finally {
      setPending((prev) => ({ ...prev, refreshTab: null }));
    }
  }

  async function loadMovieWorkspaceOnDemand() {
    await loadVideosByType("movie", { page: moviePager.page || 1 });
  }

  async function loadTvWorkspaceOnDemand(seriesPath = "") {
    const requestedPath = seriesPath.trim();
    const seriesRows = await loadTvSeriesPage({ page: tvSeriesPager.page || 1 });
    const selectedNorm = normalizeForCompare(requestedPath || selectedTvSeries?.path || selectedTvDirPath);
    const selectedPath = (
      seriesRows.find((item) => normalizeForCompare(item.path) === selectedNorm)?.path ||
      requestedPath ||
      seriesRows.find((item) => item.path)?.path ||
      selectedTvSeries?.path ||
      selectedTvDirPath ||
      tvRootPath ||
      directoryScan.tvRoot ||
      ""
    ).trim();

    if (!selectedPath) {
      return [] as Video[];
    }

    setSelectedTvDirPath(selectedPath);
    expandPathAncestors(selectedPath);
    return requestTvVideosForPath(selectedPath);
  }

  function setMoviePage(nextPage: number) {
    const totalPages = Math.max(1, moviePager.totalPages || 1);
    if (nextPage < 1 || nextPage > totalPages) return;
    void loadVideosByType("movie", { page: nextPage });
  }

  function setTvPage(nextPage: number) {
    const totalPages = Math.max(1, tvPager.totalPages || 1);
    if (nextPage < 1 || nextPage > totalPages) return;
    void loadTvSeriesPage({ page: nextPage });
  }

  function toggleMovieYearSort() {
    setMovieYearSortOrder((prev) => (prev === "desc" ? "asc" : "desc"));
  }

  function toggleTvSeriesYearSort() {
    setTvSeriesYearSortOrder((prev) => (prev === "desc" ? "asc" : "desc"));
  }

  function selectMovieVideo(video: Video) {
    setSelectedVideoIdByType((prev) => ({ ...prev, movie: video.id }));
  }

  function selectTvVideo(video: Video) {
    setSelectedVideoIdByType((prev) => ({ ...prev, tv: video.id }));
  }

  function selectTvDirectory(path: string) {
    const nextNorm = normalizeForCompare(path);
    const currentNorm = normalizeForCompare(selectedTvDirPath);

    if (nextNorm === currentNorm) {
      setSelectedTvSeason("all");
      expandPathAncestors(path);
      return;
    }

    setSelectedTvDirPath(path);
    setSelectedTvSeason("all");
    setSelectedVideoIdByType((prev) => (prev.tv ? { ...prev, tv: "" } : prev));
    expandPathAncestors(path);
  }

  function toggleTvNode(node: VisibleTreeNode) {
    if (!node.hasChildren) return;
    setTvExpandedMap((prev) => ({ ...prev, [node.path]: !Boolean(prev[node.path]) }));
  }

  async function uploadSubtitle(video: Video, file: File, label: string) {
    const body = new FormData();
    body.append("file", file);
    body.append("label", label || "");

    setSubtitleActionPending({
      kind: "upload",
      videoId: video.id
    });
    beginUpload("status.uploadingSubtitleFile");
    try {
      await request(`/api/videos/${video.id}/subtitles`, { method: "POST", body });
      if (video.mediaType === "tv") {
        const targetDir =
          selectedTvSeries?.path || selectedTvDirPath || video.directory || tvEpisodesPath || tvRootPath || directoryScan.tvRoot;
        await Promise.all([loadTvSeriesPage({ page: tvSeriesPager.page || 1 }), refreshTvVideosForPath(targetDir || ""), loadLogs()]);
      } else {
        await Promise.all([loadVideosByType("movie", { page: moviePager.page || 1 }), loadLogs()]);
      }
      setTranslatedMessage("status.uploadedSubtitleFor", { title: video.title || video.fileName });
      notifySuccess(t("toast.subtitleUploadedTitle"), video.title || video.fileName, file.name);
      return true;
    } catch (error) {
      reportRequestError("error.uploadFailed", error);
      return false;
    } finally {
      endUpload();
      setSubtitleActionPending(null);
    }
  }

  async function replaceSubtitle(video: Video, subtitle: Subtitle, file: File) {
    const body = new FormData();
    body.append("file", file);
    body.append("replaceId", subtitle.id);

    setSubtitleActionPending({
      kind: "replace",
      videoId: video.id,
      subtitleId: subtitle.id,
      subtitleFileName: subtitle.fileName
    });
    beginUpload("status.uploadingSubtitleFile");
    try {
      await request(`/api/videos/${video.id}/subtitles`, { method: "POST", body });
      if (video.mediaType === "tv") {
        const targetDir =
          selectedTvSeries?.path || selectedTvDirPath || video.directory || tvEpisodesPath || tvRootPath || directoryScan.tvRoot;
        await Promise.all([loadTvSeriesPage({ page: tvSeriesPager.page || 1 }), refreshTvVideosForPath(targetDir || ""), loadLogs()]);
      } else {
        await Promise.all([loadVideosByType("movie", { page: moviePager.page || 1 }), loadLogs()]);
      }
      setTranslatedMessage("status.replacedSubtitle", { name: subtitle.fileName });
      notifySuccess(t("toast.subtitleReplacedTitle"), subtitle.fileName, file.name);
      return true;
    } catch (error) {
      reportRequestError("error.replaceFailed", error);
      return false;
    } finally {
      endUpload();
      setSubtitleActionPending(null);
    }
  }

  async function removeSubtitle(video: Video, subtitle: Subtitle) {
    setSubtitleActionPending({
      kind: "delete",
      videoId: video.id,
      subtitleId: subtitle.id,
      subtitleFileName: subtitle.fileName
    });
    try {
      await request(`/api/videos/${video.id}/subtitles/${subtitle.id}`, { method: "DELETE" });
      if (video.mediaType === "tv") {
        const targetDir =
          selectedTvSeries?.path || selectedTvDirPath || video.directory || tvEpisodesPath || tvRootPath || directoryScan.tvRoot;
        await Promise.all([loadTvSeriesPage({ page: tvSeriesPager.page || 1 }), refreshTvVideosForPath(targetDir || ""), loadLogs()]);
      } else {
        await Promise.all([loadVideosByType("movie", { page: moviePager.page || 1 }), loadLogs()]);
      }
      setTranslatedMessage("status.deletedSubtitle", { name: subtitle.fileName });
      notifySuccess(t("toast.subtitleDeletedTitle"), subtitle.fileName, video.title || video.fileName);
      return true;
    } catch (error) {
      reportRequestError("error.deleteFailed", error);
      return false;
    } finally {
      setSubtitleActionPending(null);
    }
  }

  async function loadTvBatchCandidates() {
    const targetDir = (selectedTvSeries?.path || selectedTvDirPath || tvEpisodesPath || tvRootPath || directoryScan.tvRoot || "").trim();
    if (!targetDir) {
      setTranslatedMessage("status.tvBatchNeedsSeries");
      notifyInfo(t("toast.selectTvSeriesTitle"), t("toast.selectTvSeriesMessage"));
      return [] as Video[];
    }

    return requestTvVideosForPath(targetDir);
  }

  async function uploadBatchSubtitles(items: BatchSubtitleUploadItem[]): Promise<BatchSubtitleUploadResult> {
    if (items.length === 0) {
      return { total: 0, success: 0, failed: 0, errors: [] };
    }

    setSubtitleActionPending({
      kind: "batch",
      videoId: items[0]?.video.id || ""
    });
    beginLoading();
    beginUpload("status.uploadingSubtitleFilesProgress", { current: 0, total: items.length });
    const errors: string[] = [];
    let success = 0;

    try {
      for (const [index, item] of items.entries()) {
        updateUploadMessage("status.uploadingSubtitleFilesProgress", { current: index + 1, total: items.length });
        const body = new FormData();
        body.append("file", item.file);
        body.append("label", item.label || "");

        try {
          await request(`/api/videos/${item.video.id}/subtitles`, { method: "POST", body });
          success += 1;
        } catch (error) {
          const errText = error instanceof Error ? error.message : String(error);
          const source = item.sourceName || item.file.name;
          errors.push(`${source} -> ${item.video.fileName}: ${errText}`);
        }
      }
    } finally {
      try {
        await Promise.all([
          loadTvSeriesPage({ page: tvSeriesPager.page || 1 }),
          refreshTvVideosForPath(
            (selectedTvSeries?.path || selectedTvDirPath || tvEpisodesPath || tvRootPath || directoryScan.tvRoot || "") as string
          ),
          loadLogs()
        ]);
      } catch (error) {
        const errText = error instanceof Error ? error.message : String(error);
        errors.push(`refresh after batch upload failed: ${errText}`);
      }
      endUpload();
      endLoading();
    }

    const total = items.length;
    const failed = total - success;
    if (failed > 0) {
      setTranslatedMessage("status.batchFinishedWarnings", { success, total, failed });
      notifyInfo(
        t("toast.batchWarningsTitle"),
        t("toast.batchWarningsMessage", { success, total }),
        t("toast.batchWarningsDetail", { failed })
      );
    } else {
      setTranslatedMessage("status.batchFinishedSuccess", { success, total });
      notifySuccess(t("toast.batchSuccessTitle"), t("toast.batchSuccessMessage", { success, total }));
    }
    setSubtitleActionPending(null);

    return {
      total,
      success,
      failed,
      errors
    };
  }

  useEffect(() => {
    if (!tvRootPath) return;
    setTvExpandedMap((prev) => ({ ...prev, [tvRootPath]: true }));
  }, [tvRootPath]);

  useEffect(() => {
    const selectedNorm = normalizeForCompare(selectedTvDirPath);
    const existsInCurrentPage = tvSeriesRows.some((item) => normalizeForCompare(item.path) === selectedNorm);
    if (selectedNorm && existsInCurrentPage) {
      return;
    }

    if (tvSeriesRows.length > 0) {
      setSelectedTvDirPath(tvSeriesRows[0].path);
      return;
    }
    if (selectedTvDirPath !== "") {
      setSelectedTvDirPath("");
    }
  }, [selectedTvDirPath, tvSeriesRows]);

  useEffect(() => {
    setSelectedTvSeason("all");
  }, [selectedTvDirPath]);

  useEffect(() => {
    if (selectedTvSeason === "all") return;
    const exists = tvSeasonOptions.some((item) => item.value === selectedTvSeason);
    if (!exists) {
      setSelectedTvSeason("all");
    }
  }, [selectedTvSeason, tvSeasonOptions]);

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

  /* eslint-disable react-hooks/exhaustive-deps */
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

  useEffect(() => {
    if (skipTvQueryRef.current) {
      skipTvQueryRef.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      void loadTvSeriesPage({ page: 1 });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [queryByType.tv]);

  useEffect(() => {
    if (skipMovieSortRef.current) {
      skipMovieSortRef.current = false;
      return;
    }
    void loadVideosByType("movie", { page: 1 });
  }, [movieYearSortOrder]);

  useEffect(() => {
    if (skipTvSortRef.current) {
      skipTvSortRef.current = false;
      return;
    }
    void loadTvSeriesPage({ page: 1 });
  }, [tvSeriesYearSortOrder]);

  useEffect(() => {
    void (async () => {
      try {
        await Promise.all([loadScanStatus(), loadDirectoryScanResult(), loadLogs()]);
        setLoadedTabs((prev) => ({ ...prev, dashboard: true }));
      } finally {
        finishBootstrapping();
      }
    })();
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  return {
    activeTab,
    movieQuery: queryByType.movie,
    tvQuery: queryByType.tv,
    movieVideos,
    tvSeriesRows,
    selectedTvSeries,
    tvVideosRequestedForSelectedSeries,
    tvVideosReadyForSelectedSeries,
    sortedTvVideos,
    tvSeasonOptions,
    selectedTvSeason,
    selectedVideoIdByType,
    selectedVideo,
    moviePager,
    tvPager,
    movieYearSortOrder,
    tvSeriesYearSortOrder,
    tvVisibleNodes,
    selectedTvDirPath,
    logs,
    scanStatus,
    directoryScan,
    loading,
    pending,
    uploading,
    uploadingMessage,
    message,
    switchTab,
    triggerScan,
    refreshActiveTab,
    loadMovieWorkspaceOnDemand,
    loadTvWorkspaceOnDemand,
    selectMovieVideo,
    selectTvVideo,
    selectTvDirectory,
    toggleTvNode,
    isTvExpanded,
    setMoviePage,
    setTvPage,
    toggleMovieYearSort,
    toggleTvSeriesYearSort,
    uploadSubtitle,
    replaceSubtitle,
    removeSubtitle,
    loadTvBatchCandidates,
    uploadBatchSubtitles,
    setMovieQuery: (value: string) => setQueryByType((prev) => ({ ...prev, movie: value })),
    setTvQuery: (value: string) => setQueryByType((prev) => ({ ...prev, tv: value })),
    setSelectedTvSeason,
    formatTime
  };
}
