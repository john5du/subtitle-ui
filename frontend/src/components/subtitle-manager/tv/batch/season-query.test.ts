import { describe, expect, test } from "bun:test";

import { parseSeasonNumber, scoreSeasonPackResult } from "./season-query";

describe("parseSeasonNumber", () => {
  test("parses season tokens", () => {
    expect(parseSeasonNumber("S01")).toBe(1);
    expect(parseSeasonNumber("Season 12")).toBe(12);
    expect(parseSeasonNumber("")).toBe(-1);
    expect(parseSeasonNumber(undefined)).toBe(-1);
  });
});

describe("scoreSeasonPackResult", () => {
  test("prefers installable season packs", () => {
    const pack = {
      sid: "1",
      title: "Show S01 合集",
      version: "简英双语",
      format: "zip",
      langs: ["简体", "英语"],
      installable: true
    };
    const mono = {
      sid: "2",
      title: "Show S01E01",
      version: "",
      format: "sup",
      langs: [],
      installable: true
    };
    const blocked = { ...pack, sid: "3", installable: false };
    expect(scoreSeasonPackResult(pack, 1)).toBeGreaterThan(scoreSeasonPackResult(mono, 1));
    expect(scoreSeasonPackResult(blocked, 1)).toBeLessThan(0);
  });
});
