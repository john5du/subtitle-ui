import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import Script from "next/script";

import { ToastViewport } from "@/components/ui/toast-viewport";
import { I18nProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";
import "./globals.css";

const appSans = localFont({
  src: "../../src/fonts/Geist-Regular.woff2",
  variable: "--font-sans",
  weight: "400",
  display: "swap"
});

const appMono = localFont({
  src: [
    { path: "../../src/fonts/GeistMono-Light.woff2", weight: "300", style: "normal" },
    { path: "../../src/fonts/GeistMono-Regular.woff2", weight: "400", style: "normal" }
  ],
  variable: "--font-mono",
  display: "swap"
});

export const metadata: Metadata = {
  title: "Subtitle UI",
  description: "Subtitle manager dashboard built with Next.js and shadcn/ui",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/icon.svg"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

const localeBootstrapScript = `
(() => {
  try {
    const localeKey = "subtitle-ui:locale";
    const storedLocale = window.localStorage.getItem(localeKey);
    const locale = storedLocale === "zh-CN" ? "zh-CN" : "en";
    const viewKey = "subtitle-ui:library-view";
    const storedView = window.localStorage.getItem(viewKey);
    const libraryView = storedView === "list" ? "list" : "card";
    window.__subtitleUiLocale = locale;
    window.__subtitleUiLibraryView = libraryView;
    const sidebarKey = "subtitle-ui:sidebar-collapsed";
    const storedSidebarCollapsed = window.localStorage.getItem(sidebarKey);
    window.__subtitleUiSidebarCollapsed = storedSidebarCollapsed === "true";
    document.documentElement.lang = locale;

    const themeKey = "subtitle-ui:theme";
    const storedTheme = window.localStorage.getItem(themeKey);
    const theme = (storedTheme === "light" || storedTheme === "dark" || storedTheme === "oled" || storedTheme === "system") ? storedTheme : "system";
    window.__subtitleUiTheme = theme;
    const systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isOled = theme === "oled";
    const isDark = isOled || theme === "dark" || (theme === "system" && systemDark);
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    if (isOled) {
      document.documentElement.classList.add("oled");
    } else {
      document.documentElement.classList.remove("oled");
    }
  } catch {
    window.__subtitleUiLocale = "en";
    window.__subtitleUiLibraryView = "card";
    window.__subtitleUiSidebarCollapsed = false;
    window.__subtitleUiTheme = "system";
    document.documentElement.lang = "en";
    document.documentElement.classList.add("dark");
    document.documentElement.classList.remove("oled");
  }
})();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script
          id="subtitle-ui-bootstrap"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: localeBootstrapScript }}
        />
      </head>
      <body className={`${appSans.variable} ${appMono.variable}`}>
        <ThemeProvider>
          <I18nProvider>
            <div className="flex h-dvh flex-col">
              <ToastViewport />
              <main className="min-h-0 flex-1 overflow-auto lg:overflow-hidden">{children}</main>
            </div>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
