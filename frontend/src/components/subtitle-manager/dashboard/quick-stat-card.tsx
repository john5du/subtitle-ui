import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface QuickStatCardProps {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
  tone: "emerald" | "blue" | "amber" | "rose";
  pending?: boolean;
  className?: string;
}

export function QuickStatCard({ icon, label, value, hint, tone, pending = false, className }: QuickStatCardProps) {
  const toneClass: Record<QuickStatCardProps["tone"], { iconBg: string; iconText: string; hintText: string }> = {
    emerald: {
      iconBg: "bg-emerald-500/18 dark:bg-emerald-500/24",
      iconText: "text-emerald-500 dark:text-emerald-400",
      hintText: "text-emerald-600 dark:text-emerald-400"
    },
    blue: {
      iconBg: "bg-blue-500/18 dark:bg-blue-500/24",
      iconText: "text-blue-600 dark:text-blue-400",
      hintText: "text-blue-600 dark:text-blue-400"
    },
    amber: {
      iconBg: "bg-amber-500/18 dark:bg-amber-500/24",
      iconText: "text-amber-600 dark:text-amber-400",
      hintText: "text-amber-600 dark:text-amber-400"
    },
    rose: {
      iconBg: "bg-rose-500/18 dark:bg-rose-500/24",
      iconText: "text-rose-600 dark:text-rose-400",
      hintText: "text-rose-600 dark:text-rose-400"
    }
  };

  const style = toneClass[tone];

  return (
    <Card className={cn("border border-border/70 bg-card/92", className, pending && "animate-pulse-soft")}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-3">
          <span className={cn("inline-flex h-10 w-10 items-center justify-center rounded-xl", style.iconBg, style.iconText)}>
            {icon}
          </span>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
        <p className="text-display text-4xl font-bold tracking-tight">{value}</p>
        <p className={cn("text-xs font-medium", style.hintText)}>{hint}</p>
      </CardContent>
    </Card>
  );
}
