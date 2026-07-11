"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, RotateCcw, Save } from "lucide-react";

import { useI18n, type Locale, type MessageKey } from "@/lib/i18n";
import { emitToast } from "@/lib/toast";
import type { SonarrConfig, SubHDConfig, SubtitleConversionConfig, SubtitleSourceEncoding } from "@/lib/types";
import { requestPayload } from "@/lib/subtitle-manager/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import { SpinnerIcon } from "./pending-state";

const SOURCE_ENCODING_OPTIONS: SubtitleSourceEncoding[] = ["auto", "utf-8", "utf-16le", "utf-16be", "gb18030", "big5"];
const DIALOGUES_PLACEHOLDER = "{{DIALOGUES}}";

function SaveSettingsButton({
  saving,
  disabled,
  label,
  savingLabel,
  onClick
}: {
  saving: boolean;
  disabled: boolean;
  label: string;
  savingLabel: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      className="relative h-9 min-w-0 px-3"
      disabled={disabled}
      onClick={onClick}
      aria-label={saving ? savingLabel : label}
      title={saving ? savingLabel : label}
    >
      <span className="invisible select-none" aria-hidden>
        保存
      </span>
      <span className="absolute inset-0 flex items-center justify-center">
        {saving ? <SpinnerIcon className="h-4 w-4" /> : <Save className="h-4 w-4" />}
      </span>
    </Button>
  );
}

