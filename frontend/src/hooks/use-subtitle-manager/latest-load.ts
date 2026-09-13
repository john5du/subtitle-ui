import { isAbortError } from "./load-utils";

export type LoadResult<T> =
  | { status: "success"; data: T }
  | { status: "failed" }
  | { status: "cancelled" };

export function loaded<T>(data: T): LoadResult<T> {
  return { status: "success", data };
}

/** One owner for cancellation, deduplication and commit ordering within a load channel. */
export function createLatestLoad<T>() {
  let pending: { key: string; controller: AbortController; promise: Promise<LoadResult<T>> } | null = null;
  let loadedKey: string | null = null;

  function cancel() {
    pending?.controller.abort();
    pending = null;
  }

  function invalidate() {
    cancel();
    loadedKey = null;
  }

  function run(options: {
    key: string;
    force?: boolean;
    cached?: () => T;
    fetch: (signal: AbortSignal) => Promise<T>;
    commit: (data: T) => void;
    onError: (error: unknown) => void;
    onStart?: () => void;
    onEnd?: () => void;
  }): Promise<LoadResult<T>> {
    if (!options.force && pending?.key === options.key) return pending.promise;
    // Cancel before consulting the cache: A -> B -> cached A must invalidate B.
    cancel();
    if (!options.force && loadedKey === options.key && options.cached) {
      return Promise.resolve(loaded(options.cached()));
    }
    // A failed forced refresh must not leave an apparently valid cache entry.
    if (options.force) loadedKey = null;
    const controller = new AbortController();
    options.onStart?.();
    const promise = (async (): Promise<LoadResult<T>> => {
      try {
        const data = await options.fetch(controller.signal);
        if (controller.signal.aborted) return { status: "cancelled" };
        options.commit(data);
        loadedKey = options.key;
        return loaded(data);
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) return { status: "cancelled" };
        options.onError(error);
        return { status: "failed" };
      } finally {
        // Identity matters when an old and a new request use the same key.
        if (pending?.controller === controller) pending = null;
        options.onEnd?.();
      }
    })();
    pending = { key: options.key, controller, promise };
    return promise;
  }

  return { run, invalidate };
}
