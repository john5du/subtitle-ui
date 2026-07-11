"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

import { APP_TOAST_EVENT, type AppToastEventDetail, type ToastLevel } from "@/lib/toast";
import { cn } from "@/lib/utils";

type ToastItem = AppToastEventDetail;

function toneAccent(level: ToastLevel) {
  switch (level) {
    case "success":
      return "bg-success";
    case "info":
      return "bg-info";
    default:
      return "bg-destructive";
  }
}

function toneIcon(level: ToastLevel) {
  switch (level) {
    case "success":
      return <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />;
    case "info":
      return <Info className="h-4 w-4 text-info" aria-hidden />;
    default:
      return <AlertCircle className="h-4 w-4 text-destructive" aria-hidden />;
  }
}

function toneProgress(level: ToastLevel) {
  switch (level) {
    case "success":
      return "bg-success";
    case "info":
      return "bg-info";
    default:
      return "bg-destructive";
  }
}

function toastLines(toast: ToastItem) {
  const primary = toast.title?.trim() || toast.message;
  const secondary = toast.title?.trim()
    ? toast.message !== primary
      ? toast.message
      : toast.detail
    : toast.detail;
  return {
    primary,
    secondary: secondary?.trim() || undefined
  };
}

export function ToastViewport() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const onToast = (event: Event) => {
      const custom = event as CustomEvent<AppToastEventDetail>;
      const detail = custom.detail;
      if (!detail?.message?.trim() && !detail?.title?.trim()) return;

      setToasts((prev) => [...prev, detail]);
      const duration = Math.max(1500, detail.durationMs ?? 3600);
      const id = detail.id;
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== id));
      }, duration);
    };

    window.addEventListener(APP_TOAST_EVENT, onToast as EventListener);
    return () => {
      window.removeEventListener(APP_TOAST_EVENT, onToast as EventListener);
    };
  }, []);

  function dismiss(id: string) {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed top-[max(1rem,env(safe-area-inset-top))] right-[max(1rem,env(safe-area-inset-right))] z-[100] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((toast) => {
        const { primary, secondary } = toastLines(toast);
        const duration = Math.max(1500, toast.durationMs ?? 3600);
        return (
          <div
            key={toast.id}
            role="status"
            aria-live="polite"
            className="animate-scale-in pointer-events-auto overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-xl"
          >
            <div className="flex">
              <div className={cn("w-1 shrink-0", toneAccent(toast.level))} />
              <div className="min-w-0 flex-1 px-3 py-2.5">
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5 shrink-0">{toneIcon(toast.level)}</div>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="break-words text-sm font-medium leading-snug text-foreground">{primary}</p>
                    {secondary && (
                      <p className="break-words text-xs leading-snug text-muted-foreground line-clamp-2">{secondary}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => dismiss(toast.id)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    aria-label="Dismiss"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-border/80">
                  <div
                    className={cn("toast-progress h-full origin-left opacity-70", toneProgress(toast.level))}
                    style={{ animationDuration: `${duration}ms` }}
                  />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
