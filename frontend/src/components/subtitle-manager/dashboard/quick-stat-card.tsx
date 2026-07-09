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

const toneClass: Record<QuickStatCardProps["tone"], { iconShell: string; hintText: string }> = {
  success: {
    iconShell: "border border-success-border bg-success-soft text-success-muted",
    hintText: "text-success-muted"
  },
  info: {
    iconShell: "border border-info-border bg-info-soft text-info-muted",
    hintText: "text-info-muted"
  },
  warning: {
    iconShell: "border border-warning-border bg-warning-soft text-warning-muted",
    hintText: "text-warning-muted"
  },
  destructive: {
    iconShell: "border border-destructive-border bg-destructive-soft text-destructive-muted",
    hintText: "text-destructive-muted"
  }
};

export function QuickStatCard({ icon, label, value, hint, tone, pending = false, className }: QuickStatCardProps) {
  const style = toneClass[tone];

  return (
    <Card className={cn("surface-panel", className, pending && "animate-pulse-soft")}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-3">
          <span className={cn("inline-flex h-10 w-10 items-center justify-center", style.iconShell)}>
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
