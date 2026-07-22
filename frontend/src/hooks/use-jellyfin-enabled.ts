"use client";

import { useEffect, useSyncExternalStore } from "react";

import { requestPayload } from "@/lib/subtitle-manager/api-client";
import type { JellyfinConfig } from "@/lib/types";

type Snapshot = {
  enabled: boolean;
  loaded: boolean;
};

const RETRY_MS = 5_000;

let snapshot: Snapshot = { enabled: false, loaded: false };
let inflight: Promise<boolean> | null = null;
let generation = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
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

function clearRetryTimer() {
  if (retryTimer != null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleRetry() {
  if (retryTimer != null || typeof window === "undefined") {
    return;
  }
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (!snapshot.loaded && listeners.size > 0) {
      void ensureLoaded();
    }
  }, RETRY_MS);
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
      clearRetryTimer();
      const enabled = Boolean(cfg.enabled);
      setSnapshot({ enabled, loaded: true });
      inflight = null;
      return enabled;
    })
    .catch(() => {
      if (gen !== generation) {
        return snapshot.enabled;
      }
      // Keep loaded=false so later mounts / scheduled retries can try again.
      setSnapshot({ enabled: false, loaded: false });
      inflight = null;
      if (listeners.size > 0) {
        scheduleRetry();
      }
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
  clearRetryTimer();
  setSnapshot({ enabled: Boolean(enabled), loaded: true });
}

/** Drop cached flag so the next consumer re-fetches. */
export function invalidateJellyfinEnabled() {
  generation += 1;
  inflight = null;
  clearRetryTimer();
  setSnapshot({ enabled: false, loaded: false });
}

/**
 * Shared Jellyfin enabled flag for gating video play-preview.
 * Module-level cache: one successful config fetch per session; failures leave
 * loaded=false and retry while subscribers remain (or on remount / settings save).
 */
export function useJellyfinEnabled() {
  const { enabled, loaded } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    void ensureLoaded();
  }, []);

  return { enabled, loaded };
}
