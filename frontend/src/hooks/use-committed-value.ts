"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

/** Event/controller callbacks read the last committed render, never a speculative render. */
export function useCommittedValue<T>(value: T): () => T {
  const valueRef = useRef(value);
  useLayoutEffect(() => {
    valueRef.current = value;
  }, [value]);
  return useCallback(() => valueRef.current, []);
}
