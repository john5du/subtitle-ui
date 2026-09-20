"use client";

import { Check, Clock } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import type { VideoPlayback } from "@/lib/types";
import { cn } from "@/lib/utils";

export type PlaybackStatus = "played" | "inProgress";

export function playbackStatus(playback?: VideoPlayback | null): PlaybackStatus | null {
  if (!playback) {
    return null;
  }
  if (playback.played) {
    return "played";
  }
  if (playback.inProgress) {
    return "inProgress";
  }
  return null;
}

export function PlaybackStatusMark({
  playback,
  variant,
  className
}: {
  playback?: VideoPlayback | null;
  variant: "overlay" | "pill";
  className?: string;
}) {
  const { t } = useI18n();
  const status = playbackStatus(playback);
  if (!status) {
    return null;
  }
  const label = status === "played" ? t("playback.played") : t("playback.inProgress");
  const Icon = status === "played" ? Check : Clock;

  if (variant === "pill") {
    return (
      <span
        className={cn(
          "rounded-full px-1.5 py-px text-xs font-medium leading-none",
          status === "played" ? "bg-success-soft text-success-muted" : "bg-warning-soft text-warning-muted",
          className
        )}
      >
        {label}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "absolute top-1.5 left-1.5 flex h-5 w-5 items-center justify-center rounded-full shadow-sm",
        status === "played" ? "bg-success text-success-foreground" : "bg-warning text-warning-foreground",
        className
      )}
      aria-label={label}
      title={label}
    >
      <Icon className="h-3 w-3" aria-hidden />
    </span>
  );
}
