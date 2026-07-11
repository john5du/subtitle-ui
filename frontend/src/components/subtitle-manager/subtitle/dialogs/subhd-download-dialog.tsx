"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Download, ExternalLink, Search, UploadCloud } from "lucide-react";

import type { SubHDConfig, SubHDDownloadOptions, SubHDSearchPage, SubHDSearchResult, Video } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { ApiRequestError, requestPayload } from "@/lib/subtitle-manager/api-client";
import { buildSubtitleSearchLinks, buildSubtitleSearchLinksByKeyword } from "@/lib/subtitle-search";
import type { ArchiveEntryMeta } from "@/lib/types";
import type { ZipSubtitleEntry } from "@/lib/subtitle-zip";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

import { InlinePending, SpinnerIcon } from "../../shared/pending-state";
import { ArchiveEntryPickerDialog } from "./archive-entry-picker-dialog";

const DEFAULT_SUBHD_BASE = "https://subhd.tv";

interface SubHDDownloadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  video: Video | null;
  busy: boolean;
  downloading: boolean;
  onSearch: (video: Video, opts?: { query?: string; page?: number }) => Promise<SubHDSearchPage>;
  onDownload: (video: Video, sid: string, options?: SubHDDownloadOptions) => Promise<boolean>;
  /** Optional keyword for external search links (defaults to video title/year). */
  searchKeyword?: string;
  /** Open local file picker as fallback (parent owns upload workflow). */
  onUploadLocal?: () => void;
  uploadLocalPending?: boolean;
  showExternalSearchLinks?: boolean;
}

function toZipEntries(entries: ArchiveEntryMeta[]): ZipSubtitleEntry[] {
  return entries.map((entry, index) => {
    const path = (entry.path || entry.fileName || "").replace(/\\/g, "/").replace(/^\/+/, "");
    return {
      id: `subhd-${index}-${path.toLowerCase()}`,
      path,
      fileName: entry.fileName || path.split("/").pop() || path,
      size: Number(entry.size) || 0,
      archiveEntry: path
    };
  });
}

export function SubHDDownloadDialog({
  open,
  onOpenChange,
  video,
  busy,
  downloading,
  onSearch,
  onDownload,
  searchKeyword,
  onUploadLocal,
  uploadLocalPending = false,
  showExternalSearchLinks = true
}: SubHDDownloadDialogProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState<SubHDSearchPage | null>(null);
  const [activeSid, setActiveSid] = useState<string | null>(null);
  const [subhdBase, setSubhdBase] = useState(DEFAULT_SUBHD_BASE);
  const [entryPickerOpen, setEntryPickerOpen] = useState(false);
  const [entryPickSid, setEntryPickSid] = useState("");
  const [entryPickEntries, setEntryPickEntries] = useState<ZipSubtitleEntry[]>([]);
  const [selectedEntryId, setSelectedEntryId] = useState("");
  const [entryPickBusy, setEntryPickBusy] = useState(false);

  const externalLinks = useMemo(() => {
    if (!showExternalSearchLinks) {
      return null;
    }
    const keyword = (searchKeyword || query || "").trim();
    if (keyword) {
      return buildSubtitleSearchLinksByKeyword(keyword);
    }
    if (video) {
      return buildSubtitleSearchLinks(video);
    }
    return null;
  }, [query, searchKeyword, showExternalSearchLinks, video]);

  const showFallback = Boolean(onUploadLocal || externalLinks);

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
    setEntryPickerOpen(false);
    setEntryPickSid("");
    setEntryPickEntries([]);
    setSelectedEntryId("");
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

  async function handleDownload(item: SubHDSearchResult, archiveEntry?: string) {
    if (!video || !item.installable || busy || downloading) {
      return;
    }
    setActiveSid(item.sid);
    try {
      const ok = await onDownload(video, item.sid, archiveEntry ? { archiveEntry } : undefined);
      if (ok) {
        setEntryPickerOpen(false);
        onOpenChange(false);
      }
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "archive_multiple_entries" && err.entries?.length) {
        setEntryPickSid(item.sid);
        setEntryPickEntries(toZipEntries(err.entries));
        setSelectedEntryId("");
        setEntryPickerOpen(true);
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActiveSid(null);
    }
  }

  async function confirmEntryPick() {
    if (!video || !entryPickSid) {
      return;
    }
    const entry = entryPickEntries.find((item) => item.id === selectedEntryId);
    if (!entry) {
      return;
    }
    setEntryPickBusy(true);
    try {
      const ok = await onDownload(video, entryPickSid, { archiveEntry: entry.archiveEntry || entry.path });
      if (ok) {
        setEntryPickerOpen(false);
        onOpenChange(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEntryPickBusy(false);
    }
  }

  const videoName = video?.title || video?.fileName || "";
  const locked = busy || downloading || loading;

  return (
    <>
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
            <Button
              type="submit"
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              disabled={locked}
              title={t("download.search")}
              aria-label={t("download.search")}
            >
              {loading ? <SpinnerIcon className="h-4 w-4" /> : <Search className="h-4 w-4" />}
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
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            title={t("download.openOnSubHD")}
                            aria-label={t("download.openOnSubHD")}
                            asChild
                          >
                            <a href={`${subhdBase}/a/${encodeURIComponent(item.sid)}`} target="_blank" rel="noreferrer">
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            className="h-8 w-8"
                            disabled={disabled}
                            title={rowDownloading ? t("download.downloading") : t("download.action")}
                            aria-label={rowDownloading ? t("download.downloading") : t("download.action")}
                            onClick={() => {
                              void handleDownload(item);
                            }}
                          >
                            {rowDownloading ? <SpinnerIcon className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </ScrollArea>
            )}
          </div>

          {showFallback ? (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-caption font-semibold uppercase tracking-section text-foreground-muted">
                {t("download.fallbackSection")}
              </p>
              <div className="flex flex-wrap gap-2">
                {onUploadLocal ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={locked}
                    title={t("download.uploadLocal")}
                    aria-label={t("download.uploadLocal")}
                    onClick={() => {
                      onOpenChange(false);
                      onUploadLocal();
                    }}
                  >
                    {uploadLocalPending ? <SpinnerIcon className="h-3.5 w-3.5" /> : <UploadCloud className="h-3.5 w-3.5" />}
                  </Button>
                ) : null}
                {externalLinks ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      title={t("download.openSubHDSearch")}
                      aria-label={t("download.openSubHDSearch")}
                      asChild
                    >
                      <a href={externalLinks.subhd} target="_blank" rel="noreferrer">
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
                      <a href={externalLinks.zimuku} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <ArchiveEntryPickerDialog
        open={entryPickerOpen}
        onOpenChange={setEntryPickerOpen}
        mode="pick"
        zipPickFileName={entryPickSid ? `SubHD ${entryPickSid}` : "SubHD"}
        zipPickEntries={entryPickEntries}
        zipUploadLabel=""
        onZipUploadLabelChange={() => undefined}
        selectedZipEntryId={selectedEntryId}
        onSelectZipEntryId={setSelectedEntryId}
        onPreviewEntry={() => undefined}
        onConfirm={() => {
          void confirmEntryPick();
        }}
        busy={busy || entryPickBusy}
        uploading={entryPickBusy || downloading}
        zipLoading={false}
        hidePreview
      />
    </>
  );
}
