"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

export type StreamKind = "progressive" | "hls";

export interface ArtPlayerHostProps {
  url: string;
  /** progressive = direct progressive/static; hls = m3u8 via hls.js (Jellyfin audio transcode path). */
  streamKind?: StreamKind;
  subtitleUrl?: string;
  subtitleName?: string;
  lang?: "en" | "zh-cn";
  className?: string;
  onError?: (message: string) => void;
}

type ArtInstance = {
  destroy: (removeHtml?: boolean) => void;
  switchUrl: (url: string) => Promise<unknown>;
  muted: boolean;
  volume: number;
  fullscreen: boolean;
  fullscreenWeb: boolean;
  subtitle: {
    switch: (url: string, option?: { name?: string; type?: string; encoding?: string; style?: Partial<CSSStyleDeclaration> }) => void | Promise<unknown>;
    show: boolean;
    style?: (name: string | Partial<CSSStyleDeclaration>, value?: string) => void;
  };
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  once: (event: string, handler: (...args: unknown[]) => void) => void;
};

const DEFAULT_SUBTITLE_STYLE: Partial<CSSStyleDeclaration> = {
  color: "#fff",
  fontSize: "20px",
  textShadow: "0 1px 2px rgba(0,0,0,.9)",
  bottom: "48px"
};

const DEFAULT_SUBTITLE_OPTION = {
  encoding: "utf-8",
  escape: false,
  style: DEFAULT_SUBTITLE_STYLE
};

function applySubtitle(art: ArtInstance, subtitleUrl: string | undefined, subtitleName: string | undefined) {
  if (!subtitleUrl) {
    try {
      art.subtitle.show = false;
    } catch {
      // ignore
    }
    return;
  }
  void Promise.resolve(
    art.subtitle.switch(subtitleUrl, {
      ...DEFAULT_SUBTITLE_OPTION,
      name: subtitleName || "subtitle",
      style: DEFAULT_SUBTITLE_STYLE
    })
  )
    .then(() => {
      art.subtitle.show = true;
      try {
        art.subtitle.style?.(DEFAULT_SUBTITLE_STYLE);
      } catch {
        // ignore
      }
    })
    .catch(() => {
      // ignore switch failures
    });
}

/**
 * Client-only ArtPlayer mount. Destroys on unmount / url change so stream stops.
 * Progressive: HTTP Range scrubbing. HLS: hls.js against ticket-proxied Jellyfin playlists.
 */
