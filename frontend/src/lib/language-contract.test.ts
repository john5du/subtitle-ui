import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { detectSubtitleLanguageType, inferUploadLanguageLabel, isBilingualLanguage } from "@/lib/subtitle-language";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function loadFixture<T>(name: string): T[] {
  const path = join(root, "testdata", "language", name);
  return JSON.parse(readFileSync(path, "utf8")) as T[];
}

describe("language contract fixtures (shared with Go)", () => {
  test("bilingual_flags.json", () => {
    const rows = loadFixture<{ input: string; want: boolean }>("bilingual_flags.json");
    for (const row of rows) {
      expect(isBilingualLanguage(row.input), row.input).toBe(row.want);
    }
  });

  test("detect_type.json", () => {
    const rows = loadFixture<{ input: string; want: string }>("detect_type.json");
    for (const row of rows) {
      expect(detectSubtitleLanguageType(row.input) as string, row.input).toBe(row.want);
    }
  });

  test("name_labels.json", () => {
    const rows = loadFixture<{ input: string; wantLabel: string }>("name_labels.json");
    for (const row of rows) {
      expect(inferUploadLanguageLabel(row.input), row.input).toBe(row.wantLabel);
    }
  });
});
