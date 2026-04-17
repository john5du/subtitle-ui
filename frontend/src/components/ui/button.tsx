import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "surface-transition inline-flex items-center justify-center gap-2 whitespace-nowrap border font-mono text-sm uppercase tracking-[0.0875em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(59,130,246)/0.5] focus-visible:ring-offset-2 focus-visible:ring-offset-ring-offset disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "border-transparent bg-red-500 text-white hover:bg-red-600",
        outline: "border-input bg-transparent text-white hover:bg-surface-strong hover:text-white",
        secondary: "border-border bg-surface-subtle text-white hover:bg-surface-hover",
        ghost: "border-transparent hover:bg-surface-strong hover:text-white",
        link: "border-transparent text-white underline-offset-4 hover:text-foreground-muted"
      },
      size: {
        default: "h-10 px-6 py-2",
        sm: "h-9 px-4",
        lg: "h-11 px-8",
        icon: "h-10 w-10"
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
