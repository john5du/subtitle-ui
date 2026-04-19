import type { TranslateFn } from "@/lib/i18n";
import type { Video } from "@/lib/types";
import {
  compareTvVideosByEpisode,
  parseSeasonEpisode,
  parseVideoSeasonEpisode
} from "@/lib/subtitle-manager/tv-episode";
import {
  extractSubtitleEntriesFromArchiveFile,
  isArchiveFileName,
  isSubtitleFileName,
  type ZipSubtitleEntry
} from "@/lib/subtitle-zip";

import type {
  BatchLanguagePreference,
  DetectedBatchLanguageType,
  SeasonBatchMappingFilter,
  SeasonBatchMappingRow,
  SeasonBatchMappingStatus,
  SeasonBatchRowView
} from "../types";

const BATCH_LANGUAGE_LABEL_KEYS: Record<DetectedBatchLanguageType, Parameters<TranslateFn>[0]> = {
  bilingual: "batch.language.bilingual",
  simplified: "batch.language.simplified",
  traditional: "batch.language.traditional",
  english: "batch.language.english",
  japanese: "batch.language.japanese",
  korean: "batch.language.korean",
  unknown: "batch.language.unknown"
};

const BATCH_LANGUAGE_ORDER: DetectedBatchLanguageType[] = [
  "bilingual",
  "simplified",
  "traditional",
  "english",
  "japanese",
  "korean",
  "unknown"
];

const BATCH_FORMAT_ORDER = [".ass", ".ssa", ".srt", ".vtt", ".sub"];
const BATCH_STATUS_ORDER: Record<SeasonBatchMappingStatus, number> = {
  unassigned: 0,
  manual: 1,
  skipped: 2,
  auto: 3
};

function compareSubtitleFormats(a: string, b: string) {
  const ia = BATCH_FORMAT_ORDER.indexOf(a);
  const ib = BATCH_FORMAT_ORDER.indexOf(b);
  const aa = ia < 0 ? Number.MAX_SAFE_INTEGER : ia;
  const bb = ib < 0 ? Number.MAX_SAFE_INTEGER : ib;
  if (aa !== bb) {
    return aa - bb;
  }
  return a.localeCompare(b);
}

function compareLanguageTypes(a: DetectedBatchLanguageType, b: DetectedBatchLanguageType) {
  const ia = BATCH_LANGUAGE_ORDER.indexOf(a);
  const ib = BATCH_LANGUAGE_ORDER.indexOf(b);
  const aa = ia < 0 ? Number.MAX_SAFE_INTEGER : ia;
  const bb = ib < 0 ? Number.MAX_SAFE_INTEGER : ib;
  if (aa !== bb) {
    return aa - bb;
  }
  return a.localeCompare(b);
}

function subtitleExtension(fileName: string) {
  const lower = fileName.toLowerCase();
  const index = lower.lastIndexOf(".");
  if (index < 0) {
    return "";
  }
  return lower.slice(index);
}

function choosePreferredEntry(
  entries: ZipSubtitleEntry[],
  languagePreference: BatchLanguagePreference,
  formatPreference: string
) {
  let pool = [...entries];

  if (formatPreference !== "any") {
    const byFormat = pool.filter((entry) => subtitleExtension(entry.fileName) === formatPreference);
    if (byFormat.length > 0) {
      pool = byFormat;
    }
  }

  if (languagePreference !== "any") {
    const byLanguage = pool.filter(
      (entry) => detectSubtitleLanguageType(`${entry.path} ${entry.fileName}`) === languagePreference
    );
    if (byLanguage.length > 0) {
      pool = byLanguage;
    }
  }

  pool.sort((a, b) => a.path.localeCompare(b.path));
  return pool[0];
}

function countSummaryLabel(
  count: number,
  t: TranslateFn,
  singularKey: Parameters<TranslateFn>[0],
  pluralKey: Parameters<TranslateFn>[0]
) {
  return t(count === 1 ? singularKey : pluralKey, { count });
}

export function formatLanguageTypeLabel(value: DetectedBatchLanguageType, t: TranslateFn) {
  return t(BATCH_LANGUAGE_LABEL_KEYS[value]);
}

export function formatSubtitleExtLabel(ext: string) {
  return ext.replace(".", "").toUpperCase();
}

export function normalizeSubtitleFormat(value: string) {
  return value.toLowerCase();
}

export function describeBatchEntrySource(entry: ZipSubtitleEntry) {
  const normalizedPath = entry.path.replace(/\\/g, "/");
  const suffix = normalizedPath.toLowerCase().endsWith(`/${entry.fileName.toLowerCase()}`)
    ? normalizedPath.slice(0, normalizedPath.length - entry.fileName.length - 1)
    : "";

  return {
    fileName: entry.fileName,
    sourcePath: suffix
  };
}