export function LocaleSelect({ className = "h-9 w-[140px]" }: { className?: string } = {}) {
  const { locale, setLocale, t } = useI18n();

  return (
    <Select value={locale} onValueChange={(value) => setLocale(value as Locale)}>
      <SelectTrigger className={className} aria-label={t("locale.label")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="en">{t("locale.english")}</SelectItem>
        <SelectItem value="zh-CN">{t("locale.zh-CN")}</SelectItem>
      </SelectContent>
    </Select>
  );
}

function validateASSTemplateDraft(template: string): MessageKey | "" {
  const normalized = template.trim();
  if (!normalized.includes(DIALOGUES_PLACEHOLDER)) {
    return "conversion.templateMissingPlaceholder";
  }
  if (!/\[Events\]/i.test(normalized)) {
    return "conversion.templateMissingEvents";
  }
  if (!/Format:\s*Layer\s*,\s*Start\s*,\s*End\s*,\s*Style\s*,\s*Name\s*,\s*MarginL\s*,\s*MarginR\s*,\s*MarginV\s*,\s*Effect\s*,\s*Text/i.test(normalized)) {
    return "conversion.templateInvalidFormat";
  }
  return "";
}

export function SubtitleConversionSettingsPanel() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<SubtitleConversionConfig | null>(null);
  const [draftTemplate, setDraftTemplate] = useState("");
  const [draftEncoding, setDraftEncoding] = useState<SubtitleSourceEncoding>("auto");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      setLoading(true);
      setError("");
      try {
        const next = await requestPayload<SubtitleConversionConfig>("/api/config/subtitle-conversion");
        if (cancelled) {
          return;
        }
        setConfig(next);
        setDraftTemplate(next.assTemplate || next.defaultAssTemplate || "");
        setDraftEncoding(next.sourceEncodingDefault || "auto");
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        const message = loadError instanceof Error ? loadError.message : String(loadError);
        setError(message);
        emitToast({
          level: "error",
          message: t("conversion.settingsLoadFailed"),
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
    const validationKey = validateASSTemplateDraft(draftTemplate);
    if (validationKey) {
      setError(t(validationKey));
      return;
    }

    setSaving(true);
    setError("");
    try {
      const next = await requestPayload<SubtitleConversionConfig>("/api/config/subtitle-conversion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assTemplate: draftTemplate,
          sourceEncodingDefault: draftEncoding
        })
      });
      setConfig(next);
      setDraftTemplate(next.assTemplate);
      setDraftEncoding(next.sourceEncodingDefault);
      emitToast({
        level: "success",
        message: t("conversion.settingsSavedTitle")
      });
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError);
      setError(message);
      emitToast({
        level: "error",
        message: t("conversion.settingsSaveFailed"),
        detail: message
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="surface-panel space-y-4 p-3 sm:p-4">

      <div className="flex min-h-9 items-center justify-between gap-3">
        <p className="min-w-0 shrink text-sm font-semibold text-foreground">{t("conversion.defaultSourceEncoding")}</p>
        <div className="shrink-0">
          <Select value={draftEncoding} onValueChange={(value) => setDraftEncoding(value as SubtitleSourceEncoding)} disabled={loading || saving}>
            <SelectTrigger className="h-9 w-[140px]" aria-label={t("conversion.defaultSourceEncoding")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_ENCODING_OPTIONS.map((encoding) => (
                <SelectItem key={encoding} value={encoding}>
                  {encoding.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-section text-foreground-muted">{t("conversion.assTemplate")}</p>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            disabled={loading || saving || !config?.defaultAssTemplate}
            onClick={() => {
              setDraftTemplate(config?.defaultAssTemplate || "");
              setError("");
            }}
            aria-label={t("conversion.restoreDefaultTemplate")}
            title={t("conversion.restoreDefaultTemplate")}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
        <textarea
          value={draftTemplate}
          spellCheck={false}
          disabled={loading || saving}
          className="focus-ring min-h-[240px] w-full resize-y border border-input bg-surface-subtle p-3 font-mono text-xs leading-5 text-foreground disabled:opacity-60"
          onChange={(event) => {
            setDraftTemplate(event.target.value);
            setError("");
          }}
        />
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
          label={t("conversion.saveSettings")}
          savingLabel={t("common.saving")}
          onClick={() => void saveConfig()}
        />
      </div>
    </div>
  );
}

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
              value={draftBaseUrl}
              placeholder={t("subhd.baseUrlPlaceholder")}
              disabled={loading || saving || !draftEnabled}
              className="h-9 min-w-0 flex-1"
              onChange={(event) => {
                setDraftBaseUrl(event.target.value);
                setError("");
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
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
          value={draftProxy}
          placeholder={t("subhd.proxyPlaceholder")}
          disabled={loading || saving || !draftEnabled}
          className="h-9"
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

export function SonarrSettingsPanel() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [draftUrl, setDraftUrl] = useState("");
  const [draftApiKey, setDraftApiKey] = useState("");
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
        setDraftApiKey(next.apiKey || "");
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
      setDraftApiKey(next.apiKey || "");
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

  return (
    <div className="surface-panel space-y-4 p-3 sm:p-4">

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-section text-foreground-muted">{t("sonarr.enabled")}</p>
          <Switch
            checked={draftEnabled}
            onCheckedChange={setDraftEnabled}
            disabled={loading || saving}
            aria-label={t("sonarr.enabled")}
            title={draftEnabled ? t("sonarr.enabledOn") : t("sonarr.enabledOff")}
          />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-section text-foreground-muted">{t("sonarr.url")}</p>
          <Input
            value={draftUrl}
            placeholder={t("sonarr.urlPlaceholder")}
            disabled={loading || saving || !draftEnabled}
            className="h-9"
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
            type={apiKeyVisible ? "text" : "password"}
            autoComplete="off"
            value={draftApiKey}
            placeholder={t("sonarr.apiKeyPlaceholder")}
            disabled={loading || saving || !draftEnabled}
            className="h-9 pr-10"
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
            disabled={loading || saving || !draftEnabled}
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

      <div className="flex justify-end">
        <SaveSettingsButton
          saving={saving}
          disabled={loading || saving}
          label={t("sonarr.saveSettings")}
          savingLabel={t("common.saving")}
          onClick={() => void saveConfig()}
        />
      </div>
    </div>
  );
}
