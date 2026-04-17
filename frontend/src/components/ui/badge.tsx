import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center border px-2.5 py-0.5 font-mono text-xs uppercase tracking-[0.0625em] transition-colors focus:outline-none focus:ring-2 focus:ring-[rgb(59,130,246)/0.5] focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-[rgba(255,255,255,0.2)] bg-transparent text-white",
        secondary: "border-border bg-[rgba(255,255,255,0.03)] text-muted-foreground",
        destructive: "border-red-500/30 bg-red-500/10 text-red-400",
        outline: "border-border bg-transparent text-muted-foreground"
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
