import type { DirectoryScanResult, ScanDirectory } from "@/lib/types";

export function normalizeForCompare(pathValue: string | undefined | null) {
  return String(pathValue ?? "")
    .replace(/[\\/]+/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

export function basenamePath(pathValue: string | undefined | null) {
  const cleaned = String(pathValue ?? "").replace(/[\\/]+$/, "");
  const parts = cleaned.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0) {
    return cleaned || "Root";
  }
  return parts[parts.length - 1];
}

export function deriveTreeRootPath(entries: ScanDirectory[], configuredRoot: string) {
  const preferred = String(configuredRoot || "").trim();
  if (preferred) {
    return preferred;
  }
  if (entries.length === 0) {
    return "";
  }

  const normalized = entries.map((entry) => normalizeForCompare(entry.path)).filter(Boolean);
  if (normalized.length === 0) {
    return String(entries[0]?.path || "").trim();
  }

  let prefix = normalized[0];
  for (let index = 1; index < normalized.length; index += 1) {
    const current = normalized[index];
    let nextLength = Math.min(prefix.length, current.length);
    while (nextLength > 0 && prefix.slice(0, nextLength) !== current.slice(0, nextLength)) {
      nextLength -= 1;
    }
    prefix = prefix.slice(0, nextLength);
    if (!prefix) {
      break;
    }
  }

  const slashIndex = prefix.lastIndexOf("/");
  const trimmed = slashIndex >= 0 ? prefix.slice(0, slashIndex) : prefix;
  if (!trimmed) {
    return String(entries[0]?.path || "").trim();
  }

  const useBackslash = String(entries[0]?.path || "").includes("\\");
  return trimmed.replace(/\//g, useBackslash ? "\\" : "/");
}

export function pickDefaultTvDirectory(scan: DirectoryScanResult) {
  const root = String(scan.tvRoot || "").trim() || String(scan.tv?.[0]?.path || "").trim();
  if (root) {
    return root;
  }
  return scan.tv?.[0]?.path || "";
}
