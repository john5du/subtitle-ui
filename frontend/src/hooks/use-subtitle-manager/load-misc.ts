import type { VersionInfo, Video } from "@/lib/types";
import { requestPayload } from "@/lib/subtitle-manager/api-client";
import {
  normalizeDirectoryScanResult,
  normalizeLogsPage,
  normalizeScanStatus,
  normalizeVideo
} from "@/lib/subtitle-manager/normalizers";
import { pickDefaultTvDirectory } from "@/lib/subtitle-manager/tv-tree";

import { DEFAULT_LOG_PAGE_SIZE } from "./state";
import type { ControllerRuntime } from "./controller-runtime";

export function createMiscLoadActions(runtime: ControllerRuntime) {
  const { setters, beginLoadChannel, endLoadChannel, reportRequestError } = runtime;

  async function loadVersionInfo() {
    try {
      const payload = await requestPayload<VersionInfo>("/api/version");
      setters.setVersionInfo(payload);
    } catch (error) {
      reportRequestError("error.loadVersionInfo", error);
    }
  }

  async function loadVideoById(videoId: string, hint?: Partial<Video>) {
    const payload = await requestPayload<unknown>(`/api/videos/${encodeURIComponent(videoId)}`);
    return normalizeVideo(payload, hint);
  }

  async function loadScanStatus() {
    try {
      const payload = await requestPayload<unknown>("/api/scan/status");
      setters.setScanStatus(normalizeScanStatus(payload));
    } catch (error) {
      reportRequestError("error.loadScanStatus", error);
    }
  }

  async function loadDirectoryScanResult() {
    try {
      const payload = await requestPayload<unknown>("/api/scan/directories");
      const parsed = normalizeDirectoryScanResult(payload);
      setters.setDirectoryScan(parsed);

      const defaultDir = pickDefaultTvDirectory(parsed);
      if (defaultDir) {
        setters.setSelectedTvDirPath(defaultDir);
      }
      return defaultDir;
    } catch (error) {
      reportRequestError("error.loadDirectoryScan", error);
      return "";
    }
  }

  async function loadLogs(options: { page?: number } = {}) {
    const state = runtime.state;
    const page = options.page || state.logsPager.page || 1;
    const pageSize = state.logsPager.pageSize || DEFAULT_LOG_PAGE_SIZE;

    beginLoadChannel("logs");
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));

      const payload = await requestPayload<unknown>(`/api/logs?${params.toString()}`);
      const pageData = normalizeLogsPage(payload, page, pageSize);
      setters.setLogs(pageData.items);
      setters.setLogsPager({
        page: pageData.page,
        pageSize: pageData.pageSize,
        total: pageData.total,
        totalPages: pageData.totalPages
      });
    } catch (error) {
      reportRequestError("error.loadLogs", error);
    } finally {
      endLoadChannel("logs");
    }
  }

  return {
    loadVersionInfo,
    loadVideoById,
    loadScanStatus,
    loadDirectoryScanResult,
    loadLogs
  };
}
