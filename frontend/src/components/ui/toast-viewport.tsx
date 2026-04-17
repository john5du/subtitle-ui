"use client";

import { useEffect, useState } from "react";

import { APP_TOAST_EVENT, type AppToastEventDetail } from "@/lib/toast";
import { cn } from "@/lib/utils";

type ToastItem = AppToastEventDetail;

function toneClass(level: ToastItem["level"]) {
  switch (level) {
    case "success":
      return "border-border bg-surface-strong text-foreground";
    case "info":
      return "border-border bg-surface-strong text-foreground";
    default:
      return "border-red-500/30 bg-red-500/10 text-red-300";
  }
}

export function ToastViewport() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const onToast = (event: Event) => {
      const custom = event as CustomEvent<AppToastEventDetail>;
      const detail = custom.detail;
      if (!detail?.message) return;

      setToasts((prev) => [...prev, detail]);
      const duration = Math.max(1500, detail.durationMs ?? 4200);
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

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          aria-live="polite"
          className={cn(
            "animate-scale-in pointer-events-auto overflow-hidden border px-3 py-2 text-sm",
            toneClass(toast.level)
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              {toast.title && <p className="font-mono text-xs uppercase tracking-[0.0625em]">{toast.title}</p>}
              <p className={cn("break-words", toast.title ? "text-sm" : "font-medium")}>{toast.message}</p>
              {toast.detail && <p className="break-words text-xs opacity-60">{toast.detail}</p>}
            </div>
          </div>
          <div className="mt-2 h-1 overflow-hidden bg-border">
            <div
              className="toast-progress h-full origin-left bg-current/70"
              style={{ animationDuration: `${Math.max(1500, toast.durationMs ?? 4200)}ms` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
