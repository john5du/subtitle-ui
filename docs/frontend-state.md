# Frontend state and loading

## Request lifecycle

The subtitle manager's movie list, TV series list, episode list, and logs use
`createLatestLoad` in `frontend/src/hooks/use-subtitle-manager/latest-load.ts`.
Each channel owns its pending request and cache identity; these are not React state.

- Cancel an obsolete request **before** returning a cached result.
- Deduplicate ordinary requests with the same key. A forced refresh replaces even
  a matching in-flight request and invalidates the cached result.
- Check cancellation after reading the response, before committing it. Some
  transports may still finish reading a response after cancellation.
- Clean up pending requests by controller identity, not by key: two generations
  can use the same key.
- Loaders return `LoadResult<T>` (`success`, `failed`, or `cancelled`). Only a
  successful result may trigger a refresh-success notification or mark a tab loaded.
  Errors are reported by the loader; cancellation is silent.
- Suspend log reads for the full duration of log deletion. On failure, retain the
  last displayed logs and permit retries. On success, clear them.
- Cancel all load channels when the manager unmounts. Effect cleanup must also
  work with Strict Mode's setup/cleanup/setup cycle.

`controller-load.test.ts` exercises real loaders and the state reducer with
controlled responses, including responses deliberately delivered after abort.

## React state

The reducer owns UI data. Controllers read the last committed state through
`useCommittedValue`; never publish state or callbacks to refs during render.
Controller actions are stable and can be forwarded without additional callback wrappers.

Prefer deriving values directly from inputs. Editable drafts may reset with a
conditional render-time update when their source changes; guard the update with
stable source identity so it converges. Do not mirror derived values through an effect.
Keep actual network subscriptions, DOM observers, and browser storage hydration in effects.

`refs`, `immutability`, and `set-state-in-effect` are errors globally. A narrow
`set-state-in-effect` exception needs an inline explanation of the external system
being synchronized (for example, the loading state of a cancellable request).
Do not disable these rules for a directory or the entire application.
