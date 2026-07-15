import { describe, expect, test } from "bun:test";

import {
  clampPage,
  clampPageSize,
  resolveTvInitialPath,
  resolveTvWorkspacePath
} from "./workspace-path";

describe("resolveTvInitialPath", () => {
  test("prefers matching series row path", () => {
    const path = resolveTvInitialPath({
      seriesRows: [{ path: "/tv/Show A" }, { path: "/tv/Show B" }],
      selectedPath: "/tv/Show B/",
      defaultDir: "/tv",
      tvRoot: "/media/tv"
    });
    expect(path).toBe("/tv/Show B");
  });

  test("falls back to first series then defaults", () => {
    expect(
      resolveTvInitialPath({
        seriesRows: [{ path: "/tv/First" }],
        selectedPath: "",
        defaultDir: "/tv",
        tvRoot: "/media/tv"
      })
    ).toBe("/tv/First");
    expect(
      resolveTvInitialPath({
        seriesRows: [],
        selectedPath: "",
        defaultDir: "",
        tvRoot: "/media/tv"
      })
    ).toBe("/media/tv");
  });
});

describe("resolveTvWorkspacePath", () => {
  test("resolves requested path through series rows", () => {
    const path = resolveTvWorkspacePath({
      seriesRows: [{ path: "/tv/Alpha" }, { path: "/tv/Beta" }],
      requestedPath: "/tv/beta",
      selectedPath: "/tv/Alpha",
      tvRoot: "/tv"
    });
    expect(path).toBe("/tv/Beta");
  });
});

describe("clampPage / clampPageSize", () => {
  test("clamps pages", () => {
    expect(clampPage(2, 5, 1)).toBe(2);
    expect(clampPage(1, 5, 1)).toBeNull();
    expect(clampPage(9, 3, 1)).toBeNull();
    expect(clampPage(0, 3, 1)).toBeNull();
  });

  test("clamps page size", () => {
    expect(clampPageSize(50, 20)).toBe(50);
    expect(clampPageSize(20, 20)).toBeNull();
    expect(clampPageSize(999, 20)).toBe(200);
    expect(clampPageSize(0.4, 20)).toBe(1);
    expect(clampPageSize(Number.NaN, 20)).toBeNull();
  });
});
