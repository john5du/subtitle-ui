import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "focus-ring inline-flex items-center border px-2.5 py-0.5 font-mono text-caption uppercase tracking-label transition-colors",
  {
    variants: {
      variant: {
        default: "border-input bg-transparent text-foreground",
        secondary: "border-border bg-surface-subtle text-muted-foreground",
        destructive: "border-destructive-border bg-destructive-soft text-destructive-muted",
        outline: "border-border bg-transparent text-muted-foreground",
        success: "border-success-border bg-success-soft text-success-muted",
        warning: "border-warning-border bg-warning-soft text-warning-muted",
        info: "border-info-border bg-info-soft text-info-muted"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
