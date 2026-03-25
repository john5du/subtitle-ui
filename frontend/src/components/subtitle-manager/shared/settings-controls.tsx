"use client";

import { useEffect, useState } from "react";
import { Languages, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { useI18n } from "@/lib/i18n";

import { RowActionsMenu } from "./row-actions-menu";

export function ThemeModeSelect({ disabled = false }: { disabled?: boolean }) {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const value = mounted ? theme || "system" : "system";
  const icon =
    value === "dark" ? <Moon className="h-5 w-5" /> : value === "light" ? <Sun className="h-5 w-5" /> : <Monitor className="h-5 w-5" />;

  return (
    <RowActionsMenu
      label={t("sidebar.changeTheme")}
      disabled={disabled}
      triggerIcon={icon}
      triggerClassName="h-10 w-10"
      menuDirection="up"
      items={[
        { label: t("theme.system"), onSelect: () => setTheme("system"), disabled: value === "system" },
        { label: t("theme.light"), onSelect: () => setTheme("light"), disabled: value === "light" },
        { label: t("theme.dark"), onSelect: () => setTheme("dark"), disabled: value === "dark" }
      ]}
    />
  );
}

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
