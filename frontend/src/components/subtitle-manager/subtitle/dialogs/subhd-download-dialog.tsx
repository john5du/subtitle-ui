"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Download, ExternalLink, Search } from "lucide-react";

import type { SubHDConfig, SubHDSearchPage, SubHDSearchResult, Video } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { requestPayload } from "@/lib/subtitle-manager/api-client";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

import { InlinePending, SpinnerIcon } from "../../shared/pending-state";

const DEFAULT_SUBHD_BASE = "https://subhd.tv";

interface SubHDDownloadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  video: Video | null;
  busy: boolean;
  downloading: boolean;
  onSearch: (video: Video, opts?: { query?: string; page?: number }) => Promise<SubHDSearchPage>;
  onDownload: (video: Video, sid: string) => Promise<boolean>;
}

export function SubHDDownloadDialog({
  open,
  onOpenChange,
  video,
  busy,
  downloading,
  onSearch,
  onDownload
}: SubHDDownloadDialogProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState<SubHDSearchPage | null>(null);
  const [activeSid, setActiveSid] = useState<string | null>(null);
  const [subhdBase, setSubhdBase] = useState(DEFAULT_SUBHD_BASE);

  const runSearch = useCallback(
    async (videoTarget: Video, nextQuery: string) => {
      setLoading(true);
      setError("");
      try {
        const result = await onSearch(videoTarget, { query: nextQuery.trim() || undefined });
        setPage({
          ...result,
          items: Array.isArray(result.items) ? result.items : []
        });
        if (result.query) {
          setQuery(result.query);
        }
      } catch (err) {
        setPage(null);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [onSearch]
  );

  useEffect(() => {
    if (!open || !video) {
      return;
    }
    setQuery("");
    setPage(null);
    setError("");
    setActiveSid(null);
    void (async () => {
      try {
        const cfg = await requestPayload<SubHDConfig>("/api/config/subhd");
        const base = (cfg.baseUrl || cfg.defaultBaseUrl || DEFAULT_SUBHD_BASE).replace(/\/+$/, "");
        setSubhdBase(base || DEFAULT_SUBHD_BASE);
      } catch {
        setSubhdBase(DEFAULT_SUBHD_BASE);
      }
      await runSearch(video, "");
    })();
  }, [open, video?.id, runSearch, video]);

  async function handleSearchSubmit(event: FormEvent) {
    event.preventDefault();
    if (!video || loading || busy || downloading) {
      return;
    }
    await runSearch(video, query);
  }

  async function handleDownload(item: SubHDSearchResult) {
    if (!video || !item.installable || busy || downloading) {
      return;
    }
    setActiveSid(item.sid);
    try {
      const ok = await onDownload(video, item.sid);
      if (ok) {
        onOpenChange(false);
      }
    } finally {
      setActiveSid(null);
    }
  }

  const videoName = video?.title || video?.fileName || "";
  const locked = busy || downloading || loading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(720px,90vh)] max-w-2xl gap-3 overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("download.title")}</DialogTitle>
          <DialogDescription>{t("download.description", { name: videoName })}</DialogDescription>
        </DialogHeader>

        <form className="flex gap-2" onSubmit={handleSearchSubmit}>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("download.searchPlaceholder")}
            disabled={locked}
            className="h-9"
          />
          <Button type="submit" variant="outline" size="sm" className="h-9 shrink-0 gap-1.5" disabled={locked}>
            {loading ? <SpinnerIcon className="h-4 w-4" /> : <Search className="h-4 w-4" />}
            {t("download.search")}
          </Button>
        </form>

        {page?.query ? (
          <p className="text-xs text-muted-foreground">
            {t("download.queryUsed", { query: page.query })}
            {page.total ? ` · ${t("download.resultsTotal", { total: page.total })}` : null}
          </p>
        ) : null}

        <div className="min-h-0 flex-1">
          {loading && !page ? (
            <div className="flex items-center justify-center py-12">
              <InlinePending label={t("download.searching")} />
            </div>
          ) : error ? (
            <div className="surface-status-destructive border p-3 text-sm">{error}</div>
          ) : !page || page.items.length === 0 ? (
            <div className="surface-panel px-4 py-10 text-center text-sm text-muted-foreground">{t("download.empty")}</div>
          ) : (
            <ScrollArea className="h-[min(420px,50vh)]">
              <ul className="space-y-2 pr-3">
                {page.items.map((item) => {
                  const rowDownloading = downloading && activeSid === item.sid;
                  const disabled = !item.installable || locked;
                  return (
                    <li
                      key={item.sid}
                      className={cn(
                        "surface-panel flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between",
                        rowDownloading && "animate-pulse-soft"
                      )}
                    >
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="min-w-0 truncate text-sm font-semibold" title={item.title || item.version}>
                            {item.title || item.version || item.sid}
                          </p>
                          {item.format ? <Badge variant="secondary">{item.format}</Badge> : null}
                          {item.sourceTag ? <Badge variant="secondary">{item.sourceTag}</Badge> : null}
                          {!item.installable ? (
                            <Badge variant="secondary" className="text-muted-foreground">
                              {t("download.notInstallable")}
                            </Badge>
                          ) : null}
                        </div>
                        {item.version && item.version !== item.title ? (
                          <p className="line-clamp-2 text-xs text-muted-foreground" title={item.version}>
                            {t("download.version")}: {item.version}
                          </p>
                        ) : null}
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {item.langs && item.langs.length > 0 ? (
                            <span>
                              {t("download.langs")}: {item.langs.join(" / ")}
                            </span>
                          ) : null}
                          {item.size ? <span>{t("details.sizeValue", { value: item.size })}</span> : null}
                          {item.downloads ? (
                            <span>
                              {t("download.downloads")}: {item.downloads}
                            </span>
                          ) : null}
                          {item.publisher ? <span>{item.publisher}</span> : null}
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        <Button type="button" variant="outline" size="sm" className="h-8 gap-1 px-2 text-caption" asChild>
                          <a href={`${subhdBase}/a/${encodeURIComponent(item.sid)}`} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-3.5 w-3.5" />
                            {t("download.openOnSubHD")}
                          </a>
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="h-8 gap-1 px-2 text-caption"
                          disabled={disabled}
                          onClick={() => {
                            void handleDownload(item);
                          }}
                        >
                          {rowDownloading ? <SpinnerIcon className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
                          {rowDownloading ? t("download.downloading") : t("download.action")}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
