"use client";

import { SubtitleManagerShell } from "./app-shell/subtitle-manager-shell";
import { useSubtitleManagerScreenModel } from "./hooks/use-subtitle-manager-screen-model";

export function SubtitleManagerApp() {
  const model = useSubtitleManagerScreenModel();
  return <SubtitleManagerShell model={model} />;
}
