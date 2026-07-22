"use client";

import { useEffect, useSyncExternalStore } from "react";

import { requestPayload } from "@/lib/subtitle-manager/api-client";
import type { JellyfinConfig } from "@/lib/types";

type Snapshot = {
  enabled: boolean;
  loaded: boolean;
};

let snapshot: Snapshot = { enabled: false, loaded: false };
let inflight: Promise<boolean> | null = null;
let generation = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function setSnapshot(next: Snapshot) {
  if (snapshot.enabled === next.enabled && snapshot.loaded === next.loaded) {
    return;
  }
  snapshot = next;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Snapshot {
  return snapshot;
}

function getServerSnapshot(): Snapshot {
  return { enabled: false, loaded: false };
}

function ensureLoaded(): Promise<boolean> {
  if (snapshot.loaded) {
    return Promise.resolve(snapshot.enabled);
  }
  if (inflight) {
    return inflight;
  }
  const gen = generation;
  inflight = requestPayload<JellyfinConfig>("/api/config/jellyfin")
    .then((cfg) => {
      if (gen !== generation) {
        return snapshot.enabled;
      }
      const enabled = Boolean(cfg.enabled);
      setSnapshot({ enabled, loaded: true });
      inflight = null;
      return enabled;
    })
    .catch(() => {
      if (gen !== generation) {
        return snapshot.enabled;
      }
      setSnapshot({ enabled: false, loaded: true });
      inflight = null;
      return false;
    });
  return inflight;
}

/** Current shared snapshot (tests / debug). */
export function getJellyfinEnabledState(): Snapshot {
  return snapshot;
}

/** Update shared gate after settings save (avoids stale play-preview button). */
export function setJellyfinEnabledCache(enabled: boolean) {
  generation += 1;
  inflight = null;
  setSnapshot({ enabled: Boolean(enabled), loaded: true });
}

/** Drop cached flag so the next consumer re-fetches. */
export function invalidateJellyfinEnabled() {
  generation += 1;
  inflight = null;
  setSnapshot({ enabled: false, loaded: false });
}

/**
 * Shared Jellyfin enabled flag for gating video play-preview.
 * Module-level cache: one config fetch per page session; settings save updates via setJellyfinEnabledCache.
 */
export function useJellyfinEnabled() {
  const { enabled, loaded } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    void ensureLoaded();
  }, []);

  return { enabled, loaded };
}
