"use client";

import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";

import { useI18n, type MessageKey } from "@/lib/i18n";
import { emitToast } from "@/lib/toast";
import type { SubtitleConversionConfig, SubtitleSourceEncoding } from "@/lib/types";
import { requestPayload } from "@/lib/subtitle-manager/api-client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { SpinnerIcon } from "../pending-state";
import { SaveSettingsButton, SettingsLabel } from "./settings-shared";

const SOURCE_ENCODING_OPTIONS: SubtitleSourceEncoding[] = ["auto", "utf-8", "utf-16le", "utf-16be", "gb18030", "big5"];
const DIALOGUES_PLACEHOLDER = "{{DIALOGUES}}";

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
        <SettingsLabel className="min-w-0 shrink">{t("conversion.defaultSourceEncoding")}</SettingsLabel>
        <div className="shrink-0">
          <Select value={draftEncoding} onValueChange={(value) => setDraftEncoding(value as SubtitleSourceEncoding)} disabled={loading || saving}>
            <SelectTrigger size="sm" className="w-[140px]" aria-label={t("conversion.defaultSourceEncoding")}>
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
          <SettingsLabel>{t("conversion.assTemplate")}</SettingsLabel>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
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

