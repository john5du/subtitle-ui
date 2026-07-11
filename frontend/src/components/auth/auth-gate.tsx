"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

import { LoginPage } from "@/components/auth/login-page";
import { clearAdminToken, getAdminToken, setAdminToken } from "@/lib/admin-token";
import { useI18n } from "@/lib/i18n";
import { probeAPIAuth, validateAdminToken } from "@/lib/subtitle-manager/api-client";
import { SpinnerIcon } from "@/components/subtitle-manager/shared/pending-state";

type GateState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "login"; error?: string }
  | { status: "ready"; authRequired: boolean };

export function AuthGate({ children }: { children: (props: { authRequired: boolean; onSignOut: () => void }) => ReactNode }) {
  const { t } = useI18n();
  const [state, setState] = useState<GateState>({ status: "loading" });

  const bootstrap = useCallback(async () => {
    setState({ status: "loading" });
    const mode = await probeAPIAuth();
    if (mode === "error") {
      setState({ status: "error", message: t("auth.probeFailed") });
      return;
    }
    if (mode === "open") {
      setState({ status: "ready", authRequired: false });
      return;
    }

    const stored = getAdminToken();
    if (!stored) {
      setState({ status: "login" });
      return;
    }

    const valid = await validateAdminToken(stored);
    if (!valid) {
      clearAdminToken();
      setState({ status: "login", error: t("auth.invalidToken") });
      return;
    }
    setState({ status: "ready", authRequired: true });
  }, [t]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const handleSubmitToken = useCallback(
    async (token: string) => {
      const valid = await validateAdminToken(token);
      if (!valid) {
        clearAdminToken();
        throw new Error(t("auth.invalidToken"));
      }
      setAdminToken(token);
      setState({ status: "ready", authRequired: true });
    },
    [t]
  );

  const handleSignOut = useCallback(() => {
    clearAdminToken();
    setState({ status: "login" });
  }, []);

  if (state.status === "loading") {
    return (
      <div className="flex min-h-full items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
        <SpinnerIcon className="h-4 w-4" />
        {t("auth.checking")}
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-destructive">{state.message}</p>
        <button type="button" className="text-sm font-semibold text-foreground underline" onClick={() => void bootstrap()}>
          {t("auth.retry")}
        </button>
      </div>
    );
  }

  if (state.status === "login") {
    return <LoginPage onSubmitToken={handleSubmitToken} initialError={state.error ?? ""} />;
  }

  return <>{children({ authRequired: state.authRequired, onSignOut: handleSignOut })}</>;
}
