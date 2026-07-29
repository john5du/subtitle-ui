"use client";

import { useEffect, useState } from "react";

import { useI18n } from "@/lib/i18n";
import { emitToast } from "@/lib/toast";
import type { MCPConfig } from "@/lib/types";
import { requestPayload } from "@/lib/subtitle-manager/api-client";
import { Switch } from "@/components/ui/switch";

import { SpinnerIcon } from "../pending-state";
import { SaveSettingsButton } from "./settings-shared";

export function MCPSettingsPanel() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<MCPConfig | null>(null);
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      setLoading(true);
      setError("");
      try {
        const next = await requestPayload<MCPConfig>("/api/config/mcp");
        if (cancelled) {
          return;
        }
        setConfig(next);
        setDraftEnabled(Boolean(next.enabled));
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        const message = loadError instanceof Error ? loadError.message : String(loadError);
        setError(message);
        emitToast({
          level: "error",
          message: t("mcp.settingsLoadFailed"),
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
      const next = await requestPayload<MCPConfig>("/api/config/mcp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: draftEnabled })
      });
      setConfig(next);
      setDraftEnabled(Boolean(next.enabled));
      emitToast({
        level: "success",
        message: t("mcp.settingsSavedTitle")
      });
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError);
      setError(message);
      emitToast({
        level: "error",
        message: t("mcp.settingsSaveFailed"),
        detail: message
      });
    } finally {
      setSaving(false);
    }
  }

  const endpoint = config?.endpoint || "/mcp";

  return (
    <div className="surface-panel space-y-4 p-3 sm:p-4">
      <p className="text-xs text-muted-foreground">{t("mcp.settingsDescription")}</p>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-section text-foreground-muted">{t("mcp.enabled")}</p>
        <Switch
          checked={draftEnabled}
          onCheckedChange={setDraftEnabled}
          disabled={loading || saving}
          aria-label={t("mcp.enabled")}
          title={draftEnabled ? t("mcp.enabledOn") : t("mcp.enabledOff")}
        />
      </div>

      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-section text-foreground-muted">{t("mcp.endpoint")}</p>
        <p className="break-all font-mono text-sm text-foreground">{endpoint}</p>
        <p className="text-xs text-muted-foreground">{t("mcp.endpointHint")}</p>
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
          label={t("mcp.saveSettings")}
          savingLabel={t("common.saving")}
          onClick={() => void saveConfig()}
        />
      </div>
    </div>
  );
}
