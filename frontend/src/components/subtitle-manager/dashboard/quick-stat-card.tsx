import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface QuickStatCardProps {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
  tone: "success" | "info" | "warning" | "destructive";
  pending?: boolean;
  className?: string;
}

export function QuickStatCard({ icon, label, value, hint, tone, pending = false, className }: QuickStatCardProps) {
  const toneClass: Record<QuickStatCardProps["tone"], { iconShell: string; hintText: string }> = {
    success: {
      iconShell: "surface-status-success",
      hintText: "text-success"
    },
    info: {
      iconShell: "surface-status-info",
      hintText: "text-info"
    },
    warning: {
      iconShell: "surface-status-warning",
      hintText: "text-warning"
    },
    destructive: {
      iconShell: "border-destructive/20 bg-destructive/12 text-destructive",
      hintText: "text-destructive"
    }
  };

  const style = toneClass[tone];

  return (
    <Card className={cn("surface-panel", className, pending && "animate-pulse-soft")}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-3">
          <span className={cn("inline-flex h-10 w-10 items-center justify-center rounded-xl border", style.iconShell)}>
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
