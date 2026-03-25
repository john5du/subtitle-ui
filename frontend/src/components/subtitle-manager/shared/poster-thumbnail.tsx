"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

import { cn } from "@/lib/utils";

function PosterPlaceholder({ className }: { className?: string }) {
  return (
    <div
      className={cn("rounded-md border border-border/60 bg-muted/45 shadow-inner", className ?? "h-[72px] w-[48px]")}
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

export function PosterThumbnail({ src = "", className, imageClassName, sizes = "48px" }: PosterThumbnailProps) {
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
    <div className={cn("overflow-hidden rounded-md border border-border/60 bg-muted/30 shadow-sm", frameClassName)}>
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
}
