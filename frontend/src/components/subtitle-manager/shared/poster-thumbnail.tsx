"use client";

import { memo, useEffect, useState } from "react";
import Image from "next/image";
import { Film } from "lucide-react";

import { cn } from "@/lib/utils";

function PosterPlaceholder({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex items-center justify-center rounded-lg border border-border bg-surface-subtle text-muted-foreground", className ?? "h-[72px] w-[48px]")}
      aria-hidden
    ><Film className="h-6 w-6" /></div>
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
