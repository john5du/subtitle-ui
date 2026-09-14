import type { VersionInfo, Video } from "@/lib/types";
import { requestPayload } from "@/lib/subtitle-manager/api-client";
import {
  normalizeDirectoryScanResult,
  normalizeLogsPage,
  normalizeScanStatus,
  normalizeVideo
} from "@/lib/subtitle-manager/normalizers";
import { pickDefaultTvDirectory } from "@/lib/subtitle-manager/path-utils";

import { DEFAULT_LOG_PAGE_SIZE } from "./state";
import { createLatestLoad } from "./latest-load";
import type { ControllerRuntime } from "./controller-runtime";

export function createMiscLoadActions(runtime: ControllerRuntime) {
  const { setters, beginLoadChannel, endLoadChannel, reportRequestError } = runtime;

  const versionRequests = createLatestLoad<VersionInfo>();
  const scanRequests = createLatestLoad<ReturnType<typeof normalizeScanStatus>>();
  const directoryRequests = createLatestLoad<ReturnType<typeof normalizeDirectoryScanResult>>();
  const logRequests = createLatestLoad<ReturnType<typeof normalizeLogsPage>>();
  let logsSuspended = 0;

  function loadVersionInfo() {
    return versionRequests.run({
      key: "version",
      fetch: (signal) => requestPayload<VersionInfo>("/api/version", { signal }),
      commit: setters.setVersionInfo,
      onError: (error) => reportRequestError("error.loadVersionInfo", error)
    });
  }

  async function loadVideoById(videoId: string, hint?: Partial<Video>) {
    const payload = await requestPayload<unknown>(`/api/videos/${encodeURIComponent(videoId)}`);
    return normalizeVideo(payload, hint);
  }

  function loadScanStatus(options: { quiet?: boolean } = {}) {
    return scanRequests.run({
      key: "scan",
      fetch: async (signal) => normalizeScanStatus(await requestPayload<unknown>("/api/scan/status", { signal })),
      commit: setters.setScanStatus,
      onError: (error) => {
        if (!options.quiet) {
          reportRequestError("error.loadScanStatus", error);
        }
      }
    });
  }

  async function loadDirectoryScanResult(options: { preserveSelection?: boolean; force?: boolean } = {}) {
    const result = await directoryRequests.run({
      key: "directories",
      force: options.force,
      fetch: async (signal) => normalizeDirectoryScanResult(await requestPayload<unknown>("/api/scan/directories", { signal })),
      commit: (parsed) => {
        setters.setDirectoryScan(parsed);
        if (options.preserveSelection) {
          return;
        }
        const defaultDir = pickDefaultTvDirectory(parsed);
        if (defaultDir) setters.setSelectedTvDirPath(defaultDir);
      },
      onError: (error) => reportRequestError("error.loadDirectoryScan", error)
    });
    return result.status === "success" ? { status: "success" as const, data: pickDefaultTvDirectory(result.data) } : result;
  }

  async function loadLogs(options: { page?: number } = {}) {
    if (logsSuspended) return { status: "cancelled" as const };
    const state = runtime.state;
    const page = options.page || state.logsPager.page || 1;
    const pageSize = state.logsPager.pageSize || DEFAULT_LOG_PAGE_SIZE;

    return logRequests.run({
      key: `${page}:${pageSize}`,
      onStart: () => beginLoadChannel("logs"),
      onEnd: () => endLoadChannel("logs"),
      onError: (error) => reportRequestError("error.loadLogs", error),
      fetch: async (signal) => {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("pageSize", String(pageSize));

        const payload = await requestPayload<unknown>(`/api/logs?${params.toString()}`, { signal });
        return normalizeLogsPage(payload, page, pageSize);
      },
      commit: (pageData) => {
        setters.setLogs(pageData.items);
        setters.setLogsPager({
          page: pageData.page,
          pageSize: pageData.pageSize,
          total: pageData.total,
          totalPages: pageData.totalPages
        });
      }
    });
  }

  // Reject loads throughout DELETE, including requests from mutation refreshes.
  function suspendLogs() {
    logsSuspended += 1;
    logRequests.invalidate();
    return () => { logsSuspended = Math.max(0, logsSuspended - 1); };
  }

  return {
    loadVersionInfo,
    loadVideoById,
    loadScanStatus,
    loadDirectoryScanResult,
    loadLogs,
    suspendLogs,
    cancelMiscLoads: () => {
      versionRequests.invalidate();
      scanRequests.invalidate();
      directoryRequests.invalidate();
      logRequests.invalidate();
    }
  };
}
