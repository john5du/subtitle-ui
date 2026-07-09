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
