"use client";

import Image from "next/image";
import { FormEvent, useState } from "react";

import { APP_VERSION } from "@/lib/app-version";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SpinnerIcon } from "@/components/subtitle-manager/shared/pending-state";

export function LoginPage({
  onSubmitToken,
  initialError = ""
}: {
  onSubmitToken: (token: string) => Promise<void>;
  initialError?: string;
}) {
  const { t } = useI18n();
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(initialError);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const value = token.trim();
    if (!value) {
      setError(t("auth.tokenRequired"));
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await onSubmitToken(value);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : t("auth.invalidToken");
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-full flex-col items-center justify-center p-4">
      <form className="flex w-full max-w-xs flex-col items-center gap-5" onSubmit={handleSubmit}>
        <Image
          src="/icon.svg"
          alt="Subtitle UI"
          width={112}
          height={112}
          priority
          className="h-[112px] w-[112px]"
        />
        <h1 className="sr-only">{t("auth.loginTitle")}</h1>
        <p className="sr-only">{t("auth.loginDescription")}</p>
        <Input
          id="admin-token"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={token}
          disabled={submitting}
          aria-label={t("auth.tokenLabel")}
          placeholder={t("auth.tokenPlaceholder")}
          className="w-full"
          onChange={(event) => setToken(event.target.value)}
        />
        {error ? <p className="w-full text-center text-sm text-destructive">{error}</p> : null}
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? (
            <span className="inline-flex items-center gap-2">
              <SpinnerIcon className="h-4 w-4" />
              {t("auth.submitting")}
            </span>
          ) : (
            t("auth.submit")
          )}
        </Button>
      </form>
      <p className="absolute bottom-4 text-xs text-muted-foreground">{`v${APP_VERSION}`}</p>
    </div>
  );
}
