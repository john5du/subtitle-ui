import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import { ToastViewport } from "@/components/ui/toast-viewport";
import { APP_VERSION } from "@/lib/app-version";
import "./globals.css";

export const metadata: Metadata = {
  title: "Subtitle Manager",
  description: "Subtitle manager dashboard built with Next.js and shadcn/ui"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const year = new Date().getFullYear();

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem>
          <div className="flex h-dvh flex-col">
            <ToastViewport />
            <main className="h-[calc(100dvh-3.5rem)] min-h-0 overflow-auto lg:overflow-hidden">{children}</main>
            <footer className="h-14 shrink-0 border-t border-border/70 bg-background/85 backdrop-blur">
              <div className="mx-auto flex h-full w-full max-w-[1560px] items-center justify-between px-4 text-sm text-muted-foreground md:px-6">
                <p>© {year} Subtitle UI v{APP_VERSION}</p>
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
      </body>
    </html>
  );
}
