"use client";

import { memo, type ReactNode } from "react";

import { PosterThumbnail } from "./poster-thumbnail";

export interface LibraryPosterCardProps {
  title: string;
  subtitle?: string | number | null;
  posterUrl?: string;
  badge: ReactNode;
  ariaLabel: string;
  operationLocked: boolean;
  onOpen: () => void;
}

export const LibraryPosterCard = memo(function LibraryPosterCard({
  title,
  subtitle,
  posterUrl,
  badge,
  ariaLabel,
  operationLocked,
  onOpen
}: LibraryPosterCardProps) {
  return (
    <div className="flex w-full min-w-0 self-start flex-col">
      <button
        type="button"
        className="surface-transition flex w-full min-w-0 flex-col text-left hover:bg-surface-subtle focus-visible:bg-surface-subtle focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-65"
        aria-label={ariaLabel}
        disabled={operationLocked}
        onClick={onOpen}
      >
        <div className="p-2 pb-0">
          <div className="relative">
            <PosterThumbnail
              src={posterUrl}
              className="aspect-[2/3] w-full"
              imageClassName="h-full w-full"
              sizes="(max-width: 420px) 100vw, (max-width: 768px) 50vw, 220px"
            />
            <span
              className="poster-badge absolute bottom-2 right-2 min-w-7 px-2 py-1 text-center text-xs font-semibold leading-none backdrop-blur"
              aria-hidden
            >
              {badge}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-0.5 p-2">
          <p className="line-clamp-2 min-w-0 text-base font-semibold leading-6 text-foreground" title={title}>
            {title || "-"}
          </p>
          {subtitle ? <span className="text-xs font-medium text-muted-foreground">{subtitle}</span> : null}
        </div>
      </button>
    </div>
  );
});

LibraryPosterCard.displayName = "LibraryPosterCard";
