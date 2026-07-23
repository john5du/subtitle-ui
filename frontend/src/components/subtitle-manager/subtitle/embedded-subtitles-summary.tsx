"use client";

import { useMemo } from "react";

import { useEmbeddedSubtitles } from "@/hooks/use-embedded-subtitles";
import { useI18n } from "@/lib/i18n";
import { formatSubtitleLanguageLabel } from "@/lib/subtitle-language";
import type { EmbeddedSubtitleTrack } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

import { SpinnerIcon } from "../shared/pending-state";

type EmbeddedSubtitlesSummaryProps = {
  videoId: string | undefined;
  jellyfinEnabled: boolean;
  className?: string;
  compact?: boolean;
  hideLabel?: boolean;
};

const CHINESE_HINT_RE = /中文|国语|粤语|简体|繁体|简中|繁中|chinese|mandarin|cantonese|\bchi\b|\bzho\b|\bzh\b|\bchs\b|\bcht\b|\bcn\b|\btw\b|\bhk\b/i;

function trackLooksChinese(track: EmbeddedSubtitleTrack): boolean {
  const code = formatSubtitleLanguageLabel(track.language).toLowerCase();
  if (code === "zh" || code === "zh-hant" || code.startsWith("zh")) {
    return true;
  }
  if (code.includes("zh") || code.includes("chi") || code.includes("chs") || code.includes("cht")) {
    return true;
  }
  const blob = [track.language, track.title, track.displayTitle].filter(Boolean).join(" ");
  return CHINESE_HINT_RE.test(blob);
}

export function EmbeddedSubtitlesSummary({ videoId, jellyfinEnabled, className }: EmbeddedSubtitlesSummaryProps) {
  const { t } = useI18n();
  const state = useEmbeddedSubtitles(videoId, jellyfinEnabled);

  const hasChinese = useMemo(() => {
    if (state.status !== "ready") return false;
    return state.tracks.some(trackLooksChinese);
  }, [state]);

  if (!jellyfinEnabled || !videoId || state.status === "idle" || state.status === "hidden") {
    return null;
  }

  if (state.status === "loading") {
    return (
      <div className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
        <SpinnerIcon className="h-3 w-3" />
        <span>{t("details.embeddedLoading")}</span>
      </div>
    );
  }

  if (state.status === "unavailable" || state.status === "error") {
    return (
      <span
        className={cn("text-xs text-muted-foreground", className)}
        title={state.status === "error" ? state.message : undefined}
      >
        {t("details.embeddedUnavailable")}
      </span>
    );
  }

  return (
    <Badge
      variant={hasChinese ? "success" : "secondary"}
      className={cn(
        "shrink-0 px-1.5 py-0 text-[10px] font-normal normal-case tracking-normal",
        !hasChinese && "text-muted-foreground",
        className
      )}
    >
      {hasChinese ? t("details.embeddedChineseYes") : t("details.embeddedChineseNo")}
    </Badge>
  );
}
