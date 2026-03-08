import JSZip from "jszip";

const ALLOWED_SUBTITLE_EXTENSIONS = new Set([".srt", ".ass", ".ssa", ".vtt", ".sub"]);

export interface ZipSubtitleEntry {
  id: string;
  path: string;
  fileName: string;
  size: number;
  data: ArrayBuffer;
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

export function isZipFileName(fileName: string) {
  return fileName.toLowerCase().endsWith(".zip");
}

export async function extractSubtitleEntriesFromZip(file: File): Promise<ZipSubtitleEntry[]> {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const entries: ZipSubtitleEntry[] = [];
  let index = 0;

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || !isSubtitleFileName(path)) {
      continue;
    }

    const cleaned = path.replace(/\\/g, "/").replace(/^\/+/, "");
    const segments = cleaned.split("/").filter(Boolean);
    const fileName = segments.length > 0 ? segments[segments.length - 1] : cleaned;
    if (!fileName) {
      continue;
    }

    const data = await entry.async("arraybuffer");
    entries.push({
      id: `${index}-${cleaned.toLowerCase()}`,
      path: cleaned,
      fileName,
      size: data.byteLength,
      data
    });
    index += 1;
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}

export function toSubtitleFile(entry: ZipSubtitleEntry): File {
  return new File([entry.data], entry.fileName, { type: "application/octet-stream" });
}
