"use client";

import { useEffect, useRef } from "react";

import { normalizeForCompare } from "@/lib/subtitle-manager/path-utils";

import type { SubtitleManagerController, SubtitleManagerSelectors, SubtitleManagerStateApi } from "./types";

interface UseSubtitleManagerEffectsParams {
  stateApi: SubtitleManagerStateApi;
  selectors: SubtitleManagerSelectors;
  controller: SubtitleManagerController;
}

export function useSubtitleManagerEffects({
  stateApi,
  selectors,
  controller
}: UseSubtitleManagerEffectsParams) {
  const { state, setters } = stateApi;

  const {
    setSelectedTvDirPath,
    setSelectedTvSeason,
    setSelectedVideoIdByType,
    setLoadedTabs
  } = setters;

  useEffect(() => {
    const selectedNorm = normalizeForCompare(state.selectedTvDirPath);
    const existsInCurrentPage = state.tvSeriesRows.some((item) => normalizeForCompare(item.path) === selectedNorm);
    if (selectedNorm && existsInCurrentPage) {
      return;
    }

    if (state.tvSeriesRows.length > 0) {
      setSelectedTvDirPath(state.tvSeriesRows[0].path);
      return;
    }

    if (state.selectedTvDirPath !== "") {
      setSelectedTvDirPath("");
    }
  }, [setSelectedTvDirPath, state.selectedTvDirPath, state.tvSeriesRows]);

  useEffect(() => {
    setSelectedTvSeason("");
  }, [setSelectedTvSeason, state.selectedTvDirPath]);

  useEffect(() => {
    if (selectors.tvSeasonOptions.length === 0) {
      if (state.selectedTvSeason !== "") {
        setSelectedTvSeason("");
      }
      return;
    }

    const exists = selectors.tvSeasonOptions.some((item) => item.value === state.selectedTvSeason);
    if (!exists) {
      const latest = selectors.tvSeasonOptions[selectors.tvSeasonOptions.length - 1];
      setSelectedTvSeason(latest?.value || "");
    }
  }, [selectors.tvSeasonOptions, setSelectedTvSeason, state.selectedTvSeason]);

  useEffect(() => {
    setSelectedVideoIdByType((prev) => {
      if (selectors.movieVideos.length === 0) {
        if (prev.movie === "") {
          return prev;
        }
        return { ...prev, movie: "" };
      }

      const exists = selectors.movieVideos.some((video) => video.id === prev.movie);
      if (exists) {
        return prev;
      }

      return { ...prev, movie: selectors.movieVideos[0].id };
    });
  }, [selectors.movieVideos, setSelectedVideoIdByType]);

  useEffect(() => {
    setSelectedVideoIdByType((prev) => {
      if (selectors.sortedTvVideos.length === 0) {
        if (prev.tv === "") {
          return prev;
        }
        return { ...prev, tv: "" };
      }

      const exists = selectors.sortedTvVideos.some((video) => video.id === prev.tv);
      if (exists) {
        return prev;
      }

      return { ...prev, tv: selectors.sortedTvVideos[0].id };
    });
  }, [selectors.sortedTvVideos, setSelectedVideoIdByType]);

  const movieQueryKey = JSON.stringify([state.queryByType.movie, state.movieSortBy, state.movieSortOrder]);
  const tvQueryKey = JSON.stringify([state.queryByType.tv, state.tvSeriesSortBy, state.tvSeriesSortOrder]);
  const previousMovieQuery = useRef(movieQueryKey);
  const previousTvQuery = useRef(tvQueryKey);

  useEffect(() => {
    if (previousMovieQuery.current === movieQueryKey) return;
    previousMovieQuery.current = movieQueryKey;
    void controller.loadMovieVideos({ page: 1 });
  }, [controller, movieQueryKey]);

  useEffect(() => {
    if (previousTvQuery.current === tvQueryKey) return;
    previousTvQuery.current = tvQueryKey;
    void controller.loadTvSeriesPage({ page: 1 });
  }, [controller, tvQueryKey]);

  const wasScanRunning = useRef(false);
  const scanStatusHydrated = useRef(false);
  const lastFinishedAtRef = useRef<string | undefined>(undefined);
  const scanRunning = Boolean(state.scanStatus?.running);
  const scanFinishedAt = state.scanStatus?.lastFinishedAt;
  const hasScanStatus = Boolean(state.scanStatus);

  useEffect(() => {
    const intervalMs = scanRunning ? 2000 : 5000;
    const timer = window.setInterval(() => {
      void controller.loadScanStatus({ quiet: true });
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [controller, scanRunning]);

  useEffect(() => {
    if (!scanStatusHydrated.current) {
      if (!hasScanStatus) {
        return;
      }
      scanStatusHydrated.current = true;
      wasScanRunning.current = scanRunning;
      lastFinishedAtRef.current = scanFinishedAt;
      return;
    }

    const finishedChanged = Boolean(scanFinishedAt && scanFinishedAt !== lastFinishedAtRef.current);
    const runningStopped = wasScanRunning.current && !scanRunning;
    if (!state.pending.scan && (runningStopped || finishedChanged)) {
      void controller.reloadLibraryAfterScan();
    }
    wasScanRunning.current = scanRunning;
    if (scanFinishedAt) {
      lastFinishedAtRef.current = scanFinishedAt;
    }
  }, [controller, hasScanStatus, scanFinishedAt, scanRunning, state.pending.scan]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const results = await Promise.all([
          controller.loadScanStatus(),
          controller.loadDirectoryScanResult(),
          controller.loadVersionInfo()
        ]);
        if (!active) return;
        if (results.every((result) => result.status === "success")) {
          setLoadedTabs((prev) => ({ ...prev, dashboard: true }));
        }
        const tvResult = await controller.loadTvSeriesPage({ page: 1 });
        if (active && tvResult.status === "success") setLoadedTabs((prev) => ({ ...prev, tv: true }));
      } finally {
        if (active) controller.finishBootstrapping();
      }
    })();
    return () => {
      active = false;
      controller.cancelLoads();
    };
  }, [controller, setLoadedTabs]);
}
