"use client";

import { AuthGate } from "@/components/auth/auth-gate";

import { SubtitleManagerShell } from "./app-shell/subtitle-manager-shell";
import { useSubtitleManagerScreenModel } from "./hooks/use-subtitle-manager-screen-model";

function AuthenticatedApp({ authRequired, onSignOut }: { authRequired: boolean; onSignOut: () => void }) {
  const model = useSubtitleManagerScreenModel();
  return <SubtitleManagerShell model={model} showSignOut={authRequired} onSignOut={onSignOut} />;
}

export function SubtitleManagerApp() {
  return (
    <AuthGate>
      {({ authRequired, onSignOut }) => <AuthenticatedApp authRequired={authRequired} onSignOut={onSignOut} />}
    </AuthGate>
  );
}
