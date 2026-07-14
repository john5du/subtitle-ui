import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function EmptyPanel({
  children,
  className,
  padded = true
}: {
  children: ReactNode;
  className?: string;
  /** Use min-h panel for list empty states. */
  padded?: boolean;
}) {
  return (
    <div
      className={cn(
        "surface-panel text-center text-sm text-muted-foreground",
        padded ? "flex min-h-[var(--panel-min-h)] items-center justify-center p-6" : "px-6 py-12",
        className
      )}
    >
      {children}
    </div>
  );
}
