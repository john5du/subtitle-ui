import type { ReactNode } from "react";

import { settingsRowMinClassName } from "@/components/ui/control-sizes";
import { cn } from "@/lib/utils";

export function SettingsActionRow({
  label,
  children,
  className,
  bare = false
}: {
  label: string;
  children: ReactNode;
  className?: string;
  /** When true, omit surface-panel (for use inside a divided panel). */
  bare?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-stretch justify-between gap-3 p-3 sm:flex-row sm:items-center",
        settingsRowMinClassName,
        !bare && "surface-panel",
        className
      )}
    >
      <p className="min-w-0 shrink text-sm font-semibold text-foreground">{label}</p>
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:shrink-0">{children}</div>
    </div>
  );
}
