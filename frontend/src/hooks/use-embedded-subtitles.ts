"use client";

import { useEffect, useState } from "react";

import { ApiRequestError, requestPayload } from "@/lib/subtitle-manager/api-client";
import type { EmbeddedSubtitleList, EmbeddedSubtitleTrack } from "@/lib/types";

export type EmbeddedSubtitlesState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; tracks: EmbeddedSubtitleTrack[] }
  | { status: "hidden" }
  | { status: "unavailable" }
  | { status: "error"; message: string };

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; tracks: EmbeddedSubtitleTrack[] }>();
const hiddenCache = new Map<string, number>();

function readCache(videoId: string): EmbeddedSubtitleTrack[] | null {
  const hit = cache.get(videoId);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(videoId);
    return null;
  }
  return hit.tracks;
}

function isHiddenCached(videoId: string): boolean {
  const at = hiddenCache.get(videoId);
  if (at == null) return false;
  if (Date.now() - at > CACHE_TTL_MS) {
    hiddenCache.delete(videoId);
    return false;
  }
  return true;
}

/** Lazy-load embedded (muxed) subtitle tracks via Jellyfin when enabled. */
export function useEmbeddedSubtitles(videoId: string | undefined, jellyfinEnabled: boolean) {
  const [state, setState] = useState<EmbeddedSubtitlesState>({ status: "idle" });

  useEffect(() => {
    if (!videoId || !jellyfinEnabled) {
      setState({ status: "idle" });
      return;
    }

    const cached = readCache(videoId);
    if (cached) {
      setState({ status: "ready", tracks: cached });
      return;
    }
    if (isHiddenCached(videoId)) {
      setState({ status: "hidden" });
      return;
    }

    const controller = new AbortController();
    setState({ status: "loading" });

    void (async () => {
      try {
        const payload = await requestPayload<EmbeddedSubtitleList>(`/api/videos/${encodeURIComponent(videoId)}/subtitles/embedded`, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal
        });
        if (controller.signal.aborted) return;
        const tracks = Array.isArray(payload?.tracks) ? payload.tracks : [];
        cache.set(videoId, { at: Date.now(), tracks });
        hiddenCache.delete(videoId);
        setState({ status: "ready", tracks });
      } catch (err) {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
          return;
        }
        if (err instanceof ApiRequestError && err.status === 404) {
          // Item not in Jellyfin / path map miss — stay quiet.
          hiddenCache.set(videoId, Date.now());
          setState({ status: "hidden" });
          return;
        }
        if (err instanceof ApiRequestError && err.status === 503) {
          setState({ status: "unavailable" });
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        setState({ status: "error", message });
      }
    })();

    return () => {
      controller.abort();
    };
  }, [videoId, jellyfinEnabled]);

  return state;
}
