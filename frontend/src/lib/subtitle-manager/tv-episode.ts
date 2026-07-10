import type { Video } from "@/lib/types";

export interface SeasonEpisodeMatch {
  season: number;
  episode: number;
}

const MAX_REASONABLE_EPISODE = 200;

const EPISODE_PATTERNS = [
  /\bs(\d{1,2})e(\d{1,3})\b/i,
  /\b(\d{1,2})x(\d{1,3})\b/i,
  /\bseason[\s._-]*(\d{1,2})[\s._-]*episode[\s._-]*(\d{1,3})\b/i
];

const EPISODE_ONLY_PATTERN = /\b(?:ep|e|episode)[\s._-]*(\d{1,3})\b/i;
const CHINESE_EPISODE_PATTERN = /第\s*(\d{1,3})\s*[集话話]/;
const SEASON_ONLY_PATTERN = /\b(?:season[\s._-]*(\d{1,2})|s(\d{1,2}))\b/i;
const BARE_EPISODE_PATTERN = /^0*(\d{1,3})(?:$|[._\-\s\[(].*)/i;
const SUBTITLE_EXT_PATTERN = /\.(ass|ssa|srt|vtt|sub|sup|idx)$/i;

function parseNumber(text: string | undefined) {
  return text ? Number.parseInt(text, 10) : Number.NaN;
}

function validEpisodeNumber(episode: number) {
  return Number.isFinite(episode) && episode >= 1 && episode <= MAX_REASONABLE_EPISODE;
}

function stripKnownExt(name: string) {
  return name.replace(SUBTITLE_EXT_PATTERN, "");
}

function extractSeasonHint(text: string): number {
  const match = text.match(SEASON_ONLY_PATTERN);
  if (!match) {
    return 0;
  }
  const raw = match[1] || match[2];
  const season = parseNumber(raw);
  return Number.isFinite(season) && season >= 0 ? season : 0;
}

function extractEpisodeOnly(text: string): number {
  const chinese = text.match(CHINESE_EPISODE_PATTERN);
  if (chinese) {
    const episode = parseNumber(chinese[1]);
    if (validEpisodeNumber(episode)) {
      return episode;
    }
  }
  const epOnly = text.match(EPISODE_ONLY_PATTERN);
  if (epOnly) {
    const episode = parseNumber(epOnly[1]);
    if (validEpisodeNumber(episode)) {
      return episode;
    }
  }
  return 0;
}

function extractBareEpisodeNumber(text: string): number {
  const normalized = text.replace(/\\/g, "/");
  const candidates: string[] = [];
  const base = normalized.split("/").pop() || "";
  if (base && base !== "." && base !== "/") {
    candidates.push(stripKnownExt(base));
  }
  const parts = normalized.split("/");
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i]?.trim() || "";
    if (!part || part === base) {
      continue;
    }
    candidates.push(stripKnownExt(part));
  }

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed) {
      continue;
    }
    const match = trimmed.match(BARE_EPISODE_PATTERN);
    if (!match) {
      continue;
    }
    const episode = parseNumber(match[1]);
    if (!validEpisodeNumber(episode)) {
      continue;
    }
    if (episode >= 1900 && episode <= 2100) {
      continue;
    }
    return episode;
  }
  return 0;
}

export function parseSeasonEpisode(text: string, defaultSeason = 0): SeasonEpisodeMatch | null {
  for (const pattern of EPISODE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }

    const season = parseNumber(match[1]);
    const episode = parseNumber(match[2]);
    if (!validEpisodeNumber(episode)) {
      continue;
    }

    return { season, episode };
  }

  const seasonHint = extractSeasonHint(text);
  const episodeOnly = extractEpisodeOnly(text);
  if (episodeOnly > 0) {
    const season = seasonHint > 0 ? seasonHint : defaultSeason;
    if (season > 0) {
      return { season, episode: episodeOnly };
    }
  }

  const bareEpisode = extractBareEpisodeNumber(text);
  if (bareEpisode > 0) {
    const season = seasonHint > 0 ? seasonHint : defaultSeason;
    if (season > 0) {
      return { season, episode: bareEpisode };
    }
  }

  return null;
}

export function parseSeasonEpisodeForSort(text: string): SeasonEpisodeMatch {
  const exact = parseSeasonEpisode(text);
  if (exact) {
    return exact;
  }

  const seasonOnly = text.match(/\bseason[\s._-]*(\d{1,2})\b/i) ?? text.match(/\bs(\d{1,2})\b/i);
  const episodeOnly = text.match(/\bepisode[\s._-]*(\d{1,3})\b/i) ?? text.match(/\be(\d{1,3})\b/i);

  return {
    season: seasonOnly ? parseNumber(seasonOnly[1]) : Number.MAX_SAFE_INTEGER,
    episode: episodeOnly ? parseNumber(episodeOnly[1]) : Number.MAX_SAFE_INTEGER
  };
}

export function parseVideoSeasonEpisode(video: Video, defaultSeason = 0) {
  return parseSeasonEpisode(`${video.fileName ?? ""} ${video.title ?? ""}`, defaultSeason);
}

export function parseVideoSeasonEpisodeForSort(video: Video) {
  return parseSeasonEpisodeForSort(`${video.fileName ?? ""} ${video.title ?? ""}`);
}

export function compareTvVideosByEpisode(a: Video, b: Video) {
  const aa = parseVideoSeasonEpisodeForSort(a);
  const bb = parseVideoSeasonEpisodeForSort(b);
  if (aa.season !== bb.season) {
    return aa.season - bb.season;
  }
  if (aa.episode !== bb.episode) {
    return aa.episode - bb.episode;
  }

  const byName = (a.fileName ?? "").localeCompare(b.fileName ?? "");
  if (byName !== 0) {
    return byName;
  }

  return (a.title ?? "").localeCompare(b.title ?? "");
}

export function collectDetectedSeasons(videos: Video[]) {
  const seasons = new Set<number>();
  for (const video of videos) {
    const parsed = parseVideoSeasonEpisodeForSort(video);
    if (Number.isFinite(parsed.season) && parsed.season !== Number.MAX_SAFE_INTEGER) {
      seasons.add(parsed.season);
    }
  }

  return Array.from(seasons).sort((a, b) => a - b);
}
