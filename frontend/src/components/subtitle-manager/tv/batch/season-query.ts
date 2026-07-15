import type { SubHDSearchResult, TvSeriesSummary, Video } from "@/lib/types";
import { parseVideoSeasonEpisode } from "@/lib/subtitle-manager/tv-episode";

/** Pure helpers for season batch query / pack ranking (FE display order; BE ScoreSubHDSeasonPack is authoritative for server suggest). */

export function parseSeasonNumber(value: string | undefined) {
  if (!value) {
    return -1;
  }
  const match = value.match(/(\d{1,2})/);
  if (!match) {
    return -1;
  }
  return Number.parseInt(match[1], 10);
}

export function filterVideosForSeason(videos: Video[], season: number) {
  if (season <= 0) {
    return videos;
  }
  return videos.filter((video) => {
    const parsed = parseVideoSeasonEpisode(video, season);
    return parsed?.season === season;
  });
}

export function buildDefaultSeasonQuery(
  series: TvSeriesSummary | null | undefined,
  seasonValue: string | undefined,
  videos: Video[]
) {
  const title = (series?.originalTitle || series?.title || videos[0]?.seriesOriginalTitle || videos[0]?.seriesTitle || "").trim();
  const season = parseSeasonNumber(seasonValue);
  if (!title) {
    return "";
  }
  if (season < 0) {
    return title;
  }
  return `${title} S${String(season).padStart(2, "0")}`;
}

export function scoreSeasonPackResult(item: SubHDSearchResult, season: number) {
  if (!item.installable) {
    return -1000;
  }
  const text = `${item.title || ""} ${item.version || ""} ${item.format || ""}`.toLowerCase();
  let score = 0;
  for (const lang of item.langs || []) {
    if (/简|双|中/.test(lang)) {
      score += 3;
    }
    if (/英/.test(lang)) {
      score += 1;
    }
  }
  for (const hint of ["合集", "整季", "pack", "complete", "season", "全集"]) {
    if (text.includes(hint) || (item.title || "").includes(hint) || (item.version || "").includes(hint)) {
      score += 4;
    }
  }
  if (season >= 0) {
    const token = `s${String(season).padStart(2, "0")}`;
    const tokenAlt = `s${season}`;
    if (text.includes(token) || text.includes(tokenAlt)) {
      score += 5;
    }
    if (/\bs\d{1,2}e\d{1,3}\b/i.test(text) && !/合集|pack|complete|整季|全集/.test(text)) {
      score -= 2;
    }
  }
  const format = (item.format || "").toLowerCase();
  if (!format || format === "zip" || format === "rar" || format === "7z") {
    score += 2;
  } else if (format === "ass" || format === "ssa" || format === "srt") {
    score += 1;
  } else if (format === "sup") {
    score -= 5;
  }
  return score;
}
