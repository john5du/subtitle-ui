"use client";

import { useEffect, useState } from "react";

export function useIsMobile(maxWidth = 960) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      setIsMobile(false);
      return;
    }

    const query = window.matchMedia(`(max-width: ${maxWidth}px)`);
    setIsMobile(query.matches);

    const onChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
    };

    if (query.addEventListener) {
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    }

    query.addListener(onChange);
    return () => query.removeListener(onChange);
  }, [maxWidth]);

  return isMobile;
}
