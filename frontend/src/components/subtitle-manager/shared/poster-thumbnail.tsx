"use client";

import { memo, useEffect, useState } from "react";
import Image from "next/image";

import { cn } from "@/lib/utils";

function PosterPlaceholder({ className }: { className?: string }) {
  return (
    <div
      className={cn("border border-border bg-surface-subtle", className ?? "h-[72px] w-[48px]")}
      aria-hidden
    />
  );
}

export interface PosterThumbnailProps {
  src?: string;
  className?: string;
  imageClassName?: string;
  sizes?: string;
}

export const PosterThumbnail = memo(function PosterThumbnail({
  src = "",
  className,
  imageClassName,
  sizes = "48px"
}: PosterThumbnailProps) {
  const [failed, setFailed] = useState(false);
  const frameClassName = className ?? "h-[72px] w-[48px]";
  const resolvedImageClassName = imageClassName ?? "h-full w-full";

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return <PosterPlaceholder className={frameClassName} />;
  }

  return (
    <div className={cn("overflow-hidden border border-border bg-surface-subtle", frameClassName)}>
      <Image
        src={src}
        alt=""
        width={480}
        height={720}
        unoptimized
        sizes={sizes}
        className={cn("object-cover align-middle", resolvedImageClassName)}
        onError={() => setFailed(true)}
      />
    </div>
  );
});

PosterThumbnail.displayName = "PosterThumbnail";
