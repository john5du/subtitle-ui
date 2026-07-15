import { normalizeForCompare } from "@/lib/subtitle-manager/tv-tree";

export function resolveTvInitialPath(options: {
  seriesRows: Array<{ path?: string | null }>;
  selectedPath?: string | null;
  defaultDir?: string | null;
  tvRoot?: string | null;
}): string {
  const selectedNorm = normalizeForCompare(options.selectedPath);
  const fromRows =
    options.seriesRows.find((item) => normalizeForCompare(item.path) === selectedNorm)?.path ||
    options.seriesRows.find((item) => item.path)?.path ||
    "";
  return String(fromRows || options.selectedPath || options.defaultDir || options.tvRoot || "").trim();
}

export function resolveTvWorkspacePath(options: {
  seriesRows: Array<{ path?: string | null }>;
  requestedPath?: string | null;
  selectedSeriesPath?: string | null;
  selectedPath?: string | null;
  tvRootPath?: string | null;
  tvRoot?: string | null;
}): string {
  const requested = String(options.requestedPath ?? "").trim();
  const selectedNorm = normalizeForCompare(
    requested || options.selectedSeriesPath || options.selectedPath
  );
  return String(
    options.seriesRows.find((item) => normalizeForCompare(item.path) === selectedNorm)?.path ||
      requested ||
      options.selectedSeriesPath ||
      options.selectedPath ||
      options.seriesRows.find((item) => item.path)?.path ||
      options.tvRootPath ||
      options.tvRoot ||
      ""
  ).trim();
}

export function clampPage(nextPage: number, totalPages: number, currentPage: number): number | null {
  const max = Math.max(1, totalPages || 1);
  if (!Number.isFinite(nextPage) || nextPage < 1 || nextPage > max || nextPage === currentPage) {
    return null;
  }
  return nextPage;
}

export function clampPageSize(pageSize: number, current: number, min = 1, max = 200): number | null {
  const next = Math.max(min, Math.min(max, Math.floor(pageSize)));
  if (!Number.isFinite(next) || next === current) {
    return null;
  }
  return next;
}
