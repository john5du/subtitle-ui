import type { Metadata } from "next";
import localFont from "next/font/local";

import { ToastViewport } from "@/components/ui/toast-viewport";
import { I18nProvider } from "@/lib/i18n";
import { APP_VERSION } from "@/lib/app-version";
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
    document.documentElement.lang = locale;
  } catch {
    window.__subtitleUiLocale = "en";
    window.__subtitleUiLibraryView = "card";
    document.documentElement.lang = "en";
  }
})();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const year = new Date().getFullYear();

  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: localeBootstrapScript }} />
      </head>
      <body className={`${appSans.variable} ${appMono.variable}`}>
        <I18nProvider>
          <div className="flex h-dvh flex-col">
            <ToastViewport />
            <main className="h-[calc(100dvh-3.5rem)] min-h-0 overflow-auto lg:overflow-hidden">{children}</main>
            <footer className="h-14 shrink-0 border-t border-[rgba(255,255,255,0.1)] bg-[#1f2228]">
              <div className="mx-auto flex h-full w-full max-w-[1620px] items-center justify-between px-4 text-sm text-[rgba(255,255,255,0.5)] md:px-6">
                <p>&copy; {year} Subtitle UI v{APP_VERSION}</p>
                <a
                  href="https://github.com/john5du/subtitle-ui"
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-sm uppercase tracking-[0.0875em] transition-colors hover:text-[rgba(255,255,255,0.5)]"
                >
                  GitHub
                </a>
              </div>
            </footer>
          </div>
        </I18nProvider>
      </body>
    </html>
  );
}
