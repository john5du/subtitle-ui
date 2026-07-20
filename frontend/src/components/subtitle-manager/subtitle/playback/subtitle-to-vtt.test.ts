import { describe, expect, test } from "bun:test";

import { cuesToWebVtt, formatVttTimestamp, parseSubtitleCues } from "./subtitle-to-vtt";

describe("formatVttTimestamp", () => {
  test("formats ms", () => {
    expect(formatVttTimestamp(0)).toBe("00:00:00.000");
    expect(formatVttTimestamp(1500)).toBe("00:00:01.500");
    expect(formatVttTimestamp(3_661_234)).toBe("01:01:01.234");
  });
});

describe("parseSubtitleCues", () => {
  test("parses srt", () => {
    const srt = `1
00:00:01,000 --> 00:00:02,500
hello
world

2
00:00:03,000 --> 00:00:04,000
next
`;
    const cues = parseSubtitleCues(srt, "srt");
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ startMs: 1000, endMs: 2500, text: "hello\nworld" });
    expect(cues[1].text).toBe("next");
  });

  test("parses ass dialogue", () => {
    const ass = `[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,hello{\\i1}world
`;
    const cues = parseSubtitleCues(ass, "ass");
    expect(cues).toHaveLength(1);
    expect(cues[0].startMs).toBe(1000);
    expect(cues[0].endMs).toBe(2500);
    expect(cues[0].text).toBe("helloworld");
  });

  test("parses microdvd sub", () => {
    const sub = `{0}{25}hello
{50}{75}world|line2
`;
    const cues = parseSubtitleCues(sub, "sub");
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ startMs: 0, endMs: 1000, text: "hello" });
    expect(cues[1].text).toBe("world\nline2");
    expect(cues[1].startMs).toBe(2000);
  });
});

describe("cuesToWebVtt", () => {
  test("emits header and cues", () => {
    const vtt = cuesToWebVtt([{ startMs: 1000, endMs: 2000, text: "hi" }]);
    expect(vtt.startsWith("WEBVTT")).toBe(true);
    expect(vtt).toContain("00:00:01.000 --> 00:00:02.000");
    expect(vtt).toContain("hi");
  });
});
