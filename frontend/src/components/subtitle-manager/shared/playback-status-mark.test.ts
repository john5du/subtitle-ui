import { describe, expect, test } from "bun:test";

import { playbackStatus } from "./playback-status-mark";

describe("playbackStatus", () => {
  test("played wins", () => {
    expect(playbackStatus({ played: true, inProgress: true })).toBe("played");
  });

  test("in progress", () => {
    expect(playbackStatus({ played: false, inProgress: true })).toBe("inProgress");
  });

  test("hidden when empty", () => {
    expect(playbackStatus(undefined)).toBeNull();
    expect(playbackStatus({ played: false, inProgress: false })).toBeNull();
  });
});
