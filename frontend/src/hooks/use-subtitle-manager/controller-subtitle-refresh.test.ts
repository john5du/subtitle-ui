import { describe, expect, test } from "bun:test";

import { adjustSeriesNoSubtitleCount, isVideoUnderSeriesPath } from "./controller-subtitle-refresh";

describe("adjustSeriesNoSubtitleCount", () => {
  test("increments when video gains first subtitle", () => {
    expect(adjustSeriesNoSubtitleCount(2, 0, 1)).toBe(3);
  });

  test("decrements when video loses all subtitles", () => {
    expect(adjustSeriesNoSubtitleCount(2, 1, 0)).toBe(1);
  });

  test("stays when count does not cross zero", () => {
    expect(adjustSeriesNoSubtitleCount(2, 2, 3)).toBe(2);
  });
});

describe("isVideoUnderSeriesPath", () => {
  test("matches series root and nested episode dirs", () => {
    expect(isVideoUnderSeriesPath("/tv/Show", "/tv/Show")).toBe(true);
    expect(isVideoUnderSeriesPath("/tv/Show/Season 01", "/tv/Show")).toBe(true);
    expect(isVideoUnderSeriesPath("/tv/Other", "/tv/Show")).toBe(false);
  });
});
