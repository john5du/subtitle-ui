import { afterEach, describe, expect, test } from "bun:test";

import {
  getJellyfinEnabledState,
  invalidateJellyfinEnabled,
  setJellyfinEnabledCache
} from "./use-jellyfin-enabled";

describe("jellyfin enabled cache", () => {
  afterEach(() => {
    invalidateJellyfinEnabled();
  });

  test("setJellyfinEnabledCache marks loaded and stores enabled", () => {
    setJellyfinEnabledCache(true);
    expect(getJellyfinEnabledState()).toEqual({ enabled: true, loaded: true });

    setJellyfinEnabledCache(false);
    expect(getJellyfinEnabledState()).toEqual({ enabled: false, loaded: true });
  });

  test("invalidateJellyfinEnabled clears loaded flag so fetch can retry", () => {
    setJellyfinEnabledCache(true);
    invalidateJellyfinEnabled();
    expect(getJellyfinEnabledState()).toEqual({ enabled: false, loaded: false });
  });
});
