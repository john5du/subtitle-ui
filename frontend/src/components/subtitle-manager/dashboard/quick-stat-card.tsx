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
      iconShell: "border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.03)]",
      hintText: "text-[rgba(255,255,255,0.5)]"
    },
    info: {
      iconShell: "border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.03)]",
      hintText: "text-[rgba(255,255,255,0.5)]"
    },
    warning: {
      iconShell: "border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.03)]",
      hintText: "text-[rgba(255,255,255,0.5)]"
    },
    destructive: {
      iconShell: "border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.03)]",
      hintText: "text-[rgba(255,255,255,0.5)]"
    }
  };

  const style = toneClass[tone];

  return (
    <Card className={cn("surface-panel", className, pending && "animate-pulse-soft")}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-3">
          <span className={cn("inline-flex h-10 w-10 items-center justify-center border", style.iconShell)}>
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
