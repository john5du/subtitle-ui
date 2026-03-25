"use client";

import { RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";

export function SpinnerIcon({ className }: { className?: string }) {
  return <RefreshCw className={cn("animate-spin", className)} />;
}

export function InlinePending({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-2.5 py-1 text-xs text-muted-foreground">
      <SpinnerIcon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

export function PanelLoadingOverlay({ label }: { label: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-start justify-end rounded-xl bg-background/40 p-3 backdrop-blur-[1px]">
      <div className="animate-scale-in inline-flex items-center gap-2 rounded-full border border-border/75 bg-card/95 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-lg">
        <SpinnerIcon className="h-3.5 w-3.5" />
        {label}
      </div>
    </div>
  );
}
