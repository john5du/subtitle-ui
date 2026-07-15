"use client";

import { useI18n } from "@/lib/i18n";
import { useTheme, type ThemePreference } from "@/lib/theme";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function ThemeToggle({ className = "h-9 w-[160px]" }: { className?: string } = {}) {
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();

  return (
    <Select value={theme} onValueChange={(value) => setTheme(value as ThemePreference)}>
      <SelectTrigger className={className} aria-label={t("sidebar.changeTheme")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="system">{t("theme.system")}</SelectItem>
        <SelectItem value="light">{t("theme.light")}</SelectItem>
        <SelectItem value="dark">{t("theme.dark")}</SelectItem>
        <SelectItem value="oled">{t("theme.oled")}</SelectItem>
      </SelectContent>
    </Select>
  );
}
