"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "overlay-scrim-strong fixed inset-0 z-50 data-[state=open]:animate-fade-in-fast data-[state=closed]:animate-fade-out-fast",
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const dialogCloseClassName =
  "absolute right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.75rem,env(safe-area-inset-top))] flex h-10 w-10 items-center justify-center bg-transparent p-0 text-foreground-muted transition-colors hover:text-foreground focus-ring-inset sm:right-4 sm:top-4 sm:h-auto sm:w-auto sm:p-1.5";

function DialogCloseLabel() {
  const { t } = useI18n();
  return <span className="sr-only">{t("common.close")}</span>;
}

/** Centered modal on sm+; bottom sheet on mobile. */
const dialogContentResponsiveClassName =
  "fixed z-50 flex w-full flex-col gap-4 border border-border bg-background " +
  "inset-x-0 bottom-0 max-h-[min(92dvh,100%)] rounded-t-2xl border-b-0 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] " +
  "data-[state=open]:animate-slide-in-up data-[state=closed]:animate-slide-out-down " +
  "sm:inset-x-auto sm:bottom-auto sm:left-[50%] sm:top-[50%] sm:max-h-[min(90vh,100%)] sm:w-full sm:max-w-lg sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg sm:border-b sm:p-6 sm:pb-6 " +
  "sm:data-[state=open]:animate-fade-in-fast sm:data-[state=closed]:animate-fade-out-fast";

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      data-dialog-content="true"
      className={cn(dialogContentResponsiveClassName, className)}
      {...props}
    >
      {children}
      <DialogPrimitive.Close data-slot="close" className={dialogCloseClassName}>
        <X className="h-4 w-4" />
        <DialogCloseLabel />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

/** Always bottom sheet (full-width, tall). Use for dense mobile-first flows. */
const DialogSheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      data-dialog-content="true"
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 flex max-h-[min(92dvh,100%)] w-full flex-col gap-4 overflow-hidden rounded-t-2xl border border-b-0 border-border bg-background p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] data-[state=open]:animate-slide-in-up data-[state=closed]:animate-slide-out-down sm:left-[50%] sm:right-auto sm:max-w-lg sm:translate-x-[-50%] sm:rounded-t-2xl",
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close data-slot="close" className={dialogCloseClassName}>
        <X className="h-4 w-4" />
        <DialogCloseLabel />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogSheetContent.displayName = "DialogSheetContent";

const DialogDrawerContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      data-dialog-content="true"
      className={cn(
        "fixed inset-y-0 right-0 z-50 flex h-[100dvh] w-screen max-w-none flex-col overflow-hidden border-l border-border bg-background data-[state=open]:animate-slide-in-right data-[state=closed]:animate-slide-out-right sm:w-[min(840px,94vw)] xl:w-[min(1040px,88vw)]",
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        data-slot="close"
        className="absolute right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.75rem,env(safe-area-inset-top))] flex h-10 w-10 items-center justify-center bg-transparent p-0 text-foreground-muted transition-colors hover:text-foreground focus-ring-inset sm:h-auto sm:w-auto sm:p-1.5"
      >
        <X className="h-4 w-4" />
        <DialogCloseLabel />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogDrawerContent.displayName = "DialogDrawerContent";

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-0 sm:space-x-2",
      className
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("pr-10 text-lg font-normal leading-none tracking-tight", className)} {...props} />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogDrawerContent,
  DialogFooter,
  DialogHeader,
  DialogPortal,
  DialogSheetContent,
  DialogTitle,
  DialogTrigger
};
