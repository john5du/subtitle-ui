import { createMiscLoadActions } from "./load-misc";
import { createMovieLoadActions } from "./load-movie";
import { createTvLoadActions } from "./load-tv";
import type { ControllerRuntime } from "./controller-runtime";

export function createLoadActions(runtime: ControllerRuntime) {
  return {
    ...createMovieLoadActions(runtime),
    ...createTvLoadActions(runtime),
    ...createMiscLoadActions(runtime)
  };
}

export type LoadActions = ReturnType<typeof createLoadActions>;