export function getLanguageTypesFromEntries(entries: ZipSubtitleEntry[]) {
  const set = new Set<DetectedBatchLanguageType>();
  for (const entry of entries) {
    set.add(detectSubtitleLanguageType(`${entry.path} ${entry.fileName}`));
  }
  return Array.from(set).sort(compareLanguageTypes);
}

export function getSubtitleFormatsFromEntries(entries: ZipSubtitleEntry[]) {
  const set = new Set<string>();
  for (const entry of entries) {
    const ext = normalizeSubtitleFormat(subtitleExtension(entry.fileName || entry.path));
    if (ext) {
      set.add(ext);
    }
  }
  return Array.from(set).sort(compareSubtitleFormats);
}

export { parseSeasonEpisode, parseVideoSeasonEpisode };

export function formatSeasonEpisodeText(season: number | null, episode: number | null) {
  if (season === null || episode === null) {
    return "-";
  }
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

export function buildSeasonBatchRows(videos: Video[], entries: ZipSubtitleEntry[]) {
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
      selectedVideoId: autoVideoId,
      skipped: false
    } satisfies SeasonBatchMappingRow;
  });

  return rows;
}

export function candidateVideosForBatchRow(row: SeasonBatchMappingRow, videos: Video[]) {
  const allSorted = [...videos].sort(compareTvVideosByEpisode);
  if (row.season === null) {
    return allSorted;
  }

  const sameSeason = allSorted.filter((video) => parseVideoSeasonEpisode(video)?.season === row.season);
  if (sameSeason.length > 0) {
    const sameSeasonIds = new Set(sameSeason.map((video) => video.id));
    const otherSeasons = allSorted.filter((video) => !sameSeasonIds.has(video.id));
    return [...sameSeason, ...otherSeasons];
  }

  return allSorted;
}

export function getSeasonBatchRowStatus(row: SeasonBatchMappingRow): SeasonBatchMappingStatus {
  if (row.skipped) {
    return "skipped";
  }

  if (!row.selectedVideoId) {
    return "unassigned";
  }

  if (row.autoVideoId && row.autoVideoId === row.selectedVideoId) {
    return "auto";
  }

  return "manual";
}

function compareSeasonBatchRows(a: SeasonBatchMappingRow, b: SeasonBatchMappingRow) {
  const statusOrderDiff = BATCH_STATUS_ORDER[getSeasonBatchRowStatus(a)] - BATCH_STATUS_ORDER[getSeasonBatchRowStatus(b)];
  if (statusOrderDiff !== 0) {
    return statusOrderDiff;
  }

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
}

export function buildSeasonBatchRowViews(rows: SeasonBatchMappingRow[], videos: Video[]): SeasonBatchRowView[] {
  const videosById = new Map(videos.map((video) => [video.id, video]));

  return [...rows]
    .sort(compareSeasonBatchRows)
    .map((row) => ({
      ...row,
      status: getSeasonBatchRowStatus(row),
      candidateCount: candidateVideosForBatchRow(row, videos).length,
      languageType: detectSubtitleLanguageType(`${row.entry.path} ${row.entry.fileName}`),
      format: normalizeSubtitleFormat(subtitleExtension(row.entry.fileName || row.entry.path)),
      targetVideo: videosById.get(row.selectedVideoId) ?? null
    }));
}

export function summarizeSeasonBatchRows(rows: SeasonBatchRowView[]) {
  const summary = {
    total: rows.length,
    auto: 0,
    manual: 0,
    mapped: 0,
    unassigned: 0,
    skipped: 0
  };

  for (const row of rows) {
    summary[row.status] += 1;
    if (row.status === "auto" || row.status === "manual") {
      summary.mapped += 1;
    }
  }

  return summary;
}

export function filterSeasonBatchRowViews(rows: SeasonBatchRowView[], filter: SeasonBatchMappingFilter) {
  if (filter === "all") {
    return rows;
  }

  if (filter === "pending") {
    return rows.filter((row) => row.status === "unassigned");
  }

  if (filter === "mapped") {
    return rows.filter((row) => row.status === "auto" || row.status === "manual");
  }

  return rows.filter((row) => row.status === "skipped");
}

