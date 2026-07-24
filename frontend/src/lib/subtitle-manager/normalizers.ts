import type {
  DirectoryScanResult,
  MediaType,
  OperationLog,
  OperationLogPage,
  ScanDirectory,
  ScanStatus,
  Subtitle,
  TvSeriesPage,
  TvSeriesSummary,
  Video,
  VideoPage
} from "@/lib/types";

import { isRecord } from "./api-client";

function normalizeMediaType(value: unknown, fallback?: MediaType): MediaType {
  if (value === "tv" || value === "movie") {
    return value;
  }
  if (fallback === "tv" || fallback === "movie") {
    return fallback;
  }
  return "movie";
}

export function normalizeVideo(payload: unknown, hint?: Partial<Video>): Video {
  const body = isRecord(payload) ? payload : {};
  const subtitles = Array.isArray(body.subtitles) ? (body.subtitles as Subtitle[]) : [];
  return {
    id: typeof body.id === "string" ? body.id : hint?.id || "",
    path: typeof body.path === "string" ? body.path : hint?.path || "",
    directory: typeof body.directory === "string" ? body.directory : hint?.directory || "",
    fileName: typeof body.fileName === "string" ? body.fileName : hint?.fileName || "",
    title: typeof body.title === "string" ? body.title : hint?.title || "",
    originalTitle: typeof body.originalTitle === "string" ? body.originalTitle : hint?.originalTitle,
    year: typeof body.year === "string" ? body.year : hint?.year,
    imdbId: typeof body.imdbId === "string" ? body.imdbId : hint?.imdbId,
    tmdbId: typeof body.tmdbId === "string" ? body.tmdbId : hint?.tmdbId,
    mediaType: normalizeMediaType(body.mediaType, hint?.mediaType),
    metadataSource: typeof body.metadataSource === "string" ? body.metadataSource : hint?.metadataSource || "",
    seriesTitle: typeof body.seriesTitle === "string" ? body.seriesTitle : hint?.seriesTitle,
    seriesOriginalTitle:
      typeof body.seriesOriginalTitle === "string" ? body.seriesOriginalTitle : hint?.seriesOriginalTitle,
    seriesImdbId: typeof body.seriesImdbId === "string" ? body.seriesImdbId : hint?.seriesImdbId,
    seriesTmdbId: typeof body.seriesTmdbId === "string" ? body.seriesTmdbId : hint?.seriesTmdbId,
    posterUrl: typeof body.posterUrl === "string" ? body.posterUrl : hint?.posterUrl,
    subtitles,
    updatedAt: typeof body.updatedAt === "string" ? body.updatedAt : hint?.updatedAt || ""
  };
}

export function normalizePagedVideosResponse(payload: unknown, fallbackPage: number, fallbackPageSize: number): VideoPage {
  if (Array.isArray(payload)) {
    const items = payload.map((item) => normalizeVideo(item));
    return {
      items,
      total: items.length,
      page: fallbackPage,
      pageSize: fallbackPageSize,
      totalPages: items.length > 0 ? 1 : 0
    };
  }

  const body = isRecord(payload) ? payload : {};
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = rawItems.map((item) => normalizeVideo(item));
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

export function normalizeTvSeriesPage(payload: unknown, fallbackPage: number, fallbackPageSize: number): TvSeriesPage {
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

export function normalizeDirectoryScanResult(payload: unknown): DirectoryScanResult {
  const body = isRecord(payload) ? payload : {};
  return {
    generatedAt: typeof body.generatedAt === "string" ? body.generatedAt : "",
    movieRoot: typeof body.movieRoot === "string" ? body.movieRoot : "",
    tvRoot: typeof body.tvRoot === "string" ? body.tvRoot : "",
    movieCount: typeof body.movieCount === "number" ? body.movieCount : 0,
    tvSeriesCount: typeof body.tvSeriesCount === "number" ? body.tvSeriesCount : 0,
    movie: Array.isArray(body.movie) ? (body.movie as ScanDirectory[]) : [],
    tv: Array.isArray(body.tv) ? (body.tv as ScanDirectory[]) : [],
    errors: Array.isArray(body.errors) ? body.errors.filter((item): item is string => typeof item === "string") : []
  };
}

export function normalizeScanStatus(payload: unknown): ScanStatus | null {
  if (!isRecord(payload)) {
    return null;
  }

  const videoCount = typeof payload.videoCount === "number" ? payload.videoCount : 0;
  return {
    running: Boolean(payload.running),
    lastStartedAt: typeof payload.lastStartedAt === "string" ? payload.lastStartedAt : undefined,
    lastFinishedAt: typeof payload.lastFinishedAt === "string" ? payload.lastFinishedAt : undefined,
    videoCount,
    error: typeof payload.error === "string" ? payload.error : undefined
  };
}

export function normalizeLogsPage(payload: unknown, fallbackPage: number, fallbackPageSize: number): OperationLogPage {
  if (Array.isArray(payload)) {
    return {
      items: payload as OperationLog[],
      total: payload.length,
      page: fallbackPage,
      pageSize: fallbackPageSize,
      totalPages: payload.length > 0 ? 1 : 0
    };
  }

  const body = isRecord(payload) ? payload : {};
  const items = Array.isArray(body.items) ? (body.items as OperationLog[]) : [];
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
