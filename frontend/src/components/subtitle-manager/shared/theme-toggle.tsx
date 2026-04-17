"use client";

import { Monitor, Moon, Sun } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { useTheme, type ThemePreference } from "@/lib/theme";

import { RowActionsMenu } from "./row-actions-menu";

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { t } = useI18n();

  const triggerIcon =
    theme === "system" ? (
      <Monitor className="h-5 w-5" />
    ) : resolvedTheme === "dark" ? (
      <Moon className="h-5 w-5" />
    ) : (
      <Sun className="h-5 w-5" />
    );

  const currentLabel =
    theme === "system"
      ? t("theme.system")
      : theme === "dark"
        ? t("theme.dark")
        : t("theme.light");

  const select = (next: ThemePreference) => setTheme(next);

  return (
    <RowActionsMenu
      label={`${t("sidebar.changeTheme")}: ${currentLabel}`}
      triggerIcon={triggerIcon}
      triggerClassName="h-10 w-10"
      menuDirection="up"
      items={[
        { label: t("theme.system"), onSelect: () => select("system"), disabled: theme === "system" },
        { label: t("theme.light"), onSelect: () => select("light"), disabled: theme === "light" },
        { label: t("theme.dark"), onSelect: () => select("dark"), disabled: theme === "dark" }
      ]}
    />
  );
}
