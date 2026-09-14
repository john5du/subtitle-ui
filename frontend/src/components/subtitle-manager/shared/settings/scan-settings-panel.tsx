"use client";

import { useEffect, useMemo, useState } from "react";

import { useI18n } from "@/lib/i18n";
import { emitToast } from "@/lib/toast";
import type { ScanConfig } from "@/lib/types";
import { requestPayload } from "@/lib/subtitle-manager/api-client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import { SpinnerIcon } from "../pending-state";
import { SaveSettingsButton, SettingsLabel } from "./settings-shared";

const SCAN_INTERVAL_PRESETS = ["15m", "30m", "1h", "3h", "6h", "12h", "24h"];

function intervalOptions(current: string): string[] {
  const value = current.trim();
  if (value && !SCAN_INTERVAL_PRESETS.includes(value)) {
    return [value, ...SCAN_INTERVAL_PRESETS];
  }
  return [...SCAN_INTERVAL_PRESETS];
}

export function ScanSettingsPanel() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draftEnabled, setDraftEnabled] = useState(true);
  const [draftInterval, setDraftInterval] = useState("1h");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      setLoading(true);
      setError("");
      try {
        const next = await requestPayload<ScanConfig>("/api/config/scan");
        if (cancelled) {
          return;
        }
        setDraftEnabled(Boolean(next.enabled));
        setDraftInterval(next.interval || "1h");
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        const message = loadError instanceof Error ? loadError.message : String(loadError);
        setError(message);
        emitToast({
          level: "error",
          message: t("scan.settingsLoadFailed"),
          detail: message
        });
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, [t]);

  async function saveConfig() {
    setSaving(true);
    setError("");
    try {
      const next = await requestPayload<ScanConfig>("/api/config/scan", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: draftEnabled, interval: draftInterval })
      });
      setDraftEnabled(Boolean(next.enabled));
      setDraftInterval(next.interval || "1h");
      emitToast({
        level: "success",
        message: t("scan.settingsSavedTitle")
      });
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError);
      setError(message);
      emitToast({
        level: "error",
        message: t("scan.settingsSaveFailed"),
        detail: message
      });
    } finally {
      setSaving(false);
    }
  }

  const options = useMemo(() => intervalOptions(draftInterval), [draftInterval]);

  return (
    <div className="surface-panel space-y-4 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <SettingsLabel>{t("scan.enabled")}</SettingsLabel>
        <Switch
          checked={draftEnabled}
          onCheckedChange={setDraftEnabled}
          disabled={loading || saving}
          aria-label={t("scan.enabled")}
          title={draftEnabled ? t("scan.enabledOn") : t("scan.enabledOff")}
        />
      </div>

      <div className="flex min-h-9 items-center justify-between gap-3">
        <SettingsLabel className="min-w-0 shrink" help={t("scan.intervalHelp")}>
          {t("scan.interval")}
        </SettingsLabel>
        <div className="shrink-0">
          <Select value={draftInterval} onValueChange={setDraftInterval} disabled={loading || saving}>
            <SelectTrigger size="sm" className="w-[140px]" aria-label={t("scan.interval")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((interval) => (
                <SelectItem key={interval} value={interval}>
                  {interval}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <SpinnerIcon className="h-4 w-4" />
        </div>
      )}
      {error && <p className="break-words text-sm text-destructive">{error}</p>}

      <div className="flex justify-end">
        <SaveSettingsButton
          saving={saving}
          disabled={loading || saving}
          label={t("scan.saveSettings")}
          savingLabel={t("common.saving")}
          onClick={() => void saveConfig()}
        />
      </div>
    </div>
  );
}
