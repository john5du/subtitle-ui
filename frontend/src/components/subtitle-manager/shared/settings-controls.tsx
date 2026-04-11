"use client";

import { Languages } from "lucide-react";

import { useI18n } from "@/lib/i18n";

import { RowActionsMenu } from "./row-actions-menu";

export function LocaleSelect() {
  const { locale, setLocale, t } = useI18n();

  return (
    <RowActionsMenu
      label={`${t("locale.label")}: ${locale === "en" ? t("locale.english") : t("locale.zh-CN")}`}
      triggerIcon={<Languages className="h-5 w-5" />}
      triggerClassName="h-10 w-10"
      menuDirection="up"
      items={[
        { label: t("locale.english"), onSelect: () => setLocale("en"), disabled: locale === "en" },
        { label: t("locale.zh-CN"), onSelect: () => setLocale("zh-CN"), disabled: locale === "zh-CN" }
      ]}
    />
  );
}