export function detectSubtitleLanguageType(fileNameOrPath: string): DetectedBatchLanguageType {
  const text = fileNameOrPath.toLowerCase();

  if (/双语|bilingual|中英|简英|繁英|chs[._\-\s&+]*eng|eng[._\-\s&+]*chs|zh[._\-\s&+]*en|en[._\-\s&+]*zh/.test(text)) {
    return "bilingual";
  }

  if (/简体|简中|chs|gb|zh[-_.\s]?hans|sc\b/.test(text)) {
    return "simplified";
  }

  if (/繁体|繁中|cht|big5|zh[-_.\s]?hant|tc\b/.test(text)) {
    return "traditional";
  }

  if (/英文|english|\beng\b/.test(text)) {
    return "english";
  }

  if (/日语|日文|japanese|\bjpn\b/.test(text)) {
    return "japanese";
  }

  if (/韩语|韩文|korean|\bkor\b/.test(text)) {
    return "korean";
  }

  return "unknown";
}

export function applyBatchEntryPreferences(
  entries: ZipSubtitleEntry[],
  languagePreference: BatchLanguagePreference,
  formatPreference: string
) {
  const byEpisode = new Map<string, ZipSubtitleEntry[]>();
  const passthrough: ZipSubtitleEntry[] = [];

  for (const entry of entries) {
    const parsed = parseSeasonEpisode(`${entry.path} ${entry.fileName}`);
    if (!parsed) {
      passthrough.push(entry);
      continue;
    }
    const key = `${parsed.season}-${parsed.episode}`;
    const list = byEpisode.get(key) ?? [];
    list.push(entry);
    byEpisode.set(key, list);
  }

  const picked: ZipSubtitleEntry[] = [];
  let duplicateGroups = 0;
  for (const list of byEpisode.values()) {
    if (list.length > 1) {
      duplicateGroups += 1;
    }
    picked.push(choosePreferredEntry(list, languagePreference, formatPreference));
  }

  const merged = [...picked, ...passthrough];
  merged.sort((a, b) => a.path.localeCompare(b.path));

  return {
    entries: merged,
    duplicateGroups,
    reducedCount: Math.max(0, entries.length - merged.length)
  };
}

export function summarizeBatchInputs(files: File[], entryCount: number, t: TranslateFn) {
  const archiveCount = files.filter((file) => isArchiveFileName(file.name)).length;
  const subtitleCount = files.filter((file) => isSubtitleFileName(file.name)).length;
  const unsupportedCount = files.length - archiveCount - subtitleCount;
  const parts: string[] = [];
  if (archiveCount > 0) {
    parts.push(countSummaryLabel(archiveCount, t, "batch.summary.archive.one", "batch.summary.archive.other"));
  }
  if (subtitleCount > 0) {
    parts.push(countSummaryLabel(subtitleCount, t, "batch.summary.subtitle.one", "batch.summary.subtitle.other"));
  }
  if (unsupportedCount > 0) {
    parts.push(countSummaryLabel(unsupportedCount, t, "batch.summary.unsupported.one", "batch.summary.unsupported.other"));
  }

  const inputs = countSummaryLabel(files.length, t, "batch.summary.input.one", "batch.summary.input.other");
  const entries = countSummaryLabel(entryCount, t, "batch.summary.entry.one", "batch.summary.entry.other");
  return t("batch.summary.total", { inputs, parts: parts.join(", "), entries });
}

export function summarizeFileNames(names: string[], t: TranslateFn, maxVisible = 3) {
  if (names.length <= maxVisible) {
    return names.join(", ");
  }
  return `${names.slice(0, maxVisible).join(", ")} ${t("batch.summary.more", { count: names.length - maxVisible })}`;
}

export async function collectBatchEntriesFromFiles(files: File[]) {
  const entries: ZipSubtitleEntry[] = [];
  const unsupported: string[] = [];
  const archiveErrors: string[] = [];
  let index = 0;

  for (const file of files) {
    if (isArchiveFileName(file.name)) {
      let archiveEntries: ZipSubtitleEntry[] = [];
      try {
        archiveEntries = await extractSubtitleEntriesFromArchiveFile(file);
      } catch (error) {
        const errText = error instanceof Error ? error.message : String(error);
        archiveErrors.push(`${file.name} (${errText})`);
        continue;
      }

      if (archiveEntries.length === 0) {
        archiveErrors.push(`${file.name} (no subtitle files in archive)`);
        continue;
      }

      for (const entry of archiveEntries) {
        entries.push({
          id: `batch-${index}-${entry.id}`,
          path: `${file.name}/${entry.path}`,
          fileName: entry.fileName,
          size: entry.size,
          data: entry.data
        });
        index += 1;
      }
      continue;
    }

    if (isSubtitleFileName(file.name)) {
      const data = await file.arrayBuffer();
      entries.push({
        id: `batch-${index}-${file.name.toLowerCase()}`,
        path: file.name,
        fileName: file.name,
        size: data.byteLength,
        data
      });
      index += 1;
      continue;
    }

    unsupported.push(file.name);
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { entries, unsupported, archiveErrors };
}
