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
    <div className="flex min-h-full flex-col items-center px-4 py-8">
      <form className="surface-panel my-auto flex w-full max-w-[420px] flex-col items-stretch gap-5 p-6 sm:p-8" onSubmit={handleSubmit}>
        <Image
          src="/icon.svg"
          alt="Subtitle UI"
          width={56}
          height={56}
          priority
          className="h-14 w-14"
        />
        <div className="space-y-2">
          <h1 className="text-[22px] font-semibold leading-[30px]">{t("auth.loginTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("auth.loginDescription")}</p>
        </div>
        <label htmlFor="admin-token" className="-mb-3 text-sm font-medium">{t("auth.tokenLabel")}</label>
        <Input
          id="admin-token"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={token}
          disabled={submitting}
          aria-label={t("auth.tokenLabel")}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "login-error" : undefined}
          placeholder={t("auth.tokenPlaceholder")}
          className="w-full"
          onChange={(event) => setToken(event.target.value)}
        />
        {error ? <p id="login-error" role="alert" className="w-full text-sm text-destructive-muted">{error}</p> : null}
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
      <p className="mt-6 text-xs text-muted-foreground">{`v${APP_VERSION}`}</p>
    </div>
  );
}
