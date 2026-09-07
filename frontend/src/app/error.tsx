"use client";

import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-lg font-semibold">{t("error.appTitle")}</h1>
      {error.message ? <p className="max-w-md text-sm text-muted-foreground">{error.message}</p> : null}
      <Button type="button" onClick={reset}>
        {t("error.appRetry")}
      </Button>
    </div>
  );
}
