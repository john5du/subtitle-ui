import type { TranslateFn } from "@/lib/i18n";
import type { Subtitle } from "@/lib/types";

export function formatSubtitleSourceLabel(subtitle: Subtitle, t: TranslateFn) {
  switch (subtitle.source) {
    case "upload":
      return t("details.source.upload");
    case "generated":
      return t("details.source.generated");
    case "download":
      return t("details.source.download");
    case "directory":
      return t("details.source.directory");
    default:
      return t("details.source.unknown");
  }
}

export function getSubtitleSourceDetail(subtitle: Subtitle) {
  return subtitle.sourceDetail?.trim() || "";
}

const HTTP_URL_PATTERN = /^https?:\/\/\S+$/i;

/** Split sourceDetail into display lines; HTTP(S) lines are linkable. */
export function parseSourceDetailLines(detail: string): Array<{ text: string; href?: string }> {
  const trimmed = detail.trim();
  if (!trimmed) {
    return [];
  }
  return trimmed.split(/\r?\n/).map((line) => {
    const text = line.trim();
    if (HTTP_URL_PATTERN.test(text)) {
      return { text, href: text };
    }
    return { text };
  }).filter((line) => line.text.length > 0);
}
