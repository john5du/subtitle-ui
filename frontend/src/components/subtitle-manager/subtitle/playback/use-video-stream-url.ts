"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { buildApiURL } from "@/lib/api";
import { requestPayload } from "@/lib/subtitle-manager/api-client";

export interface StreamTicketResponse {
  ticket: string;
  expiresAt: string;
  url: string;
}

const RENEW_BEFORE_MS = 90_000;

function buildStreamUrl(videoId: string, payload: StreamTicketResponse) {
  if (payload.url?.startsWith("/")) {
    return payload.url;
  }
  return `/api/videos/${videoId}/stream?ticket=${encodeURIComponent(payload.ticket)}`;
}

export function useVideoStreamUrl(videoId: string | null | undefined, enabled: boolean) {
  const [streamUrl, setStreamUrl] = useState<string>("");
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const renewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadRef = useRef<(opts?: { silent?: boolean }) => Promise<void>>(async () => {});

  const clearRenewTimer = useCallback(() => {
    if (renewTimerRef.current != null) {
      clearTimeout(renewTimerRef.current);
      renewTimerRef.current = null;
    }
  }, []);

  const reload = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!videoId || !enabled) {
        clearRenewTimer();
        abortRef.current?.abort();
        abortRef.current = null;
        setStreamUrl("");
        setStatus("idle");
        setError("");
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const requestId = ++requestIdRef.current;
      if (!opts?.silent) {
        setStatus("loading");
        setError("");
      }

      try {
        const payload = await requestPayload<StreamTicketResponse>(`/api/videos/${videoId}/stream-ticket`, {
          method: "POST",
          signal: controller.signal
        });
        if (requestId !== requestIdRef.current || controller.signal.aborted) {
          return;
        }
        setStreamUrl(buildApiURL(buildStreamUrl(videoId, payload)));
        setStatus("ready");
        setError("");

        clearRenewTimer();
        const expiresAt = Date.parse(payload.expiresAt);
        if (Number.isFinite(expiresAt)) {
          const delay = Math.max(5_000, expiresAt - Date.now() - RENEW_BEFORE_MS);
          renewTimerRef.current = setTimeout(() => {
            void reloadRef.current({ silent: true });
          }, delay);
        }
      } catch (err) {
        if (controller.signal.aborted || requestId !== requestIdRef.current) {
          return;
        }
        if (!opts?.silent) {
          setStreamUrl("");
          setStatus("error");
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    },
    [videoId, enabled, clearRenewTimer]
  );

  reloadRef.current = reload;

  useEffect(() => {
    void reload();
    return () => {
      requestIdRef.current += 1;
      clearRenewTimer();
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [reload, clearRenewTimer]);

  return { streamUrl, status, error, reload };
}
