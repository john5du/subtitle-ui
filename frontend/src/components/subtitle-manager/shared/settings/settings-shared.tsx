"use client";

import type { ReactNode } from "react";
import { PlugZap, Save } from "lucide-react";

import { useI18n, type Locale } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { DialogHelpTip } from "@/components/ui/dialog-help-tip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { SpinnerIcon } from "../pending-state";

/** Settings field / section label with optional click-to-show help bubble. */
export function SettingsLabel({
  children,
  help,
  className
}: {
  children: ReactNode;
  help?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <p className="min-w-0 text-xs font-semibold uppercase tracking-section text-foreground-muted">{children}</p>
      {help ? <DialogHelpTip text={help} /> : null}
    </div>
  );
}

export function SaveSettingsButton({
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

export function TestConnectionButton({
  testing,
  disabled,
  label,
  testingLabel,
  onClick
}: {
  testing: boolean;
  disabled: boolean;
  label: string;
  testingLabel: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className="relative h-9 min-w-0 px-3"
      disabled={disabled}
      onClick={onClick}
      aria-label={testing ? testingLabel : label}
      title={testing ? testingLabel : label}
    >
      <span className="invisible select-none" aria-hidden>
        检查
      </span>
      <span className="absolute inset-0 flex items-center justify-center">
        {testing ? <SpinnerIcon className="h-4 w-4" /> : <PlugZap className="h-4 w-4" />}
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

