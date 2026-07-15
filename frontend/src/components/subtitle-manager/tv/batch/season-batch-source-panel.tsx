import { ExternalLink, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { SpinnerIcon } from "../../shared/pending-state";
import type { SeasonBatchWorkspaceModel } from "./use-season-batch-workspace";

type SourcePanelProps = Pick<
  SeasonBatchWorkspaceModel,
  | "t"
  | "busy"
  | "uploading"
  | "batchPreparing"
  | "subhdEnabled"
  | "sourceMode"
  | "switchSourceMode"
  | "subhdQuery"
  | "setSubhdQuery"
  | "subhdSearching"
  | "searchSubHDSeason"
  | "skipExisting"
  | "setSkipExisting"
  | "subhdTitlePage"
  | "batchNotices"
  | "subhdResults"
  | "selectedSubhdSid"
  | "setSelectedSubhdSid"
  | "externalSearchLinks"
  | "batchInputRef"
>;

export function SeasonBatchSourcePanel({
  t,
  busy,
  uploading,
  batchPreparing,
  subhdEnabled,
  sourceMode,
  switchSourceMode,
  subhdQuery,
  setSubhdQuery,
  subhdSearching,
  searchSubHDSeason,
  skipExisting,
  setSkipExisting,
  subhdTitlePage,
  batchNotices,
  subhdResults,
  selectedSubhdSid,
  setSelectedSubhdSid,
  externalSearchLinks,
  batchInputRef
}: SourcePanelProps) {
  return (
    <>
      {subhdEnabled ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={sourceMode === "subhd" ? "default" : "outline"}
            disabled={busy || batchPreparing || uploading}
            onClick={() => switchSourceMode("subhd")}
          >
            {t("batch.source.subhd")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={sourceMode === "local" ? "default" : "outline"}
            disabled={busy || batchPreparing || uploading}
            onClick={() => switchSourceMode("local")}
          >
            {t("batch.source.localFallback")}
          </Button>
        </div>
      ) : null}

      {sourceMode === "subhd" ? (
        <div className="surface-panel space-y-3 p-3 sm:p-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              size="sm"
              value={subhdQuery}
              onChange={(event) => setSubhdQuery(event.target.value)}
              placeholder={t("batch.subhd.queryPlaceholder")}
              disabled={busy || batchPreparing || uploading || subhdSearching}
            />
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={busy || batchPreparing || uploading || subhdSearching}
              onClick={() => void searchSubHDSeason()}
              title={subhdSearching ? t("batch.subhd.searching") : t("common.search")}
              aria-label={subhdSearching ? t("batch.subhd.searching") : t("common.search")}
            >
              {subhdSearching ? <SpinnerIcon className="h-4 w-4" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>

          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={skipExisting}
              disabled={busy || batchPreparing || uploading}
              onChange={(event) => setSkipExisting(event.target.checked)}
            />
            {t("batch.subhd.skipExisting")}
          </label>

          {subhdTitlePage.doubanId ? (
            <p className="text-xs text-muted-foreground">
              {t("batch.subhd.titlePage", {
                title: subhdTitlePage.title || "-",
                id: subhdTitlePage.doubanId
              })}
              {subhdTitlePage.url ? (
                <>
                  {" · "}
                  <a
                    className="underline underline-offset-2 hover:text-foreground"
                    href={`https://subhd.tv${subhdTitlePage.url.startsWith("/") ? subhdTitlePage.url : `/${subhdTitlePage.url}`}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {subhdTitlePage.url}
                  </a>
                </>
              ) : null}
            </p>
          ) : null}

          {batchNotices.length > 0 ? (
            <div className="space-y-1 text-sm text-muted-foreground">
              {batchNotices.map((notice) => (
                <p key={notice}>{notice}</p>
              ))}
            </div>
          ) : null}

          {subhdResults.length > 0 ? (
            <div className="space-y-2">
              {subhdResults.slice(0, 20).map((item) => {
                const selected = selectedSubhdSid === item.sid;
                return (
                  <button
                    key={item.sid}
                    type="button"
                    disabled={!item.installable || busy || batchPreparing || uploading}
                    onClick={() => setSelectedSubhdSid(item.sid)}
                    className={cn(
                      "flex w-full flex-col gap-1 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                      selected ? "border-primary bg-primary/5" : "border-border hover:bg-surface-hover",
                      !item.installable && "opacity-50"
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary">{t("batch.subhd.packBadge")}</Badge>
                      <span className="font-semibold">{item.version || item.title || item.sid}</span>
                      {item.format ? <Badge variant="outline">{item.format}</Badge> : null}
                      {!item.installable ? <Badge variant="secondary">{t("download.notInstallable")}</Badge> : null}
                    </div>
                    {item.langs && item.langs.length > 0 ? (
                      <span className="text-xs text-muted-foreground">{item.langs.join(" / ")}</span>
                    ) : null}
                    {item.downloads ? (
                      <span className="text-xs text-muted-foreground">
                        {t("download.downloads")}: {item.downloads}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}

          {!subhdSearching && subhdResults.length === 0 && (batchNotices.length > 0 || subhdTitlePage.message) ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                title={t("download.openSubHDSearch")}
                aria-label={t("download.openSubHDSearch")}
                asChild
              >
                <a href={externalSearchLinks.subhd} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                title={t("download.openZimuku")}
                aria-label={t("download.openZimuku")}
                asChild
              >
                <a href={externalSearchLinks.zimuku} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="surface-panel space-y-3 p-4">
          <Button type="button" disabled={busy || batchPreparing} onClick={() => batchInputRef.current?.click()}>
            {t("batch.selectFiles")}
          </Button>
          {batchNotices.length > 0 ? (
            <div className="space-y-1 text-sm text-muted-foreground">
              {batchNotices.map((notice) => (
                <p key={notice}>{notice}</p>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
