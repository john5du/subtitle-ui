"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { emitToast } from "@/lib/toast";
import type { ConnectionTestResult, SonarrConfig } from "@/lib/types";
import { requestPayload } from "@/lib/subtitle-manager/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import { SpinnerIcon } from "../pending-state";
import { SaveSettingsButton, TestConnectionButton } from "./settings-shared";

export function SonarrSettingsPanel() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [draftUrl, setDraftUrl] = useState("");
  const [draftApiKey, setDraftApiKey] = useState("");
  const [apiKeySet, setApiKeySet] = useState(false);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      setLoading(true);
      setError("");
      try {
        const next = await requestPayload<SonarrConfig>("/api/config/sonarr");
        if (cancelled) {
          return;
        }
        setDraftEnabled(Boolean(next.enabled));
        setDraftUrl(next.url || "");
        setDraftApiKey("");
        setApiKeySet(Boolean(next.apiKeySet));
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        const message = loadError instanceof Error ? loadError.message : String(loadError);
        setError(message);
        emitToast({
          level: "error",
          message: t("sonarr.settingsLoadFailed"),
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
      const next = await requestPayload<SonarrConfig>("/api/config/sonarr", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: draftEnabled,
          url: draftUrl.trim(),
          apiKey: draftApiKey.trim()
        })
      });
      setDraftEnabled(Boolean(next.enabled));
      setDraftUrl(next.url || "");
      setDraftApiKey("");
      setApiKeySet(Boolean(next.apiKeySet));
      emitToast({
        level: "success",
        message: t("sonarr.settingsSavedTitle")
      });
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError);
      setError(message);
      emitToast({
        level: "error",
        message: t("sonarr.settingsSaveFailed"),
        detail: message
      });
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setError("");
    try {
      const result = await requestPayload<ConnectionTestResult>("/api/config/sonarr/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: true,
          url: draftUrl.trim(),
          apiKey: draftApiKey.trim()
        })
      });
      if (result.ok) {
        emitToast({
          level: "success",
          message: t("sonarr.testConnectionOk")
        });
      } else {
        const detail = result.message || t("sonarr.testConnectionFailed");
        setError(detail);
        emitToast({
          level: "error",
          message: t("sonarr.testConnectionFailed"),
          detail
        });
      }
    } catch (testError) {
      const message = testError instanceof Error ? testError.message : String(testError);
      setError(message);
      emitToast({
        level: "error",
        message: t("sonarr.testConnectionFailed"),
        detail: message
      });
    } finally {
      setTesting(false);
    }
  }

  const busy = loading || saving || testing;
  const canTest = Boolean(draftUrl.trim() && (draftApiKey.trim() || apiKeySet));

  return (
    <div className="surface-panel space-y-4 p-3 sm:p-4">

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-section text-foreground-muted">{t("sonarr.enabled")}</p>
          <Switch
            checked={draftEnabled}
            onCheckedChange={setDraftEnabled}
            disabled={busy}
            aria-label={t("sonarr.enabled")}
            title={draftEnabled ? t("sonarr.enabledOn") : t("sonarr.enabledOff")}
          />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-section text-foreground-muted">{t("sonarr.url")}</p>
          <Input
            size="sm"
            value={draftUrl}
            placeholder={t("sonarr.urlPlaceholder")}
            disabled={busy || !draftEnabled}
            onChange={(event) => {
              setDraftUrl(event.target.value);
              setError("");
            }}
          />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-section text-foreground-muted">{t("sonarr.apiKey")}</p>
        <div className="relative">
          <Input
            size="sm"
            type={apiKeyVisible ? "text" : "password"}
            autoComplete="off"
            value={draftApiKey}
            placeholder={apiKeySet ? t("sonarr.apiKeyConfiguredPlaceholder") : t("sonarr.apiKeyPlaceholder")}
            disabled={busy || !draftEnabled}
            className="pr-10"
            onChange={(event) => {
              setDraftApiKey(event.target.value);
              setError("");
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-0.5 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            disabled={busy || !draftEnabled}
            onClick={() => setApiKeyVisible((prev) => !prev)}
            aria-label={apiKeyVisible ? t("common.hide") : t("common.show")}
            title={apiKeyVisible ? t("common.hide") : t("common.show")}
          >
            {apiKeyVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("sonarr.apiKeyHint")}</p>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <SpinnerIcon className="h-4 w-4" />
        </div>
      )}
      {error && <p className="break-words text-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <TestConnectionButton
          testing={testing}
          disabled={busy || !canTest}
          label={t("sonarr.testConnection")}
          testingLabel={t("sonarr.testingConnection")}
          onClick={() => void testConnection()}
        />
        <SaveSettingsButton
          saving={saving}
          disabled={busy}
          label={t("sonarr.saveSettings")}
          savingLabel={t("common.saving")}
          onClick={() => void saveConfig()}
        />
      </div>
    </div>
  );
}

