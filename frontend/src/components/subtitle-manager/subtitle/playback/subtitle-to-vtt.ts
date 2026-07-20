export interface SubtitleCue {
  startMs: number;
  endMs: number;
  text: string;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function pad3(n: number) {
  return String(n).padStart(3, "0");
}

/** WebVTT timestamp: HH:MM:SS.mmm */
export function formatVttTimestamp(ms: number) {
  const total = Math.max(0, Math.floor(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}.${pad3(millis)}`;
}

function parseTimingToken(raw: string): number | null {
  const cleaned = raw.trim().replace(",", ".");
  // H:MM:SS.mmm or MM:SS.mmm
  const parts = cleaned.split(":");
  if (parts.length < 2 || parts.length > 3) {
    return null;
  }
  let hours = 0;
  let minutes = 0;
  let secondsPart = "";
  if (parts.length === 3) {
    hours = Number(parts[0]);
    minutes = Number(parts[1]);
    secondsPart = parts[2];
  } else {
    minutes = Number(parts[0]);
    secondsPart = parts[1];
  }
  const secBits = secondsPart.split(".");
  const seconds = Number(secBits[0]);
  let millis = 0;
  if (secBits[1] != null && secBits[1] !== "") {
    const frac = secBits[1].slice(0, 3).padEnd(3, "0");
    millis = Number(frac);
  }
  if (![hours, minutes, seconds, millis].every((n) => Number.isFinite(n))) {
    return null;
  }
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
}

const ARROW_LINE = /^(.+?)\s*-->\s*(.+?)(?:\s+.*)?$/;

function parseSrtOrVttCues(text: string): SubtitleCue[] {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.split(/\n\n+/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trimEnd()).filter((l, i, arr) => {
      // keep empty lines inside cue text only if not leading/trailing — simplify: drop empty
      return l.trim() !== "" || (i > 0 && i < arr.length - 1);
    });
    if (lines.length === 0) {
      continue;
    }
    let idx = 0;
    // skip WEBVTT header / NOTE / STYLE
    const first = lines[0].trim();
    if (/^WEBVTT/i.test(first) || /^NOTE\b/i.test(first) || /^STYLE\b/i.test(first) || /^REGION\b/i.test(first)) {
      continue;
    }
    // optional numeric cue id
    if (/^\d+$/.test(first) && lines.length > 1) {
      idx = 1;
    }
    const timeLine = lines[idx]?.trim() ?? "";
    const match = timeLine.match(ARROW_LINE);
    if (!match) {
      continue;
    }
    // strip optional settings after end time (already handled by regex group 2 split)
    const startRaw = match[1].trim().split(/\s+/)[0] ?? "";
    const endRaw = match[2].trim().split(/\s+/)[0] ?? "";
    const startMs = parseTimingToken(startRaw);
    const endMs = parseTimingToken(endRaw);
    if (startMs == null || endMs == null || endMs <= startMs) {
      continue;
    }
    const textLines = lines.slice(idx + 1).map((l) => l.trim()).filter(Boolean);
    if (textLines.length === 0) {
      continue;
    }
    cues.push({
      startMs,
      endMs,
      text: textLines.join("\n")
    });
  }
  return cues;
}

/** ASS/SSA Dialogue times: H:MM:SS.cs (centiseconds) */
function parseAssTime(raw: string): number | null {
  const match = raw.trim().match(/^(\d+):(\d{2}):(\d{2})\.(\d{1,2})$/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const frac = match[4].padEnd(2, "0").slice(0, 2);
  const centis = Number(frac);
  if (![hours, minutes, seconds, centis].every((n) => Number.isFinite(n))) {
    return null;
  }
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + centis * 10;
}

function stripAssOverrides(text: string) {
  return text
    .replace(/\{[^}]*\}/g, "")
    .replace(/\\[nN]/g, "\n")
    .replace(/\\h/g, " ")
    .trim();
}

function parseAssCues(text: string): SubtitleCue[] {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const cues: SubtitleCue[] = [];
  for (const line of normalized.split("\n")) {
    const trimmed = line.trim();
    if (!/^dialogue\s*:/i.test(trimmed)) {
      continue;
    }
    const payload = trimmed.replace(/^dialogue\s*:\s*/i, "");
    // Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
    const parts = payload.split(",");
    if (parts.length < 10) {
      continue;
    }
    const startMs = parseAssTime(parts[1] ?? "");
    const endMs = parseAssTime(parts[2] ?? "");
    if (startMs == null || endMs == null || endMs <= startMs) {
      continue;
    }
    const dialogue = stripAssOverrides(parts.slice(9).join(","));
    if (!dialogue) {
      continue;
    }
    cues.push({ startMs, endMs, text: dialogue });
  }
  return cues;
}

/** MicroDVD: {startFrame}{endFrame}text — default 25 fps when fps unknown. */
function parseMicroDVDCues(text: string, fps = 25): SubtitleCue[] {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lineRe = /^\{(\d+)\}\{(\d+)\}(.*)$/;
  const cues: SubtitleCue[] = [];
  const safeFps = fps > 0 ? fps : 25;
  for (const line of normalized.split("\n")) {
    const match = line.trim().match(lineRe);
    if (!match) {
      continue;
    }
    const startFrame = Number(match[1]);
    const endFrame = Number(match[2]);
    if (!Number.isFinite(startFrame) || !Number.isFinite(endFrame) || endFrame <= startFrame) {
      continue;
    }
    const dialogue = (match[3] ?? "").replace(/\|/g, "\n").trim();
    if (!dialogue) {
      continue;
    }
    cues.push({
      startMs: Math.round((startFrame / safeFps) * 1000),
      endMs: Math.round((endFrame / safeFps) * 1000),
      text: dialogue
    });
  }
  return cues;
}

export function isPlaybackSubtitleFormatSupported(format: string): boolean {
  const fmt = format.toLowerCase().replace(/^\./, "");
  return fmt === "srt" || fmt === "vtt" || fmt === "ass" || fmt === "ssa" || fmt === "sub";
}

export function parseSubtitleCues(text: string, format: string): SubtitleCue[] {
  const fmt = format.toLowerCase().replace(/^\./, "");
  if (fmt === "ass" || fmt === "ssa") {
    return parseAssCues(text);
  }
  if (fmt === "sub") {
    const micro = parseMicroDVDCues(text);
    if (micro.length > 0) {
      return micro;
    }
    // Some .sub files are SRT-like; fall through.
  }
  return parseSrtOrVttCues(text);
}

export function cuesToWebVtt(cues: SubtitleCue[]): string {
  const lines = ["WEBVTT", ""];
  cues.forEach((cue, index) => {
    lines.push(String(index + 1));
    lines.push(`${formatVttTimestamp(cue.startMs)} --> ${formatVttTimestamp(cue.endMs)}`);
    lines.push(cue.text);
    lines.push("");
  });
  return lines.join("\n");
}

export function subtitleTextToVttBlobUrl(text: string, format: string): string | null {
  const cues = parseSubtitleCues(text, format);
  if (cues.length === 0) {
    return null;
  }
  const vtt = cuesToWebVtt(cues);
  const blob = new Blob([vtt], { type: "text/vtt" });
  return URL.createObjectURL(blob);
}
