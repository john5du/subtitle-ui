import type { Subtitle } from "@/lib/types";

export const ACCEPTED_SUBTITLE_UPLOAD_TYPES = ".srt,.ass,.ssa,.vtt,.sub,.zip,.7z,.rar";

export function isSRTFileName(fileName: string) {
  return fileName.toLowerCase().endsWith(".srt");
}

export function isSRTSubtitle(subtitle: Subtitle) {
  return subtitle.format.toLowerCase() === "srt" || isSRTFileName(subtitle.fileName);
}

export function isTimingOffsetSupported(subtitle: Subtitle) {
  const format = subtitle.format.toLowerCase();
  const fileName = subtitle.fileName.toLowerCase();
  return (
    format === "srt" ||
    format === "vtt" ||
    format === "ass" ||
    format === "ssa" ||
    fileName.endsWith(".srt") ||
    fileName.endsWith(".vtt") ||
    fileName.endsWith(".ass") ||
    fileName.endsWith(".ssa")
  );
}

export function formatSubtitleSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) {
    return "-";
  }

  if (size < 1024) {
    return `${Math.round(size)} B`;
  }

  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}
