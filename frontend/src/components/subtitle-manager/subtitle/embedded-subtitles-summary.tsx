"use client";

import { useMemo } from "react";

import { useEmbeddedSubtitles } from "@/hooks/use-embedded-subtitles";
import { useI18n } from "@/lib/i18n";
import { subtitleLanguageDisplayText } from "@/lib/subtitle-language";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

import { SpinnerIcon } from "../shared/pending-state";

type EmbeddedSubtitlesSummaryProps = {
  videoId: string | undefined;
  jellyfinEnabled: boolean;
  className?: string;
  /** denser inline layout for toolbars / header chips */
  compact?: boolean;
  /** omit leading label when parent already shows one */
  hideLabel?: boolean;
};

export function EmbeddedSubtitlesSummary({
  videoId,
  jellyfinEnabled,
  className,
  compact = false,
  hideLabel = false
}: EmbeddedSubtitlesSummaryProps) {
  const { t } = useI18n();
  const state = useEmbeddedSubtitles(videoId, jellyfinEnabled);

  const labels = useMemo(() => {
    if (state.status !== "ready") return [];
    return state.tracks.map((track) => {
      const lang = subtitleLanguageDisplayText(track.language, t);
      const parts = [lang];
      if (track.isForced) parts.push(t("details.embeddedForced"));
      if (track.codec) parts.push(track.codec);
      const title = [track.displayTitle || track.title, track.codec, track.isText ? null : t("details.embeddedImageTrack")]
        .filter(Boolean)
        .join(" · ");
      return { key: `${track.index}-${track.language}-${track.codec || ""}`, text: parts.join(" · "), title: title || parts.join(" · ") };
    });
  }, [state, t]);

  if (!jellyfinEnabled || !videoId || state.status === "idle" || state.status === "hidden") {
    return null;
  }

  if (state.status === "loading") {
    return (
      <div className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
        <SpinnerIcon className="h-3 w-3" />
        <span>{t("details.embeddedLoading")}</span>
      </div>
    );
  }

  if (state.status === "unavailable" || state.status === "error") {
    return (
      <p className={cn("text-xs text-muted-foreground", className)} title={state.status === "error" ? state.message : undefined}>
        {t("details.embeddedUnavailable")}
      </p>
    );
  }

  if (labels.length === 0) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        {t("details.embeddedNone")}
      </p>
    );
  }

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}>
      {!hideLabel ? (
        <span className="shrink-0 text-xs text-muted-foreground">
          {compact ? t("details.embeddedShort") : t("details.embeddedSubtitles")}
        </span>
      ) : null}
      {labels.map((item) => (
        <Badge key={item.key} variant="outline" className="max-w-full truncate normal-case tracking-normal" title={item.title}>
          {item.text}
        </Badge>
      ))}
    </div>
  );
}
