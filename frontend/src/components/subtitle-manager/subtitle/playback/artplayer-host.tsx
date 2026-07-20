"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

export interface ArtPlayerHostProps {
  url: string;
  subtitleUrl?: string;
  subtitleName?: string;
  lang?: "en" | "zh-cn";
  className?: string;
  onError?: (message: string) => void;
}

type ArtInstance = {
  destroy: (removeHtml?: boolean) => void;
  switchUrl: (url: string) => Promise<unknown>;
  fullscreen: boolean;
  fullscreenWeb: boolean;
  subtitle: {
    switch: (url: string, option?: { name?: string; type?: string; encoding?: string }) => void | Promise<unknown>;
    show: boolean;
  };
  on: (event: string, handler: (...args: unknown[]) => void) => void;
};

const DEFAULT_SUBTITLE_OPTION = {
  type: "vtt" as const,
  encoding: "utf-8",
  escape: true,
  style: {
    color: "#fff",
    fontSize: "18px",
    textShadow: "0 1px 2px rgba(0,0,0,.85)"
  } as Partial<CSSStyleDeclaration>
};

function applySubtitle(art: ArtInstance, subtitleUrl: string | undefined, subtitleName: string | undefined) {
  if (!subtitleUrl) {
    art.subtitle.show = false;
    return;
  }
  void Promise.resolve(
    art.subtitle.switch(subtitleUrl, {
      ...DEFAULT_SUBTITLE_OPTION,
      name: subtitleName || "subtitle"
    })
  )
    .then(() => {
      art.subtitle.show = true;
    })
    .catch(() => {
      // ignore switch failures
    });
}

/**
 * Client-only ArtPlayer mount. Destroys on unmount / url change so stream stops.
 * Progress scrubbing relies on HTTP Range from the stream URL.
 */
export function ArtPlayerHost({ url, subtitleUrl, subtitleName, lang = "en", className, onError }: ArtPlayerHostProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const artRef = useRef<ArtInstance | null>(null);
  const generationRef = useRef(0);
  const onErrorRef = useRef(onError);
  const subtitleUrlRef = useRef(subtitleUrl);
  const subtitleNameRef = useRef(subtitleName);
  onErrorRef.current = onError;
  subtitleUrlRef.current = subtitleUrl;
  subtitleNameRef.current = subtitleName;

  useEffect(() => {
    if (!url || !containerRef.current) {
      return;
    }
    const generation = ++generationRef.current;

    void (async () => {
      const Artplayer = (await import("artplayer")).default;
      if (generation !== generationRef.current || !containerRef.current) {
        return;
      }

      const initialSubtitle = subtitleUrlRef.current;
      // Web fullscreen reparents player to document.body (Artplayer.FULLSCREEN_WEB_IN_BODY).
      // Native fullscreen is unreliable inside Radix Dialog (CSS transform + often no
      // loadedmetadata yet for remux streams), so we use web fullscreen as the primary control.
      // ArtPlayer option validator requires subtitle to be an object (never undefined).
      const ArtplayerCtor = Artplayer as typeof Artplayer & { FULLSCREEN_WEB_IN_BODY?: boolean };
      ArtplayerCtor.FULLSCREEN_WEB_IN_BODY = true;

      const art = new Artplayer({
        container: containerRef.current,
        url,
        volume: 0.8,
        autoplay: false,
        autoSize: false,
        autoMini: false,
        screenshot: false,
        setting: true,
        playbackRate: true,
        aspectRatio: true,
        // Prefer CSS/body fullscreen inside modal; keep native as secondary if metadata is ready.
        fullscreen: true,
        fullscreenWeb: true,
        pip: false,
        mutex: true,
        backdrop: true,
        playsInline: true,
        lang,
        theme: "#3b82f6",
        moreVideoAttr: {
          crossOrigin: "anonymous",
          preload: "metadata"
        },
        subtitle: {
          ...DEFAULT_SUBTITLE_OPTION,
          ...(initialSubtitle
            ? { url: initialSubtitle, name: subtitleNameRef.current || "subtitle" }
            : {})
        }
      }) as unknown as ArtInstance;

      if (generation !== generationRef.current) {
        try {
          art.destroy(true);
        } catch {
          // ignore
        }
        return;
      }

      artRef.current = art;
      // Re-apply from refs in case subtitle arrived during import.
      applySubtitle(art, subtitleUrlRef.current, subtitleNameRef.current);

      function useWebFullscreenFallback() {
        if (generation !== generationRef.current) {
          return;
        }
        try {
          art.fullscreenWeb = true;
        } catch {
          // ignore
        }
      }

      // Map native fullscreen control to web fullscreen until metadata arrives (ArtPlayer
      // only installs native FS after video:loadedmetadata — before that the button no-ops).
      Object.defineProperty(art, "fullscreen", {
        configurable: true,
        enumerable: true,
        get() {
          return art.fullscreenWeb;
        },
        set(value: boolean) {
          art.fullscreenWeb = Boolean(value);
        }
      });

      // After native FS is installed, wrap it so Dialog/transform failures fall back to web FS.
      art.on("video:loadedmetadata", () => {
        if (generation !== generationRef.current) {
          return;
        }
        queueMicrotask(() => {
          if (generation !== generationRef.current) {
            return;
          }
          const native = Object.getOwnPropertyDescriptor(art, "fullscreen");
          if (!native || typeof native.set !== "function" || typeof native.get !== "function") {
            return;
          }
          // Skip if still our web-only stub (getter reads fullscreenWeb).
          Object.defineProperty(art, "fullscreen", {
            configurable: true,
            enumerable: true,
            get() {
              try {
                return Boolean(native.get!.call(art)) || art.fullscreenWeb;
              } catch {
                return art.fullscreenWeb;
              }
            },
            set(value: boolean) {
              if (!value) {
                try {
                  native.set!.call(art, false);
                } catch {
                  // ignore
                }
                art.fullscreenWeb = false;
                return;
              }
              try {
                const result = native.set!.call(art, true) as unknown;
                void Promise.resolve(result).catch(() => useWebFullscreenFallback());
              } catch {
                useWebFullscreenFallback();
              }
            }
          });
        });
      });

      art.on("fullscreenError", () => {
        useWebFullscreenFallback();
      });
      art.on("error", (...args: unknown[]) => {
        if (generation !== generationRef.current) {
          return;
        }
        const first = args[0];
        const message =
          first instanceof Error
            ? first.message
            : typeof first === "string"
              ? first
              : "Video playback failed (codec or container may be unsupported)";
        onErrorRef.current?.(message);
      });
    })();

    return () => {
      generationRef.current += 1;
      const current = artRef.current;
      artRef.current = null;
      if (current) {
        try {
          current.destroy(true);
        } catch {
          // ignore
        }
      }
    };
  }, [url, lang]);

  useEffect(() => {
    const art = artRef.current;
    if (!art) {
      return;
    }
    applySubtitle(art, subtitleUrl, subtitleName);
  }, [subtitleUrl, subtitleName]);

  return (
    <div
      ref={containerRef}
      className={cn("relative h-full w-full min-h-[12rem] overflow-hidden bg-black", className)}
    />
  );
}
