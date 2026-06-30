"use client";

import { useState } from "react";
import { FileCode2, Languages } from "lucide-react";

import { useI18n, type MessageKey } from "@/lib/i18n";
import { emitToast } from "@/lib/toast";
import type { SubtitleConversionConfig, SubtitleSourceEncoding } from "@/lib/types";
import { requestPayload } from "@/lib/subtitle-manager/api-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { RowActionsMenu } from "./row-actions-menu";
import { SpinnerIcon } from "./pending-state";

const SOURCE_ENCODING_OPTIONS: SubtitleSourceEncoding[] = ["auto", "utf-8", "utf-16le", "utf-16be", "gb18030", "big5"];
const DIALOGUES_PLACEHOLDER = "{{DIALOGUES}}";

export function LocaleSelect({
  triggerClassName = "h-10 w-10",
  menuDirection = "up"
}: {
  triggerClassName?: string;
  menuDirection?: "up" | "down";
} = {}) {
  const { locale, setLocale, t } = useI18n();

  return (
    <RowActionsMenu
      label={`${t("locale.label")}: ${locale === "en" ? t("locale.english") : t("locale.zh-CN")}`}
      triggerIcon={<Languages className="h-5 w-5" />}
      triggerClassName={triggerClassName}
      menuDirection={menuDirection}
      items={[
        { label: t("locale.english"), onSelect: () => setLocale("en"), disabled: locale === "en" },
        { label: t("locale.zh-CN"), onSelect: () => setLocale("zh-CN"), disabled: locale === "zh-CN" }
      ]}
    />
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

export function SubtitleConversionSettingsButton({ triggerClassName = "h-10 w-10" }: { triggerClassName?: string } = {}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<SubtitleConversionConfig | null>(null);
  const [draftTemplate, setDraftTemplate] = useState("");
  const [draftEncoding, setDraftEncoding] = useState<SubtitleSourceEncoding>("auto");
  const [error, setError] = useState("");

  async function loadConfig() {
    setLoading(true);
    setError("");
    try {
      const next = await requestPayload<SubtitleConversionConfig>("/api/config/subtitle-conversion");
      setConfig(next);
      setDraftTemplate(next.assTemplate || next.defaultAssTemplate || "");
      setDraftEncoding(next.sourceEncodingDefault || "auto");
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : String(loadError);
      setError(message);
      emitToast({
        level: "error",
        title: t("conversion.settingsLoadFailed"),
        message
      });
    } finally {
      setLoading(false);
    }
  }

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
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={triggerClassName}
        aria-label={t("conversion.settings")}
        title={t("conversion.settings")}
        onClick={() => {
          setOpen(true);
          void loadConfig();
        }}
      >
        <FileCode2 className="h-5 w-5" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[88vh] flex-col overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("conversion.settings")}</DialogTitle>
            <DialogDescription>{t("conversion.settingsDescription")}</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-auto">
            <div className="flex flex-col gap-3 sm:flex-row sm:gap-0">
              <div className="min-w-0 flex-1 space-y-2 sm:pr-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("conversion.assTemplate")}</p>
                <textarea
                  value={draftTemplate}
                  spellCheck={false}
                  className="min-h-[360px] w-full resize-y border border-input bg-surface-subtle p-3 font-mono text-xs leading-5 text-foreground outline-none focus:ring-2 focus:ring-[rgb(59,130,246)/0.5]"
                  onChange={(event) => {
                    setDraftTemplate(event.target.value);
                    setError("");
                  }}
                />
              </div>

              <div className="space-y-4 border-t border-border/60 pt-3 sm:w-[220px] sm:shrink-0 sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("conversion.defaultSourceEncoding")}</p>
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
                  className="w-full"
                  disabled={loading || saving || !config?.defaultAssTemplate}
                  onClick={() => {
                    setDraftTemplate(config?.defaultAssTemplate || "");
                    setError("");
                  }}
                >
                  {t("conversion.restoreDefaultTemplate")}
                </Button>
              </div>
            </div>

            {loading && (
              <div className="bg-surface-subtle p-3">
                <SpinnerIcon className="h-4 w-4" />
              </div>
            )}
            {error && <p className="break-words text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              {t("common.close")}
            </Button>
            <Button type="button" onClick={() => void saveConfig()} disabled={loading || saving}>
              {saving ? <SpinnerIcon className="h-4 w-4" /> : null}
              {saving ? t("conversion.saving") : t("conversion.saveSettings")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
