import type { ControllerRuntime } from "./controller-runtime";
import type { LoadActions } from "./controller-load";
import { createSubtitleBatchActions } from "./controller-subtitle-batch";
import { createSubtitleRefresh } from "./controller-subtitle-refresh";
import { createSubtitleSubHDActions } from "./controller-subtitle-subhd";
import { createSubtitleTrackActions } from "./controller-subtitle-track";

export function createSubtitleActions(runtime: ControllerRuntime, load: LoadActions) {
  const refresh = createSubtitleRefresh(runtime, load);
  const track = createSubtitleTrackActions(runtime, refresh);
  const batch = createSubtitleBatchActions(runtime, load, refresh);
  const subhd = createSubtitleSubHDActions(runtime, load, refresh);

  return {
    ...track,
    ...batch,
    ...subhd,
    refreshVideoAfterMutation: refresh.refreshVideoAfterMutation,
    refreshSeriesVideos: refresh.refreshSeriesVideos
  };
}

export type SubtitleActions = ReturnType<typeof createSubtitleActions>;
