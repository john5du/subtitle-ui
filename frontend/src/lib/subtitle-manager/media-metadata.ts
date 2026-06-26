import type { Locale } from "@/lib/i18n";
import type { MediaType, TvSeriesSummary } from "@/lib/types";

import { basenamePath } from "./tv-tree";

function clean(value: string | undefined | null) {
  return String(value ?? "").trim();
}

function sameTitle(a: string, b: string) {
  return clean(a).toLocaleLowerCase() === clean(b).toLocaleLowerCase();
}

export function tvSeriesDisplayTitleParts(series: TvSeriesSummary | null | undefined, locale: Locale) {
  if (!series) {
    return { title: "", secondaryTitle: "", fullTitle: "" };
  }

  const title = clean(series.title);
  const originalTitle = clean(series.originalTitle);
  const fallback = basenamePath(series.path);
  let displayTitle = "";
  let secondaryTitle = "";

  if (locale === "zh-CN") {
    displayTitle = title || originalTitle || fallback;
    if (title && originalTitle && !sameTitle(title, originalTitle)) {
      secondaryTitle = originalTitle;
    }
  } else {
    displayTitle = originalTitle || title || fallback;
  }

  return {
    title: displayTitle,
    secondaryTitle,
    fullTitle: secondaryTitle ? `${displayTitle} ${secondaryTitle}` : displayTitle
  };
}

export function tvSeriesDisplayTitle(series: TvSeriesSummary | null | undefined, locale: Locale) {
  return tvSeriesDisplayTitleParts(series, locale).title;
}

export function tvSeriesSearchTitle(series: TvSeriesSummary | null | undefined) {
  if (!series) {
    return "";
  }
  return basenamePath(series.path) || clean(series.originalTitle) || clean(series.title);
}

export function imdbTitleUrl(imdbId: string | undefined | null) {
  const id = clean(imdbId);
  if (!id) {
    return "";
  }
  return `https://www.imdb.com/title/${encodeURIComponent(id)}/`;
}

export function tmdbTitleUrl(tmdbId: string | undefined | null, mediaType: MediaType) {
  const id = clean(tmdbId);
  if (!id) {
    return "";
  }
  const typePath = mediaType === "tv" ? "tv" : "movie";
  return `https://www.themoviedb.org/${typePath}/${encodeURIComponent(id)}`;
}
