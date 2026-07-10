"use client";

import { useEffect, useState } from "react";

import { useI18n, type Locale, type MessageKey } from "@/lib/i18n";
import { emitToast } from "@/lib/toast";
import type { SubHDConfig, SubtitleConversionConfig, SubtitleSourceEncoding } from "@/lib/types";
import { requestPayload } from "@/lib/subtitle-manager/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { SpinnerIcon } from "./pending-state";

const SOURCE_ENCODING_OPTIONS: SubtitleSourceEncoding[] = ["auto", "utf-8", "utf-16le", "utf-16be", "gb18030", "big5"];
const DIALOGUES_PLACEHOLDER = "{{DIALOGUES}}";

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
          title: t("conversion.settingsLoadFailed"),
          message
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
        title: t("conversion.settingsSavedTitle"),
        message: t("conversion.settingsSavedMessage")
      });
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError);
      setError(message);
      emitToast({
        level: "error",
        title: t("conversion.settingsSaveFailed"),
        message
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="surface-panel space-y-4 p-3 sm:p-4">
      <p className="text-sm text-muted-foreground">{t("conversion.settingsDescription")}</p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-section text-foreground-muted">{t("conversion.defaultSourceEncoding")}</p>
          <Select value={draftEncoding} onValueChange={(value) => setDraftEncoding(value as SubtitleSourceEncoding)} disabled={loading || saving}>
            <SelectTrigger className="h-9">
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
        <Button
          type="button"
          variant="outline"
          className="h-9 shrink-0"
          disabled={loading || saving || !config?.defaultAssTemplate}
          onClick={() => {
            setDraftTemplate(config?.defaultAssTemplate || "");
            setError("");
          }}
        >
          {t("conversion.restoreDefaultTemplate")}
        </Button>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-section text-foreground-muted">{t("conversion.assTemplate")}</p>
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
        <Button type="button" onClick={() => void saveConfig()} disabled={loading || saving}>
          {saving ? <SpinnerIcon className="h-4 w-4" /> : null}
          {saving ? t("conversion.saving") : t("conversion.saveSettings")}
        </Button>
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
          title: t("subhd.settingsLoadFailed"),
          message
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
        title: t("subhd.settingsSavedTitle"),
        message: t("subhd.settingsSavedMessage")
      });
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError);
      setError(message);
      emitToast({
        level: "error",
        title: t("subhd.settingsSaveFailed"),
        message
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="surface-panel space-y-4 p-3 sm:p-4">
      <p className="text-sm text-muted-foreground">{t("subhd.settingsDescription")}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-section text-foreground-muted">{t("subhd.enabled")}</p>
          <Select
            value={draftEnabled ? "on" : "off"}
            onValueChange={(value) => setDraftEnabled(value === "on")}
            disabled={loading || saving}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="on">{t("subhd.enabledOn")}</SelectItem>
              <SelectItem value="off">{t("subhd.enabledOff")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-section text-foreground-muted">{t("subhd.baseUrl")}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={draftBaseUrl}
              placeholder={t("subhd.baseUrlPlaceholder")}
              disabled={loading || saving}
              className="min-w-0 flex-1"
              onChange={(event) => {
                setDraftBaseUrl(event.target.value);
                setError("");
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 shrink-0"
              disabled={loading || saving || !config?.defaultBaseUrl}
              onClick={() => {
                setDraftBaseUrl(config?.defaultBaseUrl || "");
                setError("");
              }}
            >
              {t("subhd.restoreDefaultBaseUrl")}
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-section text-foreground-muted">{t("subhd.proxy")}</p>
        <Input
          value={draftProxy}
          placeholder={t("subhd.proxyPlaceholder")}
          disabled={loading || saving}
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
        <Button type="button" onClick={() => void saveConfig()} disabled={loading || saving}>
          {saving ? <SpinnerIcon className="h-4 w-4" /> : null}
          {saving ? t("subhd.saving") : t("subhd.saveSettings")}
        </Button>
      </div>
    </div>
  );
}
