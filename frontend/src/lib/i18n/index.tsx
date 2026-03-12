"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

import { enMessages, type MessageDictionary, type MessageKey } from "./messages/en";
import { zhCNMessages } from "./messages/zh-CN";

export type Locale = "en" | "zh-CN";
export type TranslationValues = Record<string, string | number | boolean | null | undefined>;
export type TranslateFn = (key: MessageKey, values?: TranslationValues) => string;

const DEFAULT_LOCALE: Locale = "en";
const STORAGE_KEY = "subtitle-ui:locale";

const dictionaries: Record<Locale, MessageDictionary> = {
  en: enMessages,
  "zh-CN": zhCNMessages
};

declare global {
  interface Window {
    __subtitleUiLocale?: string;
  }
}

function interpolate(template: string, values?: TranslationValues) {
  if (!values) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_, token: string) => {
    const value = values[token];
    return value === undefined || value === null ? "" : String(value);
  });
}

function translate(locale: Locale, key: MessageKey, values?: TranslationValues) {
  const template = dictionaries[locale][key] ?? dictionaries.en[key] ?? key;
  return interpolate(template, values);
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TranslateFn;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function isLocale(value: string | null | undefined): value is Locale {
  return value === "en" || value === "zh-CN";
}

export function I18nProvider({
  children,
  initialLocale = DEFAULT_LOCALE
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocale] = useState<Locale>(() => {
    if (typeof window === "undefined") {
      return initialLocale;
    }

    const bootstrapLocale = window.__subtitleUiLocale;
    if (isLocale(bootstrapLocale)) {
      return bootstrapLocale;
    }

    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) {
      return stored;
    }

    return initialLocale;
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, locale);
      window.__subtitleUiLocale = locale;
    }
    document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback<TranslateFn>((key, values) => {
    return translate(locale, key, values);
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale,
    t
  }), [locale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return context;
}

export { enMessages };
export type { MessageKey };
