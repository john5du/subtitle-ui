"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

import { getAdminToken } from "@/lib/admin-token";
import { copyToClipboard } from "@/lib/clipboard";
import { useI18n } from "@/lib/i18n";
import { buildMcpClientConfigJson, resolveMcpAbsoluteUrl } from "@/lib/mcp-client-config";
import { emitToast } from "@/lib/toast";
import type { MCPConfig } from "@/lib/types";
import { requestPayload } from "@/lib/subtitle-manager/api-client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

import { SpinnerIcon } from "../pending-state";
import { SaveSettingsButton, SettingsLabel } from "./settings-shared";

export function MCPSettingsPanel() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<MCPConfig | null>(null);
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [token, setToken] = useState("");
  const [fullUrl, setFullUrl] = useState("/mcp");
  const copiedResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const endpoint = config?.endpoint || "/mcp";

  useEffect(() => {
    setToken(getAdminToken());
  }, []);

  useEffect(() => {
    setFullUrl(resolveMcpAbsoluteUrl(endpoint));
  }, [endpoint]);

  useEffect(() => {
    return () => {
      if (copiedResetTimerRef.current !== null) {
        clearTimeout(copiedResetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      setLoading(true);
      setError("");
      try {
        const next = await requestPayload<MCPConfig>("/api/config/mcp");
        if (cancelled) {
          return;
        }
        setConfig(next);
        setDraftEnabled(Boolean(next.enabled));
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        const message = loadError instanceof Error ? loadError.message : String(loadError);
        setError(message);
        emitToast({
          level: "error",
          message: t("mcp.settingsLoadFailed"),
          detail: message
        });
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, [t]);

  async function saveConfig() {
    setSaving(true);
    setError("");
    try {
      const next = await requestPayload<MCPConfig>("/api/config/mcp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: draftEnabled })
      });
      setConfig(next);
      setDraftEnabled(Boolean(next.enabled));
      emitToast({
        level: "success",
        message: t("mcp.settingsSavedTitle")
      });
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError);
      setError(message);
      emitToast({
        level: "error",
        message: t("mcp.settingsSaveFailed"),
        detail: message
      });
    } finally {
      setSaving(false);
    }
  }

  const clientConfigJson = useMemo(
    () => buildMcpClientConfigJson(fullUrl, token || "<ADMIN_TOKEN>"),
    [fullUrl, token]
  );

  async function handleCopyConfig() {
    const ok = await copyToClipboard(clientConfigJson);
    if (!ok) {
      emitToast({ level: "error", message: t("mcp.copyFailed") });
      return;
    }
    setCopied(true);
    emitToast({ level: "success", message: t("mcp.copied") });
    if (copiedResetTimerRef.current !== null) {
      clearTimeout(copiedResetTimerRef.current);
    }
    copiedResetTimerRef.current = setTimeout(() => {
      copiedResetTimerRef.current = null;
      setCopied(false);
    }, 1500);
  }

  const enabledEffective = config?.enabled ?? false;

  return (
    <div className="surface-panel space-y-4 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <SettingsLabel>{t("mcp.enabled")}</SettingsLabel>
        <Switch
          checked={draftEnabled}
          onCheckedChange={setDraftEnabled}
          disabled={loading || saving}
          aria-label={t("mcp.enabled")}
          title={draftEnabled ? t("mcp.enabledOn") : t("mcp.enabledOff")}
        />
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <SettingsLabel help={t("mcp.clientConfigHint")}>{t("mcp.clientConfig")}</SettingsLabel>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={loading}
            onClick={() => void handleCopyConfig()}
            aria-label={t("mcp.copyConfig")}
            title={t("mcp.copyConfig")}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
        <pre className="max-h-48 overflow-auto rounded-md border border-border bg-surface-subtle p-2 font-mono text-xs text-foreground whitespace-pre-wrap break-all">
          {clientConfigJson}
        </pre>
        {!token && <p className="text-xs text-muted-foreground">{t("mcp.tokenMissing")}</p>}
        {!loading && !enabledEffective && (
          <p className="text-xs text-muted-foreground">{t("mcp.enableFirst")}</p>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <SpinnerIcon className="h-4 w-4" />
        </div>
      )}
      {error && <p className="break-words text-sm text-destructive">{error}</p>}

      <div className="flex justify-end">
        <SaveSettingsButton
          saving={saving}
          disabled={loading || saving}
          label={t("mcp.saveSettings")}
          savingLabel={t("common.saving")}
          onClick={() => void saveConfig()}
        />
      </div>
    </div>
  );
}
