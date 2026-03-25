import type { MessageKey, TranslationValues, TranslateFn } from "@/lib/i18n";

export type LocalizedText =
  | {
      key: MessageKey;
      values?: TranslationValues;
    }
  | {
      raw: string;
    }
  | null;

export function resolveLocalizedText(value: LocalizedText, t: TranslateFn) {
  if (!value) {
    return "";
  }
  if ("raw" in value) {
    return value.raw;
  }
  return t(value.key, value.values);
}

export function formatTimeWithLocale(locale: string, value: string | undefined | null) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }

  return parsed.toLocaleString(locale);
}
