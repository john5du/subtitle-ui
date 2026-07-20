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

export type DialogSize = "sm" | "md" | "lg" | "xl";
export type DialogDrawerSize = "md" | "lg" | "xl";

/** Fixed desktop width/height per size. Mobile stays bottom-sheet. */
const dialogSizeClassName: Record<DialogSize, string> = {
  // Confirm + simple forms: fixed width, content height
  sm:
    "sm:h-auto sm:w-[min(32rem,94vw)] sm:max-w-[32rem] sm:max-h-[min(90vh,100%)]",
  // Search / pick lists: fixed frame
  md:
    "sm:h-[min(40rem,90vh)] sm:w-[min(42rem,94vw)] sm:max-h-[min(40rem,90vh)] sm:max-w-[42rem]",
  // Tables / batch / preview / logs: large fixed frame
  lg:
    "sm:h-[min(52rem,90vh)] sm:w-[min(56rem,94vw)] sm:max-h-[min(52rem,90vh)] sm:max-w-[56rem]",
  // Video playback preview
  xl:
    "sm:h-[min(90vh,56rem)] sm:w-[min(72rem,96vw)] sm:max-h-[min(90vh,56rem)] sm:max-w-[72rem]"
};

/** Side drawer desktop widths. Full-screen on mobile. */
const dialogDrawerSizeClassName: Record<DialogDrawerSize, string> = {
  // Movie subtitle manager
  md: "sm:w-[min(680px,94vw)] xl:w-[min(760px,88vw)]",
  // Default dense panel
  lg: "sm:w-[min(840px,94vw)] xl:w-[min(1040px,88vw)]",
  // TV series workspace
  xl: "sm:w-[min(840px,94vw)] xl:w-[min(1240px,92vw)]"
};

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
const dialogContentBaseClassName =
  "fixed z-50 flex w-full flex-col gap-4 border border-border bg-background " +
  "inset-x-0 bottom-0 max-h-[min(92dvh,100%)] rounded-t-2xl border-b-0 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] " +
  "data-[state=open]:animate-slide-in-up data-[state=closed]:animate-slide-out-down " +
  "sm:inset-x-auto sm:bottom-auto sm:left-[50%] sm:top-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg sm:border-b sm:p-6 sm:pb-6 " +
  "sm:data-[state=open]:animate-fade-in-fast sm:data-[state=closed]:animate-fade-out-fast";

type DialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  size?: DialogSize;
};

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, size = "sm", ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      data-dialog-content="true"
      data-dialog-size={size}
      className={cn(
        dialogContentBaseClassName,
        size !== "sm" && "overflow-hidden",
        dialogSizeClassName[size],
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

type DialogDrawerContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  size?: DialogDrawerSize;
};

const DialogDrawerContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogDrawerContentProps
>(({ className, children, size = "lg", ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      data-dialog-content="true"
      data-dialog-drawer-size={size}
      className={cn(
        "fixed inset-y-0 right-0 z-50 flex h-[100dvh] w-screen max-w-none flex-col overflow-hidden border-l border-border bg-background data-[state=open]:animate-slide-in-right data-[state=closed]:animate-slide-out-right",
        dialogDrawerSizeClassName[size],
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        data-slot="close"
        className="absolute right-5 top-5 z-50 flex h-10 w-10 items-center justify-center bg-transparent p-0 text-foreground-muted transition-colors hover:text-foreground focus-ring-inset sm:h-auto sm:w-auto sm:p-1.5"
      >
        <X className="h-4 w-4" />
        <DialogCloseLabel />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogDrawerContent.displayName = "DialogDrawerContent";

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex shrink-0 flex-col space-y-1.5 text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

/** Action row: stacked full-width on mobile; right-aligned Cancel → Primary on sm+. */
const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex shrink-0 flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end sm:gap-0 sm:space-x-2",
      className
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

/** Scrollable main body for md/lg dialogs. Place between Header and Footer. */
const DialogBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex min-h-0 flex-1 flex-col gap-3 overflow-hidden", className)} {...props} />
);
DialogBody.displayName = "DialogBody";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("pr-10 text-lg font-normal leading-none tracking-tight", className)}
    {...props}
  />
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
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogDrawerContent,
  DialogFooter,
  DialogHeader,
  DialogPortal,
  DialogSheetContent,
  DialogTitle,
  DialogTrigger,
  dialogDrawerSizeClassName,
  dialogSizeClassName
};
