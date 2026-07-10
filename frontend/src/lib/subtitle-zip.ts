import { requestBinary, requestPayload } from "@/lib/subtitle-manager/api-client";
import type { ArchiveEntryMeta } from "@/lib/types";

const ALLOWED_SUBTITLE_EXTENSIONS = new Set([".srt", ".ass", ".ssa", ".vtt", ".sub"]);
const ALLOWED_ARCHIVE_EXTENSIONS = new Set([".zip", ".7z", ".rar"]);

export interface ZipSubtitleEntry {
  id: string;
  path: string;
  fileName: string;
  size: number;
  /** Original archive file when entry comes from a server-listed archive. */
  sourceFile?: File;
  /** Path inside the archive (server extract/upload key). */
  archiveEntry?: string;
  /** Plain subtitle file when not from an archive. */
  plainFile?: File;
  /** SubHD season-pack cache token (server-side download cache). */
  cacheToken?: string;
}

function normalizePath(pathValue: string) {
  return pathValue.replace(/\\/g, "/").replace(/^\/+/, "");
}

function basenamePath(pathValue: string) {
  const cleaned = normalizePath(pathValue);
  const segments = cleaned.split("/").filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : cleaned;
}

function archiveExtension(fileName: string) {
  const lower = fileName.toLowerCase();
  for (const ext of ALLOWED_ARCHIVE_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return ext;
    }
  }
  return "";
}

export function isSubtitleFileName(fileName: string) {
  const lower = fileName.toLowerCase();
  for (const ext of ALLOWED_SUBTITLE_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return true;
    }
  }
  return false;
}

export function isArchiveFileName(fileName: string) {
  return archiveExtension(fileName) !== "";
}

export async function listArchiveSubtitleEntries(file: File): Promise<ZipSubtitleEntry[]> {
  const body = new FormData();
  body.append("file", file);
  const payload = await requestPayload<{ entries?: ArchiveEntryMeta[] }>("/api/archives/subtitle-entries", {
    method: "POST",
    body
  });
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  return entries
    .map((entry, index) => {
      const pathValue = normalizePath(entry.path || entry.fileName || "");
      const fileName = entry.fileName || basenamePath(pathValue);
      return {
        id: `${index}-${pathValue.toLowerCase()}`,
        path: pathValue,
        fileName,
        size: Number(entry.size) || 0,
        sourceFile: file,
        archiveEntry: pathValue
      } satisfies ZipSubtitleEntry;
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

export async function extractArchiveSubtitleEntry(file: File, entryPath: string): Promise<ArrayBuffer> {
  const body = new FormData();
  body.append("file", file);
  body.append("entry", entryPath);
  return requestBinary("/api/archives/extract", { method: "POST", body });
}
