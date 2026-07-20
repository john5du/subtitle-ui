import { describe, expect, test } from "bun:test";

import type { Video } from "@/lib/types";
import type { ZipSubtitleEntry } from "@/lib/subtitle-zip";

import type { SeasonBatchMappingRow } from "../types";
import {
  applyBatchEntryPreferences,
  buildSeasonBatchRows,
  buildSeasonBatchRowsFromSubHDSuggestions,
  detectSubtitleLanguageType,
  filterSeasonBatchRowViews,
  getSeasonBatchRowStatus
} from "./batch-utils";

function makeVideo(partial: Partial<Video> & Pick<Video, "id" | "fileName">): Video {
  return {
    path: `/tv/Show/${partial.fileName}`,
    directory: "/tv/Show",
    title: partial.title || "Show",
    originalTitle: "",
    year: "2024",
    imdbId: "",
    tmdbId: "",
    mediaType: "tv",
    metadataSource: "nfo",
    seriesTitle: "Show",
    seriesOriginalTitle: "Show",
    seriesImdbId: "",
    seriesTmdbId: "",
    posterUrl: "",
    updatedAt: "",
    subtitles: [],
    ...partial
  };
}

function makeEntry(partial: Partial<ZipSubtitleEntry> & Pick<ZipSubtitleEntry, "id" | "path" | "fileName">): ZipSubtitleEntry {
  return {
    size: 10,
    ...partial
  };
}

describe("detectSubtitleLanguageType", () => {
  test("classifies common filename patterns", () => {
    expect(detectSubtitleLanguageType("中英双语.ass")).toBe("bilingual");
    expect(detectSubtitleLanguageType("Show.chs&eng.srt")).toBe("bilingual");
    expect(detectSubtitleLanguageType("简体.srt")).toBe("simplified");
    expect(detectSubtitleLanguageType("繁体.srt")).toBe("traditional");
    expect(detectSubtitleLanguageType("English.srt")).toBe("english");
    expect(detectSubtitleLanguageType("unknown.srt")).toBe("unknown");
  });
});

describe("getSeasonBatchRowStatus", () => {
  const base: SeasonBatchMappingRow = {
    id: "1",
    entry: makeEntry({ id: "1", path: "S01E01.ass", fileName: "S01E01.ass" }),
    season: 1,
    episode: 1,
    autoVideoId: "v1",
    selectedVideoId: "v1",
    skipped: false
  };

  test("returns status for skipped, unassigned, auto, manual", () => {
    expect(getSeasonBatchRowStatus({ ...base, skipped: true })).toBe("skipped");
    expect(getSeasonBatchRowStatus({ ...base, selectedVideoId: "" })).toBe("unassigned");
    expect(getSeasonBatchRowStatus(base)).toBe("auto");
    expect(getSeasonBatchRowStatus({ ...base, selectedVideoId: "v2" })).toBe("manual");
  });
});

describe("buildSeasonBatchRows", () => {
  test("auto-maps unique episode matches", () => {
    const videos = [
      makeVideo({ id: "v1", fileName: "Show.S01E01.mkv" }),
      makeVideo({ id: "v2", fileName: "Show.S01E02.mkv" })
    ];
    const entries = [
      makeEntry({ id: "e1", path: "S01E01.chs.ass", fileName: "S01E01.chs.ass" }),
      makeEntry({ id: "e2", path: "S01E02.chs.ass", fileName: "S01E02.chs.ass" }),
      makeEntry({ id: "e3", path: "extra.ass", fileName: "extra.ass" })
    ];

    const rows = buildSeasonBatchRows(videos, entries, 1);
    expect(rows).toHaveLength(3);
    expect(rows[0].autoVideoId).toBe("v1");
    expect(rows[0].selectedVideoId).toBe("v1");
    expect(rows[1].autoVideoId).toBe("v2");
    expect(rows[2].autoVideoId).toBe("");
    expect(rows[2].selectedVideoId).toBe("");
  });
});

