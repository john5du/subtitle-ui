import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const inputVariants = cva(
  "focus-ring flex w-full rounded-md border border-input bg-transparent text-sm font-sans file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-foreground-subtle disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      size: {
        default: "h-10 px-3 py-2",
        sm: "h-9 px-3 py-1.5"
      }
    },
    defaultVariants: {
      size: "default"
    }
  }
);

export type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> &
  VariantProps<typeof inputVariants>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, size, ...props }, ref) => {
  return <input type={type} className={cn(inputVariants({ size, className }))} ref={ref} {...props} />;
});
Input.displayName = "Input";

export { Input, inputVariants };
