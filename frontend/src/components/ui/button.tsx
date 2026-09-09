import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "ui-control surface-transition focus-ring inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border font-sans font-medium text-sm disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-pressed",
        destructive: "border-transparent bg-destructive text-destructive-foreground hover:brightness-95 active:brightness-90",
        outline: "border-input bg-transparent text-foreground hover:bg-surface-strong hover:text-foreground active:bg-surface-hover",
        secondary: "border-border bg-surface-subtle text-foreground hover:bg-surface-hover active:bg-surface-strong",
        ghost: "border-transparent text-foreground hover:bg-surface-strong hover:text-foreground active:bg-surface-hover",
        link: "border-transparent text-selection-foreground underline-offset-4 hover:text-foreground-muted"
      },
      size: {
        default: "min-h-10 px-4 py-2",
        sm: "h-9 px-4",
        lg: "h-11 px-8",
        icon: "h-10 w-10",
        /** Toolbar density icon (h-9). Prefer over className h-9 w-9. */
        "icon-sm": "h-9 w-9 shrink-0"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
