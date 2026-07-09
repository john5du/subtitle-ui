import type { MessageKey, TranslateFn, TranslationValues } from "@/lib/i18n";
import { emitToast } from "@/lib/toast";
import type { PendingSubtitleAction } from "@/lib/types";

import type {
  LoadChannel,
  SubtitleManagerSelectors,
  SubtitleManagerStateApi
} from "./types";

export interface ControllerRuntimeParams {
  stateApi: SubtitleManagerStateApi;
  selectors: SubtitleManagerSelectors;
  t: TranslateFn;
}

export function buildRequestSignature(parts: Array<string | number>) {
  return parts.join("\u0001");
}

export function formatOffsetMilliseconds(offsetMs: number) {
  const seconds = offsetMs / 1000;
  const text = Number.isInteger(seconds)
    ? seconds.toFixed(0)
    : seconds.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return `${offsetMs > 0 ? "+" : ""}${text}s`;
}

export function createControllerRuntime({ stateApi, selectors, t }: ControllerRuntimeParams) {
  const { state, setters, refs } = stateApi;

  function beginLoadChannel(channel: LoadChannel) {
    refs.pendingLoadChannelsRef.current[channel] += 1;
    setters.setPending((prev) => ({ ...prev, [channel]: true }));
  }

  function endLoadChannel(channel: LoadChannel) {
    refs.pendingLoadChannelsRef.current[channel] = Math.max(0, refs.pendingLoadChannelsRef.current[channel] - 1);
    if (refs.pendingLoadChannelsRef.current[channel] === 0) {
      setters.setPending((prev) => ({ ...prev, [channel]: false }));
    }
  }

  function setSubtitleActionPending(action: PendingSubtitleAction | null) {
    setters.setPending((prev) => ({ ...prev, subtitleAction: action }));
  }

  function finishBootstrapping() {
    setters.setPending((prev) => (prev.bootstrapping ? { ...prev, bootstrapping: false } : prev));
  }

  function beginLoading() {
    refs.pendingLoadsRef.current += 1;
    setters.setLoading(true);
  }

  function endLoading() {
    refs.pendingLoadsRef.current = Math.max(0, refs.pendingLoadsRef.current - 1);
    if (refs.pendingLoadsRef.current === 0) {
      setters.setLoading(false);
    }
  }

  function setTranslatedMessage(key: MessageKey, values?: TranslationValues) {
    setters.setMessageState({ key, values });
  }

  function beginUpload(key: MessageKey, values?: TranslationValues) {
    refs.pendingUploadsRef.current += 1;
    setters.setUploadingMessageState({ key, values });
    setters.setUploading(true);
  }

  function updateUploadMessage(key: MessageKey, values?: TranslationValues) {
    setters.setUploadingMessageState({ key, values });
  }

  function endUpload() {
    refs.pendingUploadsRef.current = Math.max(0, refs.pendingUploadsRef.current - 1);
    if (refs.pendingUploadsRef.current === 0) {
      setters.setUploading(false);
      setters.setUploadingMessageState(null);
    }
  }

  function reportRequestError(prefix: MessageKey, error: unknown) {
    const errorText = error instanceof Error ? error.message : String(error);
    const title = t(prefix);
    setters.setMessageState({ raw: `${title}: ${errorText}` });
    emitToast({
      level: "error",
      title,
      message: errorText,
      detail: t("toast.operationFailedDetail")
    });
  }

  function notifySuccess(title: string, message: string, detail?: string) {
    emitToast({
      level: "success",
      title,
      message,
      detail
    });
  }

  function notifyInfo(title: string, message: string, detail?: string) {
    emitToast({
      level: "info",
      title,
      message,
      detail
    });
  }

  return {
    state,
    setters,
    refs,
    selectors,
    t,
    beginLoadChannel,
    endLoadChannel,
    setSubtitleActionPending,
    finishBootstrapping,
    beginLoading,
    endLoading,
    setTranslatedMessage,
    beginUpload,
    updateUploadMessage,
    endUpload,
    reportRequestError,
    notifySuccess,
    notifyInfo
  };
}

export type ControllerRuntime = ReturnType<typeof createControllerRuntime>;