export function ArtPlayerHost({
  url,
  streamKind = "progressive",
  subtitleUrl,
  subtitleName,
  lang = "en",
  className,
  onError
}: ArtPlayerHostProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const artRef = useRef<ArtInstance | null>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);
  const generationRef = useRef(0);
  const onErrorRef = useRef(onError);
  const subtitleUrlRef = useRef(subtitleUrl);
  const subtitleNameRef = useRef(subtitleName);
  const syncSubtitleRef = useRef<() => void>(() => {});
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

      const ArtplayerCtor = Artplayer as typeof Artplayer & { FULLSCREEN_WEB_IN_BODY?: boolean };
      ArtplayerCtor.FULLSCREEN_WEB_IN_BODY = true;

      const useHls = streamKind === "hls";
      let HlsCtor: (typeof import("hls.js"))["default"] | null = null;
      if (useHls) {
        HlsCtor = (await import("hls.js")).default;
      }
      if (generation !== generationRef.current || !containerRef.current) {
        return;
      }

      const art = new Artplayer({
        container: containerRef.current,
        url,
        volume: 1,
        muted: false,
        autoplay: false,
        autoSize: false,
        autoMini: false,
        screenshot: false,
        setting: true,
        playbackRate: true,
        aspectRatio: true,
        fullscreen: true,
        fullscreenWeb: true,
        pip: false,
        mutex: true,
        backdrop: true,
        playsInline: true,
        lang,
        theme: "#3b82f6",
        type: useHls ? "m3u8" : undefined,
        customType: useHls
          ? {
              m3u8(video: HTMLVideoElement, src: string) {
                if (!HlsCtor) {
                  return;
                }
                if (HlsCtor.isSupported()) {
                  const hls = new HlsCtor({
                    enableWorker: true,
                    lowLatencyMode: false
                  });
                  hlsRef.current?.destroy();
                  hlsRef.current = hls;
                  hls.loadSource(src);
                  hls.attachMedia(video);
                  hls.on(HlsCtor.Events.ERROR, (_event, data) => {
                    if (data?.fatal) {
                      onErrorRef.current?.(
                        typeof data.type === "string"
                          ? `HLS error: ${data.type}`
                          : "HLS playback failed"
                      );
                    }
                  });
                  return;
                }
                // Safari native HLS
                video.src = src;
              }
            }
          : undefined,
        // Same-origin stream; avoid crossOrigin so blob: VTT tracks attach reliably.
        moreVideoAttr: {
          preload: "auto",
          playsInline: true
        },
        subtitle: {
          ...DEFAULT_SUBTITLE_OPTION
        }
      }) as unknown as ArtInstance;

      if (generation !== generationRef.current) {
        try {
          art.destroy(true);
        } catch {
          // ignore
        }
        hlsRef.current?.destroy();
        hlsRef.current = null;
        return;
      }

      artRef.current = art;
      let mediaReady = false;
      let appliedSubtitleUrl: string | undefined;

      // The source is already WebVTT. Apply it once after metadata is ready so
      // ArtPlayer does not race multiple short-lived Blob tracks in Safari.
      function syncSubtitle() {
        if (!mediaReady || generation !== generationRef.current) {
          return;
        }
        const nextUrl = subtitleUrlRef.current;
        if (nextUrl === appliedSubtitleUrl) {
          return;
        }
        appliedSubtitleUrl = nextUrl;
        applySubtitle(art, nextUrl, subtitleNameRef.current);
      }
      syncSubtitleRef.current = syncSubtitle;

      try {
        art.muted = false;
        art.volume = 1;
      } catch {
        // ignore
      }

      function enableWebFullscreenFallback() {
        if (generation !== generationRef.current) {
          return;
        }
        try {
          art.fullscreenWeb = true;
        } catch {
          // ignore
        }
      }

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

      art.on("video:loadedmetadata", () => {
        if (generation !== generationRef.current) {
          return;
        }
        mediaReady = true;
        syncSubtitle();
        try {
          art.muted = false;
          if (art.volume <= 0) {
            art.volume = 1;
          }
        } catch {
          // ignore
        }

        queueMicrotask(() => {
          if (generation !== generationRef.current) {
            return;
          }
          const native = Object.getOwnPropertyDescriptor(art, "fullscreen");
          if (!native || typeof native.set !== "function" || typeof native.get !== "function") {
            return;
          }
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
                void Promise.resolve(result).catch(() => enableWebFullscreenFallback());
              } catch {
                enableWebFullscreenFallback();
              }
            }
          });
        });
      });

      art.on("fullscreenError", () => {
        enableWebFullscreenFallback();
      });
      art.on("error", (...args: unknown[]) => {
        if (generation !== generationRef.current) {
          return;
        }
        const first = args[0];
        let message =
          first instanceof Error
            ? first.message
            : typeof first === "string"
              ? first
              : "Video playback failed (codec or container may be unsupported)";
        if (/DEMUXER_ERROR|MEDIA_ERR_SRC_NOT_SUPPORTED|no supported streams|open context failed/i.test(message)) {
          message =
            "Browser cannot decode this stream (container/codec). If audio is missing, ensure Jellyfin can transcode audio to AAC for preview.";
        }
        onErrorRef.current?.(message);
      });
    })();

    return () => {
      generationRef.current += 1;
      syncSubtitleRef.current = () => {};
      const hls = hlsRef.current;
      hlsRef.current = null;
      if (hls) {
        try {
          hls.destroy();
        } catch {
          // ignore
        }
      }
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
  }, [url, streamKind, lang]);

  useEffect(() => {
    syncSubtitleRef.current();
  }, [subtitleUrl, subtitleName]);

  return (
    <div
      ref={containerRef}
      className={cn("relative h-full w-full min-h-[12rem] overflow-hidden bg-black", className)}
    />
  );
}
