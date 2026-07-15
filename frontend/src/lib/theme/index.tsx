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

export type ThemePreference = "system" | "light" | "dark" | "oled";
export type ResolvedTheme = "light" | "dark" | "oled";

const STORAGE_KEY = "subtitle-ui:theme";

declare global {
  interface Window {
    __subtitleUiTheme?: string;
  }
}

interface ThemeContextValue {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isThemePreference(value: string | null | undefined): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark" || value === "oled";
}

function readStoredTheme(): ThemePreference {
  if (typeof window === "undefined") {
    return "system";
  }
  const bootstrap = window.__subtitleUiTheme;
  if (isThemePreference(bootstrap)) {
    return bootstrap;
  }
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (isThemePreference(stored)) {
    return stored;
  }
  return "system";
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) {
    return "dark";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(theme: ThemePreference): ResolvedTheme {
  return theme === "system" ? getSystemTheme() : theme;
}

function applyResolvedTheme(resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark" || resolved === "oled");
  root.classList.toggle("oled", resolved === "oled");
}

function persistTheme(theme: ThemePreference) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, theme);
  window.__subtitleUiTheme = theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("dark");

  useEffect(() => {
    const storedTheme = readStoredTheme();
    const resolved = resolveTheme(storedTheme);
    setThemeState(storedTheme);
    setResolvedTheme(resolved);
    applyResolvedTheme(resolved);
  }, []);

  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined" || !window.matchMedia) return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (event: MediaQueryListEvent) => {
      const resolved: ResolvedTheme = event.matches ? "dark" : "light";
      setResolvedTheme(resolved);
      applyResolvedTheme(resolved);
    };
    mediaQuery.addEventListener("change", listener);
    return () => mediaQuery.removeEventListener("change", listener);
  }, [theme]);

  const setTheme = useCallback((next: ThemePreference) => {
    persistTheme(next);
    const resolved = resolveTheme(next);
    setThemeState(next);
    setResolvedTheme(resolved);
    applyResolvedTheme(resolved);
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
