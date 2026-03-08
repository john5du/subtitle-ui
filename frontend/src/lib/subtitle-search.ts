import type { Video } from "@/lib/types";

function normalizeKeywordPart(value: string | undefined | null) {
  return String(value ?? "").trim();
}

function buildKeyword(video: Video) {
  const title = normalizeKeywordPart(video.title) || normalizeKeywordPart(video.fileName);
  const year = normalizeKeywordPart(video.year);
  if (year) {
    return `${title} ${year}`.trim();
  }
  return title;
}

export function buildSubtitleSearchLinksByKeyword(rawKeyword: string) {
  const keyword = normalizeKeywordPart(rawKeyword);
  const encoded = encodeURIComponent(keyword);
  return {
    zimuku: `https://zimuku.org/search?q=${encoded}`,
    subhd: `https://subhd.tv/search/${encoded}`
  };
}

export function buildSubtitleSearchLinks(video: Video) {
  return buildSubtitleSearchLinksByKeyword(buildKeyword(video));
}
