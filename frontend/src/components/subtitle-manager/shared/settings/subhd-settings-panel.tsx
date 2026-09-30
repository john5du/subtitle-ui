"use client";

import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import type { SubHDConfig } from "@/lib/types";
import { requestPayload } from "@/lib/subtitle-manager/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import { SpinnerIcon } from "../pending-state";
import { SaveSettingsButton, SettingsLabel } from "./settings-shared";
import { useSettingsForm } from "./use-settings-form";

export function SubHDSettingsPanel() {
  const { t } = useI18n();
  const { load, save, loading, saving, error, setError } = useSettingsForm();
  const [config, setConfig] = useState<SubHDConfig | null>(null);
  const [draftEnabled, setDraftEnabled] = useState(true);
  const [draftBaseUrl, setDraftBaseUrl] = useState("");
  const [draftProxy, setDraftProxy] = useState("");

  function applyConfig(next: SubHDConfig) {
    setConfig(next);
    setDraftEnabled(Boolean(next.enabled));
    setDraftBaseUrl(next.baseUrl || next.defaultBaseUrl || "");
    setDraftProxy(next.proxy || "");
  }

  useEffect(() => {
    let cancelled = false;
    void load(async () => {
      const next = await requestPayload<SubHDConfig>("/api/config/subhd");
      if (cancelled) {
        return;
      }
      applyConfig(next);
    }, "subhd.settingsLoadFailed", () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  const parse = config?.parse;
  const parseWarningCount = (parse?.layoutWarnings || 0) + (parse?.cardWarnings || 0);

  return (
    <div className="surface-panel space-y-4 p-3 sm:p-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <SettingsLabel>{t("subhd.enabled")}</SettingsLabel>
          <Switch
            checked={draftEnabled}
            onCheckedChange={setDraftEnabled}
            disabled={loading || saving}
            aria-label={t("subhd.enabled")}
            title={draftEnabled ? t("subhd.enabledOn") : t("subhd.enabledOff")}
          />
        </div>

        <div className="space-y-2">
          <SettingsLabel>{t("subhd.baseUrl")}</SettingsLabel>
          <div className="flex items-center gap-2">
            <Input
              size="sm"
              aria-label={t("subhd.baseUrl")}
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
        <SettingsLabel help={t("subhd.proxyHint")}>{t("subhd.proxy")}</SettingsLabel>
        <Input
          size="sm"
          aria-label={t("subhd.proxy")}
          value={draftProxy}
          placeholder={t("subhd.proxyPlaceholder")}
          disabled={loading || saving || !draftEnabled}
          onChange={(event) => {
            setDraftProxy(event.target.value);
            setError("");
          }}
        />
      </div>

      {parse && (
        <div className="space-y-1 text-xs text-muted-foreground">
          <SettingsLabel help={t("subhd.parseHint")}>{t("subhd.parseStats")}</SettingsLabel>
          <p>
            {t("subhd.parseCounts", {
              searches: parse.searches,
              ok: parse.parseOk,
              empty: parse.emptyResults
            })}
          </p>
          {parseWarningCount > 0 ? (
            <p role="status" className="text-destructive-muted">
              {t("subhd.parseWarnings", {
                layout: parse.layoutWarnings,
                cards: parse.cardWarnings,
                last: parse.lastWarning || "—"
              })}
            </p>
          ) : (
            <p>{t("subhd.parseHealthy")}</p>
          )}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <SpinnerIcon className="h-4 w-4" />
        </div>
      )}
      {error && <p role="alert" className="break-words text-sm text-destructive-muted">{error}</p>}

      <div className="flex justify-end">
        <SaveSettingsButton
          saving={saving}
          disabled={loading || saving}
          label={t("subhd.saveSettings")}
          savingLabel={t("common.saving")}
          onClick={() => void save(async () => {
            const next = await requestPayload<SubHDConfig>("/api/config/subhd", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                enabled: draftEnabled,
                baseUrl: draftBaseUrl.trim(),
                proxy: draftProxy.trim()
              })
            });
            applyConfig(next);
          }, "subhd.settingsSaveFailed", "subhd.settingsSavedTitle")}
        />
      </div>
    </div>
  );
}
