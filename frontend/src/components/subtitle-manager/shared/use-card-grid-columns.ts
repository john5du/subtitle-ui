"use client";

import { useEffect, useRef, useState } from "react";

import { cardGridColumnsFromWidth } from "./card-grid";

const RESIZE_DEBOUNCE_MS = 150;

export function useCardGridColumns(enabled: boolean, onColumnsChange?: (columns: number) => void) {
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState(0);
  const onColumnsChangeRef = useRef(onColumnsChange);
  const lastColumnsRef = useRef(0);
  onColumnsChangeRef.current = onColumnsChange;

  useEffect(() => {
    if (!enabled) {
      lastColumnsRef.current = 0;
      setColumns(0);
      return;
    }

    const el = measureRef.current;
    if (!el || typeof ResizeObserver === "undefined") {
      return;
    }

    let timer: number | undefined;

    const publish = (width: number) => {
      const next = cardGridColumnsFromWidth(width);
      if (next === lastColumnsRef.current) {
        return;
      }
      lastColumnsRef.current = next;
      setColumns(next);
      onColumnsChangeRef.current?.(next);
    };

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? el.clientWidth;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => publish(width), RESIZE_DEBOUNCE_MS);
    });

    observer.observe(el);
    publish(el.clientWidth);

    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [enabled]);

  return { measureRef, columns };
}
