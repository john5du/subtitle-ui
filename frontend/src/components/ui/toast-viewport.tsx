"use client";

import { useEffect, useState } from "react";

import { APP_TOAST_EVENT, type AppToastEventDetail } from "@/lib/toast";
import { cn } from "@/lib/utils";

type ToastItem = AppToastEventDetail;

function toneClass(level: ToastItem["level"]) {
  switch (level) {
    case "success":
      return "border-emerald-300/80 bg-emerald-50 text-emerald-800 dark:border-emerald-800/80 dark:bg-emerald-950/50 dark:text-emerald-200";
    case "info":
      return "border-blue-300/80 bg-blue-50 text-blue-800 dark:border-blue-800/80 dark:bg-blue-950/50 dark:text-blue-200";
    default:
      return "border-rose-300/80 bg-rose-50 text-rose-800 dark:border-rose-800/80 dark:bg-rose-950/50 dark:text-rose-200";
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
          className={cn(
            "pointer-events-auto rounded-md border px-3 py-2 text-sm shadow-md backdrop-blur",
            toneClass(toast.level)
          )}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
