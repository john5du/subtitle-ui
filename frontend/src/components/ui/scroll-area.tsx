"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

interface ScrollAreaProps extends React.ComponentPropsWithoutRef<"div"> {
  viewportClassName?: string;
  viewportRef?: React.Ref<HTMLDivElement>;
}

const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
  ({ className, children, viewportClassName, viewportRef, ...props }, ref) => (
    <div ref={ref} className={cn("relative isolate min-h-0 overflow-hidden contain-paint", className)} {...props}>
      <div
        ref={viewportRef}
        className={cn("h-full min-h-0 w-full overflow-y-auto overscroll-contain", viewportClassName)}
      >
        {children}
      </div>
    </div>
  )
);
ScrollArea.displayName = "ScrollArea";

export { ScrollArea };
