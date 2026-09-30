"use client";

import { useCallback, useRef, useState } from "react";

import { useI18n, type MessageKey } from "@/lib/i18n";
import { emitToast } from "@/lib/toast";
import type { ConnectionTestResult } from "@/lib/types";

export function useSettingsForm() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const loadGeneration = useRef(0);

  const load = useCallback(async (task: () => Promise<void>, failKey: MessageKey, isCancelled?: () => boolean) => {
    const generation = loadGeneration.current + 1;
    loadGeneration.current = generation;
    const stale = () => generation !== loadGeneration.current || Boolean(isCancelled?.());
    setLoading(true);
    setError("");
    try {
      await task();
    } catch (loadError) {
      if (stale()) {
        return;
      }
      const message = loadError instanceof Error ? loadError.message : String(loadError);
      setError(message);
      emitToast({
        level: "error",
        message: t(failKey),
        detail: message
      });
    } finally {
      if (!stale()) {
        setLoading(false);
      }
    }
  }, [t]);

  const save = useCallback(async (task: () => Promise<void>, failKey: MessageKey, savedKey: MessageKey) => {
    setSaving(true);
    setError("");
    try {
      await task();
      emitToast({
        level: "success",
        message: t(savedKey)
      });
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError);
      setError(message);
      emitToast({
        level: "error",
        message: t(failKey),
        detail: message
      });
    } finally {
      setSaving(false);
    }
  }, [t]);

  const test = useCallback(async (task: () => Promise<ConnectionTestResult>, failKey: MessageKey, okKey: MessageKey) => {
    setTesting(true);
    setError("");
    try {
      const result = await task();
      if (result.ok) {
        emitToast({
          level: "success",
          message: t(okKey),
          detail: result.message && result.message !== "ok" ? result.message : undefined
        });
        return;
      }
      const detail = result.message || t(failKey);
      setError(detail);
      emitToast({
        level: "error",
        message: t(failKey),
        detail
      });
    } catch (testError) {
      const message = testError instanceof Error ? testError.message : String(testError);
      setError(message);
      emitToast({
        level: "error",
        message: t(failKey),
        detail: message
      });
    } finally {
      setTesting(false);
    }
  }, [t]);

  return {
    loading,
    saving,
    testing,
    error,
    setError,
    busy: loading || saving || testing,
    load,
    save,
    test
  };
}
