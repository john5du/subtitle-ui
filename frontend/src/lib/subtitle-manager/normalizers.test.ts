import { describe, expect, test } from "bun:test";

import { normalizePlayback, normalizeVideo } from "./normalizers";

describe("normalizePlayback", () => {
  test("returns undefined for missing or empty", () => {
    expect(normalizePlayback(undefined)).toBeUndefined();
    expect(normalizePlayback(null)).toBeUndefined();
    expect(normalizePlayback({})).toBeUndefined();
    expect(normalizePlayback({ played: false, inProgress: false })).toBeUndefined();
  });

  test("played wins over inProgress", () => {
    expect(normalizePlayback({ played: true, inProgress: true })).toEqual({
      played: true,
      inProgress: false
    });
  });

  test("in progress only", () => {
    expect(normalizePlayback({ played: false, inProgress: true })).toEqual({
      played: false,
      inProgress: true
    });
  });
});

describe("normalizeVideo playback", () => {
  test("attaches playback from payload", () => {
    const video = normalizeVideo({
      id: "v1",
      path: "/m/a.mkv",
      directory: "/m",
      fileName: "a.mkv",
      title: "A",
      mediaType: "movie",
      metadataSource: "nfo",
      subtitles: [],
      updatedAt: "2026-01-01T00:00:00Z",
      playback: { played: true, inProgress: false }
    });
    expect(video.playback).toEqual({ played: true, inProgress: false });
  });

  test("omits playback when absent", () => {
    const video = normalizeVideo({
      id: "v1",
      path: "/m/a.mkv",
      directory: "/m",
      fileName: "a.mkv",
      title: "A",
      mediaType: "movie",
      metadataSource: "nfo",
      subtitles: [],
      updatedAt: "2026-01-01T00:00:00Z"
    });
    expect(video.playback).toBeUndefined();
  });
});
