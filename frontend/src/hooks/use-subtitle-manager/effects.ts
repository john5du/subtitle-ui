"use client";

import { useEffect, useRef } from "react";

import { normalizeForCompare } from "@/lib/subtitle-manager/tv-tree";

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
  const { state, setters, refs } = stateApi;
  const controllerRef = useRef(controller);
  controllerRef.current = controller;

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
      setSelectedTvSeason(selectors.tvSeasonOptions[0]?.value || "");
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

  useEffect(() => {
    if (refs.skipMovieQueryRef.current) {
      refs.skipMovieQueryRef.current = false;
      return;
    }

    void controllerRef.current.loadMovieVideos({ page: 1 });
  }, [refs.skipMovieQueryRef, state.queryByType.movie]);

  useEffect(() => {
    if (refs.skipTvQueryRef.current) {
      refs.skipTvQueryRef.current = false;
      return;
    }

    void controllerRef.current.loadTvSeriesPage({ page: 1 });
  }, [refs.skipTvQueryRef, state.queryByType.tv]);

  useEffect(() => {
    if (refs.skipMovieSortRef.current) {
      refs.skipMovieSortRef.current = false;
      return;
    }

    void controllerRef.current.loadMovieVideos({ page: 1 });
  }, [refs.skipMovieSortRef, state.movieYearSortOrder]);

  useEffect(() => {
    if (refs.skipTvSortRef.current) {
      refs.skipTvSortRef.current = false;
      return;
    }

    void controllerRef.current.loadTvSeriesPage({ page: 1 });
  }, [refs.skipTvSortRef, state.tvSeriesYearSortOrder]);

  useEffect(() => {
    void (async () => {
      try {
        await Promise.all([controllerRef.current.loadScanStatus(), controllerRef.current.loadDirectoryScanResult()]);
        setLoadedTabs((prev) => ({ ...prev, dashboard: true }));
      } finally {
        controllerRef.current.finishBootstrapping();
      }
    })();
  }, [setLoadedTabs]);
}
