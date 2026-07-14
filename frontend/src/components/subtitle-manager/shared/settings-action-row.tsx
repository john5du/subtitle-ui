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
        "flex items-center justify-between gap-3 p-3",
        settingsRowMinClassName,
        !bare && "surface-panel",
        className
      )}
    >
      <p className="min-w-0 shrink text-sm font-semibold text-foreground">{label}</p>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}
