"use client";

import { useEffect, useState } from "react";

import { requestPayload } from "@/lib/subtitle-manager/api-client";
import type { JellyfinConfig } from "@/lib/types";

/** Loads whether Jellyfin is enabled (for gating video play-preview). */
export function useJellyfinEnabled() {
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void requestPayload<JellyfinConfig>("/api/config/jellyfin")
      .then((cfg) => {
        if (!cancelled) {
          setEnabled(Boolean(cfg.enabled));
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEnabled(false);
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { enabled, loaded };
}
