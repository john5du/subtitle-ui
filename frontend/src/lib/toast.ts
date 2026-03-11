export type ToastLevel = "error" | "info" | "success";

export interface AppToastPayload {
  level: ToastLevel;
  title?: string;
  message: string;
  detail?: string;
  durationMs?: number;
}

export interface AppToastEventDetail extends AppToastPayload {
  id: string;
}

export const APP_TOAST_EVENT = "subtitle-ui:toast";

export function emitToast(payload: AppToastPayload) {
  if (typeof window === "undefined") return;
  const detail: AppToastEventDetail = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ...payload
  };
  window.dispatchEvent(new CustomEvent<AppToastEventDetail>(APP_TOAST_EVENT, { detail }));
}
