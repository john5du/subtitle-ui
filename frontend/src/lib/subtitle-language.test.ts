import { describe, expect, test } from "bun:test";

import {
  detectSubtitleLanguageType,
  formatSubtitleLanguageLabel,
  inferUploadLanguageLabel,
  isBilingualLanguage
} from "./subtitle-language";

describe("isBilingualLanguage", () => {
  test("detects ampersand bilingual labels", () => {
    expect(isBilingualLanguage("zh&en")).toBe(true);
    expect(isBilingualLanguage("zh-hant&en")).toBe(true);
  });

  test("detects legacy dash bilingual labels", () => {
    expect(isBilingualLanguage("zh-en")).toBe(true);
    expect(isBilingualLanguage("en-zh")).toBe(true);
  });

  test("rejects mono and empty labels", () => {
    expect(isBilingualLanguage("zh")).toBe(false);
    expect(isBilingualLanguage("zh-hant")).toBe(false);
    expect(isBilingualLanguage("en")).toBe(false);
    expect(isBilingualLanguage("")).toBe(false);
    expect(isBilingualLanguage("und")).toBe(false);
  });
});

describe("formatSubtitleLanguageLabel", () => {
  test("normalizes common mono tags", () => {
    expect(formatSubtitleLanguageLabel("chs")).toBe("zh");
    expect(formatSubtitleLanguageLabel("cht")).toBe("zh-hant");
    expect(formatSubtitleLanguageLabel("eng")).toBe("en");
  });

  test("keeps bilingual labels lowercase", () => {
    expect(formatSubtitleLanguageLabel("ZH&EN")).toBe("zh&en");
  });
});

describe("detectSubtitleLanguageType", () => {
  test("accepts both 英语 and 英文", () => {
    expect(detectSubtitleLanguageType("英语.srt")).toBe("english");
    expect(detectSubtitleLanguageType("英文.srt")).toBe("english");
    expect(detectSubtitleLanguageType("Show.en.srt")).toBe("english");
  });
});

describe("inferUploadLanguageLabel", () => {
  test("infers bilingual and mono from filenames", () => {
    expect(inferUploadLanguageLabel("Show.S01E01.chs&eng.ass")).toBe("zh&en");
    expect(inferUploadLanguageLabel("中英双语.ass")).toBe("zh&en");
    expect(inferUploadLanguageLabel("简体中文.srt")).toBe("zh");
    expect(inferUploadLanguageLabel("繁体.srt")).toBe("zh-hant");
    expect(inferUploadLanguageLabel("English.srt")).toBe("en");
  });

  test("defaults to zh when unknown", () => {
    expect(inferUploadLanguageLabel("episode.srt")).toBe("zh");
  });
});
