import type { Video } from "@/lib/types";

export interface SeasonEpisodeMatch {
  season: number;
  episode: number;
}

const EPISODE_PATTERNS = [
  /\bs(\d{1,2})e(\d{1,3})\b/i,
  /\b(\d{1,2})x(\d{1,3})\b/i,
  /\bseason[\s._-]*(\d{1,2})[\s._-]*episode[\s._-]*(\d{1,3})\b/i
];

function parseNumber(text: string | undefined) {
  return text ? Number.parseInt(text, 10) : Number.NaN;
}

export function parseSeasonEpisode(text: string): SeasonEpisodeMatch | null {
  for (const pattern of EPISODE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }

    return {
      season: parseNumber(match[1]),
      episode: parseNumber(match[2])
    };
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

export function parseVideoSeasonEpisode(video: Video) {
  return parseSeasonEpisode(`${video.fileName ?? ""} ${video.title ?? ""}`);
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
