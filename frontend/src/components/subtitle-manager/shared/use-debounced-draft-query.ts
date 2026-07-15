import { useEffect, useRef, useState } from "react";

/** Local draft input that publishes to parent after debounce; syncs when parent query changes. */
export function useDebouncedDraftQuery(
  query: string,
  onQueryChange: (value: string) => void,
  delayMs = 350
): [string, (value: string) => void] {
  const [draftQuery, setDraftQuery] = useState(query);
  const lastPublishedRef = useRef(query);
  const draftQueryRef = useRef(draftQuery);
  draftQueryRef.current = draftQuery;

  useEffect(() => {
    if (query !== draftQueryRef.current) {
      setDraftQuery(query);
      lastPublishedRef.current = query;
    }
  }, [query]);

  useEffect(() => {
    if (draftQuery === lastPublishedRef.current) {
      return;
    }
    const timer = window.setTimeout(() => {
      lastPublishedRef.current = draftQuery;
      onQueryChange(draftQuery);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [draftQuery, onQueryChange, delayMs]);

  return [draftQuery, setDraftQuery];
}
