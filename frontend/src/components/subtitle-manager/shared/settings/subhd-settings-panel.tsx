"use client";

import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { emitToast } from "@/lib/toast";
import type { SubHDConfig } from "@/lib/types";
import { requestPayload } from "@/lib/subtitle-manager/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import { SpinnerIcon } from "../pending-state";
import { SaveSettingsButton } from "./settings-shared";

export function SubHDSettingsPanel() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<SubHDConfig | null>(null);
  const [draftEnabled, setDraftEnabled] = useState(true);
  const [draftBaseUrl, setDraftBaseUrl] = useState("");
  const [draftProxy, setDraftProxy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      setLoading(true);
      setError("");
      try {
        const next = await requestPayload<SubHDConfig>("/api/config/subhd");
        if (cancelled) {
          return;
        }
        setConfig(next);
        setDraftEnabled(Boolean(next.enabled));
        setDraftBaseUrl(next.baseUrl || next.defaultBaseUrl || "");
        setDraftProxy(next.proxy || "");
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        const message = loadError instanceof Error ? loadError.message : String(loadError);
        setError(message);
        emitToast({
          level: "error",
          message: t("subhd.settingsLoadFailed"),
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
      const next = await requestPayload<SubHDConfig>("/api/config/subhd", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: draftEnabled,
          baseUrl: draftBaseUrl.trim(),
          proxy: draftProxy.trim()
        })
      });
      setConfig(next);
      setDraftEnabled(Boolean(next.enabled));
      setDraftBaseUrl(next.baseUrl || next.defaultBaseUrl || "");
      setDraftProxy(next.proxy || "");
      emitToast({
        level: "success",
        message: t("subhd.settingsSavedTitle")
      });
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError);
      setError(message);
      emitToast({
        level: "error",
        message: t("subhd.settingsSaveFailed"),
        detail: message
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="surface-panel space-y-4 p-3 sm:p-4">

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-section text-foreground-muted">{t("subhd.enabled")}</p>
          <Switch
            checked={draftEnabled}
            onCheckedChange={setDraftEnabled}
            disabled={loading || saving}
            aria-label={t("subhd.enabled")}
            title={draftEnabled ? t("subhd.enabledOn") : t("subhd.enabledOff")}
          />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-section text-foreground-muted">{t("subhd.baseUrl")}</p>
          <div className="flex items-center gap-2">
            <Input
              size="sm"
              value={draftBaseUrl}
              placeholder={t("subhd.baseUrlPlaceholder")}
              disabled={loading || saving || !draftEnabled}
              className="min-w-0 flex-1"
              onChange={(event) => {
                setDraftBaseUrl(event.target.value);
                setError("");
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={loading || saving || !draftEnabled || !config?.defaultBaseUrl}
              onClick={() => {
                setDraftBaseUrl(config?.defaultBaseUrl || "");
                setError("");
              }}
              aria-label={t("subhd.restoreDefaultBaseUrl")}
              title={t("subhd.restoreDefaultBaseUrl")}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-section text-foreground-muted">{t("subhd.proxy")}</p>
        <Input
          size="sm"
          value={draftProxy}
          placeholder={t("subhd.proxyPlaceholder")}
          disabled={loading || saving || !draftEnabled}
          onChange={(event) => {
            setDraftProxy(event.target.value);
            setError("");
          }}
        />
        <p className="text-xs text-muted-foreground">{t("subhd.proxyHint")}</p>
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
          label={t("subhd.saveSettings")}
          savingLabel={t("common.saving")}
          onClick={() => void saveConfig()}
        />
      </div>
    </div>
  );
}

