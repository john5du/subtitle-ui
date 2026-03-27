"use client";

import { useMemo } from "react";

import type { TranslateFn } from "@/lib/i18n";
import { collectDetectedSeasons, compareTvVideosByEpisode, parseVideoSeasonEpisodeForSort } from "@/lib/subtitle-manager/tv-episode";
import { deriveTreeRootPath, normalizeForCompare } from "@/lib/subtitle-manager/tv-tree";
import type { TvSeasonOption } from "@/lib/types";

import type { SubtitleManagerSelectors, SubtitleManagerState } from "./types";

interface UseSubtitleManagerSelectorsParams {
  state: SubtitleManagerState;
  t: TranslateFn;
}

export function useSubtitleManagerSelectors({
  state,
  t
}: UseSubtitleManagerSelectorsParams): SubtitleManagerSelectors {
  const movieVideos = useMemo(() => state.videosByType.movie ?? [], [state.videosByType.movie]);
  const moviePager = useMemo(() => state.paginationByType.movie, [state.paginationByType.movie]);
  const tvPager = useMemo(() => state.tvSeriesPager, [state.tvSeriesPager]);

  const tvRootPath = useMemo(() => {
    return deriveTreeRootPath(state.directoryScan.tv ?? [], state.directoryScan.tvRoot);
  }, [state.directoryScan.tv, state.directoryScan.tvRoot]);

  const selectedTvSeries = useMemo(() => {
    const selectedNorm = normalizeForCompare(state.selectedTvDirPath);
    return state.tvSeriesRows.find((item) => normalizeForCompare(item.path) === selectedNorm) ?? null;
  }, [state.selectedTvDirPath, state.tvSeriesRows]);

  const selectedTvSeriesVideos = useMemo(() => {
    const selectedNorm = normalizeForCompare(selectedTvSeries?.path || state.selectedTvDirPath);
    const loadedNorm = normalizeForCompare(state.tvEpisodesPath);
    const requestedNorm = normalizeForCompare(state.tvVideosRequestedPath);
    if (!selectedNorm || selectedNorm !== loadedNorm || selectedNorm !== requestedNorm) {
      return [];
    }

    const items = [...state.tvEpisodes];
    items.sort(compareTvVideosByEpisode);
    return items;
  }, [
    selectedTvSeries?.path,
    state.selectedTvDirPath,
    state.tvEpisodes,
    state.tvEpisodesPath,
    state.tvVideosRequestedPath
  ]);

  const tvSeasonOptions = useMemo<TvSeasonOption[]>(() => {
    const detectedSeasons = collectDetectedSeasons(selectedTvSeriesVideos);
    return detectedSeasons.map((season) => ({
      value: `s${String(season).padStart(2, "0")}`,
      label: t("tv.seasonOption", { season: String(season).padStart(2, "0") }),
      season
    }));
  }, [selectedTvSeriesVideos, t]);

  const sortedTvVideos = useMemo(() => {
    if (tvSeasonOptions.length === 0) {
      return selectedTvSeriesVideos;
    }

    const selectedOption = tvSeasonOptions.find((item) => item.value === state.selectedTvSeason) ?? tvSeasonOptions[0];
    if (!selectedOption?.season) {
      return selectedTvSeriesVideos;
    }

    return selectedTvSeriesVideos.filter((video) => parseVideoSeasonEpisodeForSort(video).season === selectedOption.season);
  }, [state.selectedTvSeason, selectedTvSeriesVideos, tvSeasonOptions]);

  const selectedMovie = useMemo(() => {
    return movieVideos.find((video) => video.id === state.selectedVideoIdByType.movie) ?? null;
  }, [movieVideos, state.selectedVideoIdByType.movie]);

  const selectedTvVideo = useMemo(() => {
    return sortedTvVideos.find((video) => video.id === state.selectedVideoIdByType.tv) ?? null;
  }, [sortedTvVideos, state.selectedVideoIdByType.tv]);

  const showTvScanPrompt = useMemo(() => {
    const noSeries = state.tvSeriesRows.length === 0;
    const noScan = !(state.scanStatus?.lastFinishedAt) && !state.directoryScan.generatedAt;
    return noSeries && noScan;
  }, [state.directoryScan.generatedAt, state.scanStatus?.lastFinishedAt, state.tvSeriesRows.length]);

  return {
    movieVideos,
    moviePager,
    tvPager,
    tvRootPath,
    selectedTvSeries,
    selectedTvSeriesVideos,
    tvSeasonOptions,
    sortedTvVideos,
    selectedMovie,
    selectedTvVideo,
    showTvScanPrompt
  };
}
