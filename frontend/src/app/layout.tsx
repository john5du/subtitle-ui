import type { Metadata } from "next";

import { ThemeProvider } from "@/components/theme-provider";
import { ToastViewport } from "@/components/ui/toast-viewport";
import { I18nProvider } from "@/lib/i18n";
import { APP_VERSION } from "@/lib/app-version";
import "./globals.css";

export const metadata: Metadata = {
  title: "Subtitle UI",
  description: "Subtitle manager dashboard built with Next.js and shadcn/ui",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/icon.svg"
  }
};

const localeBootstrapScript = `
(() => {
  try {
    const key = "subtitle-ui:locale";
    const stored = window.localStorage.getItem(key);
    const locale = stored === "zh-CN" ? "zh-CN" : "en";
    window.__subtitleUiLocale = locale;
    document.documentElement.lang = locale;
  } catch {
    window.__subtitleUiLocale = "en";
    document.documentElement.lang = "en";
  }
})();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const year = new Date().getFullYear();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: localeBootstrapScript }} />
      </head>
      <body>
        <I18nProvider>
          <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem>
            <div className="flex h-dvh flex-col">
              <ToastViewport />
              <main className="h-[calc(100dvh-3.5rem)] min-h-0 overflow-auto lg:overflow-hidden">{children}</main>
              <footer className="h-14 shrink-0 border-t border-border/70 bg-background/85 backdrop-blur">
                <div className="mx-auto flex h-full w-full max-w-[1560px] items-center justify-between px-4 text-sm text-muted-foreground md:px-6">
                  <p>(c) {year} Subtitle UI v{APP_VERSION}</p>
                  <a
                    href="https://github.com/john5du/subtitle-ui"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium transition-colors hover:text-foreground"
                  >
                    GitHub
                  </a>
                </div>
              </footer>
            </div>
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
