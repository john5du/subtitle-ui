"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { requestBinary } from "@/lib/subtitle-manager/api-client";
import type { Subtitle, Video } from "@/lib/types";
import { subtitleLanguageDisplayText } from "@/lib/subtitle-language";

import { InlinePending } from "../../shared/pending-state";
import { ArtPlayerHost } from "../playback/artplayer-host";
import { decodeSubtitleFullContent } from "../preview-utils";
import {
  isPlaybackSubtitleFormatSupported,
  subtitleTextToVttBlobUrl
} from "../playback/subtitle-to-vtt";
import { useVideoStreamUrl } from "../playback/use-video-stream-url";

export interface VideoSubtitlePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  video: Video | null;
  initialSubtitleId?: string;
  /** Kept for call-site compatibility; dialog loads content with AbortSignal directly. */
  onLoadSubtitleContent?: (video: Video, subtitle: Subtitle) => Promise<ArrayBuffer>;
}

export function VideoSubtitlePreviewDialog({
  open,
  onOpenChange,
  video,
  initialSubtitleId
}: VideoSubtitlePreviewDialogProps) {
  const { t, locale } = useI18n();
  const artLang = locale === "zh-CN" ? "zh-cn" : "en";
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<string>("__none__");
  const [subtitleBlobUrl, setSubtitleBlobUrl] = useState("");
  const [subtitleStatus, setSubtitleStatus] = useState<
    "idle" | "loading" | "ready" | "error" | "empty" | "unsupported"
  >("idle");
  const [subtitleError, setSubtitleError] = useState("");
  const [playerError, setPlayerError] = useState("");

  const videoId = video?.id ?? null;
  const {
    streamUrl,
    streamKind,
    status: streamStatus,
    error: streamError
  } = useVideoStreamUrl(videoId, open && Boolean(videoId));

  const subtitles = useMemo(() => video?.subtitles ?? [], [video?.subtitles]);
  const selectedSubtitle = useMemo(
    () => (selectedSubtitleId === "__none__" ? null : (subtitles.find((s) => s.id === selectedSubtitleId) ?? null)),
    [subtitles, selectedSubtitleId]
  );
  const selectedSubtitleKey = selectedSubtitle
    ? `${selectedSubtitle.id}|${selectedSubtitle.format}|${selectedSubtitle.modTime}|${selectedSubtitle.size}`
    : "";
  const selectedSubtitleRef = useRef(selectedSubtitle);
  selectedSubtitleRef.current = selectedSubtitle;

  useEffect(() => {
    if (!open || !videoId) {
      setSelectedSubtitleId("__none__");
      setSubtitleBlobUrl("");
      setSubtitleStatus("idle");
      setSubtitleError("");
      setPlayerError("");
      return;
    }
    const preferred =
      (initialSubtitleId && subtitles.some((s) => s.id === initialSubtitleId) && initialSubtitleId) ||
      subtitles[0]?.id ||
      "__none__";
    setSelectedSubtitleId(preferred);
    setPlayerError("");
    // only reset selection when dialog opens or video changes
  }, [open, videoId, initialSubtitleId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const controller = new AbortController();
    let createdUrl = "";
    const track = selectedSubtitleRef.current;

    async function loadSubtitle() {
      setSubtitleBlobUrl("");
      setSubtitleError("");

      if (!open || !videoId || !selectedSubtitleKey || !track) {
        setSubtitleStatus("idle");
        return;
      }

      const format = track.format || "srt";
      if (!isPlaybackSubtitleFormatSupported(format)) {
        setSubtitleStatus("unsupported");
        return;
      }

      setSubtitleStatus("loading");
      try {
        const buffer = await requestBinary(`/api/videos/${videoId}/subtitles/${track.id}/content`, {
          signal: controller.signal
        });
        if (controller.signal.aborted) {
          return;
        }
        const decoded = decodeSubtitleFullContent(buffer);
        if (!decoded.text.trim()) {
          setSubtitleStatus("empty");
          return;
        }
        const url = subtitleTextToVttBlobUrl(decoded.text, format);
        if (!url) {
          setSubtitleStatus(format === "sub" ? "unsupported" : "empty");
          return;
        }
        createdUrl = url;
        setSubtitleBlobUrl(url);
        setSubtitleStatus("ready");
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }
        setSubtitleStatus("error");
        setSubtitleError(err instanceof Error ? err.message : String(err));
      }
    }

    void loadSubtitle();
    return () => {
      controller.abort();
      // Delay revoke so ArtPlayer can finish loading the blob track after unmount race.
      if (createdUrl) {
        const toRevoke = createdUrl;
        window.setTimeout(() => URL.revokeObjectURL(toRevoke), 30_000);
      }
    };
  }, [open, videoId, selectedSubtitleKey]);

  const title = video?.title || video?.fileName || t("playback.previewTitle");
  // Wait for subtitle settle (ready/empty/error/unsupported/none) so first paint can include VTT.
  const subtitleSettled =
    selectedSubtitleId === "__none__" ||
    subtitleStatus === "ready" ||
    subtitleStatus === "empty" ||
    subtitleStatus === "error" ||
    subtitleStatus === "unsupported" ||
    subtitleStatus === "idle";
  const showPlayer = open && streamStatus === "ready" && Boolean(streamUrl) && subtitleSettled;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="gap-3">
        <DialogHeader>
          <DialogTitle>{t("playback.previewTitleWithName", { name: title })}</DialogTitle>
        </DialogHeader>

        <DialogBody className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">{t("playback.subtitleTrack")}</span>
            <Select value={selectedSubtitleId} onValueChange={setSelectedSubtitleId}>
              <SelectTrigger className="h-9 w-[min(100%,20rem)]" size="sm">
                <SelectValue placeholder={t("playback.noSubtitle")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t("playback.noSubtitle")}</SelectItem>
                {subtitles.map((sub) => (
                  <SelectItem key={sub.id} value={sub.id}>
                    {subtitleLanguageDisplayText(sub.language, t)} · {sub.fileName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {subtitleStatus === "loading" ? <InlinePending label={t("playback.subtitleLoading")} /> : null}
            {subtitleStatus === "error" ? (
              <span className="text-xs text-destructive">{t("playback.subtitleFailed", { error: subtitleError })}</span>
            ) : null}
            {subtitleStatus === "empty" ? (
              <span className="text-xs text-muted-foreground">{t("playback.subtitleEmpty")}</span>
            ) : null}
            {subtitleStatus === "unsupported" ? (
              <span className="text-xs text-muted-foreground">{t("playback.subtitleUnsupported")}</span>
            ) : null}
          </div>

          <div className="relative min-h-0 flex-1 overflow-hidden rounded-[var(--radius)] border border-border bg-black">
            {streamStatus === "loading" || streamStatus === "idle" ? (
              <div className="flex h-full min-h-[16rem] items-center justify-center">
                <InlinePending label={t("playback.streamLoading")} />
              </div>
            ) : null}
            {streamStatus === "error" ? (
              <div className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-2 p-4 text-center text-sm text-destructive">
                <p>
                  {/preview unavailable|unplayable|HDR|tonemap/i.test(streamError || "")
                    ? t("playback.streamUnplayable")
                    : t("playback.streamFailed", { error: streamError || "-" })}
                </p>
                {/preview unavailable|unplayable|HDR|tonemap/i.test(streamError || "") && streamError ? (
                  <p className="max-w-lg text-xs text-muted-foreground">{streamError}</p>
                ) : null}
              </div>
            ) : null}
            {showPlayer ? (
              <ArtPlayerHost
                key={`${streamKind}:${streamUrl}`}
                url={streamUrl}
                streamKind={streamKind}
                subtitleUrl={subtitleStatus === "ready" ? subtitleBlobUrl : undefined}
                subtitleName={selectedSubtitle?.fileName}
                lang={artLang}
                className="aspect-video max-h-full w-full"
                onError={(message) => setPlayerError(message)}
              />
            ) : null}
            {playerError ? (
              <div className="absolute inset-x-0 bottom-0 bg-black/70 p-2 text-center text-xs text-amber-200">
                {t("playback.playerError", { error: playerError })}
              </div>
            ) : null}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
