"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn("inline-flex h-10 items-center justify-center border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] p-1 text-[rgba(255,255,255,0.5)]", className)}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap border border-transparent px-3 py-1.5 text-sm font-mono uppercase tracking-[0.0875em] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(59,130,246)/0.5] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1f2228] data-[state=active]:border-[rgba(255,255,255,0.2)] data-[state=active]:bg-[rgba(255,255,255,0.08)] data-[state=active]:text-white",
      className
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn("mt-2 ring-offset-[#1f2228] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(59,130,246)/0.5]", className)}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsContent, TabsList, TabsTrigger };
