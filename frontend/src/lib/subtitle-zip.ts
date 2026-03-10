import JSZip from "jszip";

const ALLOWED_SUBTITLE_EXTENSIONS = new Set([".srt", ".ass", ".ssa", ".vtt", ".sub"]);
const ALLOWED_ARCHIVE_EXTENSIONS = new Set([".zip", ".7z", ".rar"]);
const ENCRYPTED_ARCHIVE_ERROR = "Encrypted archive is not supported.";

interface ArchiveReaderLike {
  close: () => Promise<void>;
  extractFiles: (extractCallback?: (entry: { file?: File; path?: string }) => void) => Promise<unknown>;
  hasEncryptedData: () => Promise<boolean | null>;
}

interface ArchiveClassLike {
  init: (options?: { workerUrl?: string | URL }) => unknown;
  open: (file: File) => Promise<ArchiveReaderLike>;
}

let archiveClassPromise: Promise<ArchiveClassLike> | null = null;

export interface ZipSubtitleEntry {
  id: string;
  path: string;
  fileName: string;
  size: number;
  data: ArrayBuffer;
}

function normalizePath(pathValue: string) {
  return pathValue.replace(/\\/g, "/").replace(/^\/+/, "");
}

function basenamePath(pathValue: string) {
  const cleaned = normalizePath(pathValue);
  const segments = cleaned.split("/").filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : cleaned;
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

function archiveExtension(fileName: string) {
  const lower = fileName.toLowerCase();
  for (const ext of ALLOWED_ARCHIVE_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return ext;
    }
  }
  return "";
}

export function isArchiveFileName(fileName: string) {
  return archiveExtension(fileName) !== "";
}

function normalizeArchiveReadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("encrypted") || lower.includes("passphrase") || lower.includes("password")) {
    return new Error(ENCRYPTED_ARCHIVE_ERROR);
  }
  return new Error(message);
}

async function loadArchiveClass(): Promise<ArchiveClassLike> {
  if (!archiveClassPromise) {
    archiveClassPromise = (async () => {
      const modulePath = "/libarchive/libarchive.js";
      const mod = (await import(
        /* webpackIgnore: true */
        modulePath
      )) as { Archive?: ArchiveClassLike };

      if (!mod.Archive) {
        throw new Error("Archive parser is not available.");
      }

      mod.Archive.init({ workerUrl: "/libarchive/worker-bundle.js" });
      return mod.Archive;
    })();
  }
  return archiveClassPromise;
}

async function extractSubtitleEntriesFromZip(file: File): Promise<ZipSubtitleEntry[]> {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const entries: ZipSubtitleEntry[] = [];
  let index = 0;

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || !isSubtitleFileName(path)) {
      continue;
    }

    const cleaned = normalizePath(path);
    const fileName = basenamePath(cleaned);
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

async function extractSubtitleEntriesFromArchive(file: File): Promise<ZipSubtitleEntry[]> {
  const archiveClass = await loadArchiveClass();
  const archive = await archiveClass.open(file);
  try {
    const hasEncryptedData = await archive.hasEncryptedData();
    if (hasEncryptedData === true) {
      throw new Error(ENCRYPTED_ARCHIVE_ERROR);
    }

    const entries: ZipSubtitleEntry[] = [];
    const pending: Promise<void>[] = [];
    let index = 0;

    await archive.extractFiles((entry: { file?: File; path?: string }) => {
      const rawPath = typeof entry.path === "string" ? entry.path : "";
      const cleaned = normalizePath(rawPath);
      if (!cleaned || !isSubtitleFileName(cleaned) || !(entry.file instanceof File)) {
        return;
      }

      const fileName = basenamePath(cleaned);
      if (!fileName) {
        return;
      }

      const id = `${index}-${cleaned.toLowerCase()}`;
      index += 1;
      pending.push(
        entry.file.arrayBuffer().then((data) => {
          entries.push({
            id,
            path: cleaned,
            fileName,
            size: data.byteLength,
            data
          });
        })
      );
    });

    await Promise.all(pending);
    entries.sort((a, b) => a.path.localeCompare(b.path));
    return entries;
  } finally {
    await archive.close();
  }
}

export async function extractSubtitleEntriesFromArchiveFile(file: File): Promise<ZipSubtitleEntry[]> {
  const ext = archiveExtension(file.name);
  if (!ext) {
    throw new Error(`Unsupported archive type: ${file.name}`);
  }

  try {
    if (ext === ".zip") {
      return await extractSubtitleEntriesFromZip(file);
    }
    return await extractSubtitleEntriesFromArchive(file);
  } catch (error) {
    throw normalizeArchiveReadError(error);
  }
}

export function toSubtitleFile(entry: ZipSubtitleEntry): File {
  return new File([entry.data], entry.fileName, { type: "application/octet-stream" });
}