describe("filterSeasonBatchRowViews", () => {
  test("filters by status buckets", () => {
    const rows = [
      {
        id: "1",
        entry: makeEntry({ id: "1", path: "a.ass", fileName: "a.ass" }),
        season: 1,
        episode: 1,
        autoVideoId: "v1",
        selectedVideoId: "v1",
        skipped: false,
        status: "auto" as const,
        candidateCount: 1,
        languageType: "unknown" as const,
        format: ".ass",
        targetVideo: null
      },
      {
        id: "2",
        entry: makeEntry({ id: "2", path: "b.ass", fileName: "b.ass" }),
        season: 1,
        episode: 2,
        autoVideoId: "",
        selectedVideoId: "",
        skipped: false,
        status: "unassigned" as const,
        candidateCount: 1,
        languageType: "unknown" as const,
        format: ".ass",
        targetVideo: null
      },
      {
        id: "3",
        entry: makeEntry({ id: "3", path: "c.ass", fileName: "c.ass" }),
        season: 1,
        episode: 3,
        autoVideoId: "",
        selectedVideoId: "",
        skipped: true,
        status: "skipped" as const,
        candidateCount: 1,
        languageType: "unknown" as const,
        format: ".ass",
        targetVideo: null
      }
    ];

    expect(filterSeasonBatchRowViews(rows, "all")).toHaveLength(3);
    expect(filterSeasonBatchRowViews(rows, "pending")).toHaveLength(1);
    expect(filterSeasonBatchRowViews(rows, "mapped")).toHaveLength(1);
    expect(filterSeasonBatchRowViews(rows, "skipped")).toHaveLength(1);
  });
});

describe("applyBatchEntryPreferences", () => {
  test("picks preferred language/format per episode group", () => {
    const entries = [
      makeEntry({ id: "1", path: "S01E01.chs.srt", fileName: "S01E01.chs.srt" }),
      makeEntry({ id: "2", path: "S01E01.chs&eng.ass", fileName: "S01E01.chs&eng.ass" }),
      makeEntry({ id: "3", path: "S01E02.chs.ass", fileName: "S01E02.chs.ass" })
    ];

    const result = applyBatchEntryPreferences(entries, "bilingual", ".ass");
    expect(result.duplicateGroups).toBe(1);
    expect(result.reducedCount).toBe(1);
    expect(result.entries).toHaveLength(2);
    expect(result.entries.some((e) => e.fileName.includes("chs&eng"))).toBe(true);
  });
});

describe("buildSeasonBatchRowsFromSubHDSuggestions", () => {
  test("trusts server auto-map and skip flags", () => {
    const entries = [
      makeEntry({ id: "e1", path: "pack/S01E01.chs&eng.ass", fileName: "S01E01.chs&eng.ass", archiveEntry: "S01E01.chs&eng.ass" }),
      makeEntry({ id: "e2", path: "pack/S01E01.chs.srt", fileName: "S01E01.chs.srt", archiveEntry: "S01E01.chs.srt" }),
      makeEntry({ id: "e3", path: "pack/readme.txt.ass", fileName: "readme.txt.ass", archiveEntry: "readme.txt.ass" })
    ];

    const rows = buildSeasonBatchRowsFromSubHDSuggestions(
      entries,
      [
        { videoId: "v1", archiveEntry: "S01E01.chs&eng.ass" },
        { videoId: "v2", archiveEntry: "S01E02.chs.ass", skipped: true }
      ],
      1
    );

    expect(rows).toHaveLength(3);
    expect(rows[0].selectedVideoId).toBe("v1");
    expect(rows[0].autoVideoId).toBe("v1");
    expect(rows[0].skipped).toBe(false);
    expect(rows[1].skipped).toBe(true);
    expect(rows[1].selectedVideoId).toBe("");
    // Non-preferred S01E01.chs.srt is hidden; unparsed leftover stays for manual map.
    expect(rows[2].entry.fileName).toBe("readme.txt.ass");
    expect(rows[2].selectedVideoId).toBe("");
  });
});
