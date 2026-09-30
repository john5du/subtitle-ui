"use client";

import { useEffect, useState } from "react";

import { setJellyfinEnabledCache } from "@/hooks/use-jellyfin-enabled";
import { useI18n } from "@/lib/i18n";
import type { ConnectionTestResult, JellyfinConfig } from "@/lib/types";
import { requestPayload } from "@/lib/subtitle-manager/api-client";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import { SpinnerIcon } from "../pending-state";
import { SaveSettingsButton, SettingsLabel, TestConnectionButton } from "./settings-shared";
import { useSettingsForm } from "./use-settings-form";

export function JellyfinSettingsPanel() {
  const { t } = useI18n();
  const { load, save, test, loading, saving, testing, error, setError, busy } = useSettingsForm();
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [draftUrl, setDraftUrl] = useState("");
  const [draftApiKey, setDraftApiKey] = useState("");
  const [apiKeySet, setApiKeySet] = useState(false);
  const [draftPathMap, setDraftPathMap] = useState("");

  useEffect(() => {
    let cancelled = false;
    void load(async () => {
      const next = await requestPayload<JellyfinConfig>("/api/config/jellyfin");
      if (cancelled) {
        return;
      }
      setDraftEnabled(Boolean(next.enabled));
      setDraftUrl(next.url || "");
      setDraftApiKey("");
      setApiKeySet(Boolean(next.apiKeySet));
      setDraftPathMap(next.pathMap || "");
    }, "jellyfin.settingsLoadFailed", () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  const canTest = Boolean(draftUrl.trim() && (draftApiKey.trim() || apiKeySet));

  return (
    <div className="surface-panel space-y-4 p-3 sm:p-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <SettingsLabel>{t("jellyfin.enabled")}</SettingsLabel>
          <Switch
            checked={draftEnabled}
            onCheckedChange={setDraftEnabled}
            disabled={busy}
            aria-label={t("jellyfin.enabled")}
            title={draftEnabled ? t("jellyfin.enabledOn") : t("jellyfin.enabledOff")}
          />
        </div>

        <div className="space-y-2">
          <SettingsLabel>{t("jellyfin.url")}</SettingsLabel>
          <Input
            size="sm"
            aria-label={t("jellyfin.url")}
            value={draftUrl}
            placeholder={t("jellyfin.urlPlaceholder")}
            disabled={busy || !draftEnabled}
            onChange={(event) => {
              setDraftUrl(event.target.value);
              setError("");
            }}
          />
        </div>
      </div>

      <div className="space-y-2">
        <SettingsLabel help={t("jellyfin.apiKeyHint")}>{t("jellyfin.apiKey")}</SettingsLabel>
        <Input
          size="sm"
          type="password"
          autoComplete="off"
          aria-label={t("jellyfin.apiKey")}
          value={draftApiKey}
          placeholder={apiKeySet ? t("jellyfin.apiKeyConfiguredPlaceholder") : t("jellyfin.apiKeyPlaceholder")}
          disabled={busy || !draftEnabled}
          onChange={(event) => {
            setDraftApiKey(event.target.value);
            setError("");
          }}
        />
      </div>

      <div className="space-y-2">
        <SettingsLabel help={t("jellyfin.pathMapHint")}>{t("jellyfin.pathMap")}</SettingsLabel>
        <Input
          size="sm"
          aria-label={t("jellyfin.pathMap")}
          value={draftPathMap}
          placeholder={t("jellyfin.pathMapPlaceholder")}
          disabled={busy || !draftEnabled}
          onChange={(event) => {
            setDraftPathMap(event.target.value);
            setError("");
          }}
        />
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <SpinnerIcon className="h-4 w-4" />
        </div>
      )}
      {error && <p role="alert" className="break-words text-sm text-destructive-muted">{error}</p>}

      <div className="flex flex-wrap justify-end gap-2">
        <TestConnectionButton
          testing={testing}
          disabled={busy || !canTest}
          label={t("jellyfin.testConnection")}
          testingLabel={t("jellyfin.testingConnection")}
          onClick={() => void test(async () => requestPayload<ConnectionTestResult>("/api/config/jellyfin/test", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              enabled: true,
              url: draftUrl.trim(),
              apiKey: draftApiKey.trim(),
              pathMap: draftPathMap.trim()
            })
          }), "jellyfin.testConnectionFailed", "jellyfin.testConnectionOk")}
        />
        <SaveSettingsButton
          saving={saving}
          disabled={busy}
          label={t("jellyfin.saveSettings")}
          savingLabel={t("common.saving")}
          onClick={() => void save(async () => {
            const next = await requestPayload<JellyfinConfig>("/api/config/jellyfin", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                enabled: draftEnabled,
                url: draftUrl.trim(),
                apiKey: draftApiKey.trim(),
                pathMap: draftPathMap.trim()
              })
            });
            setDraftEnabled(Boolean(next.enabled));
            setDraftUrl(next.url || "");
            setDraftApiKey("");
            setApiKeySet(Boolean(next.apiKeySet));
            setDraftPathMap(next.pathMap || "");
            setJellyfinEnabledCache(Boolean(next.enabled));
          }, "jellyfin.settingsSaveFailed", "jellyfin.settingsSavedTitle")}
        />
      </div>
    </div>
  );
}
