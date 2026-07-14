import { Eye } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import type { ZipSubtitleEntry } from "@/lib/subtitle-zip";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { SpinnerIcon } from "../../shared/pending-state";

interface ArchiveEntryPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "upload" | "replace" | "pick";
  zipPickFileName: string;
  zipPickEntries: ZipSubtitleEntry[];
  zipUploadLabel: string;
  onZipUploadLabelChange: (value: string) => void;
  selectedZipEntryId: string;
  onSelectZipEntryId: (value: string) => void;
  onPreviewEntry: (entry: ZipSubtitleEntry) => void;
  onConfirm: () => void;
  busy: boolean;
  uploading: boolean;
  zipLoading: boolean;
  hidePreview?: boolean;
}

export function ArchiveEntryPickerDialog({
  open,
  onOpenChange,
  mode,
  zipPickFileName,
  zipPickEntries,
  zipUploadLabel,
  onZipUploadLabelChange,
  selectedZipEntryId,
  onSelectZipEntryId,
  onPreviewEntry,
  onConfirm,
  busy,
  uploading,
  zipLoading,
  hidePreview = false
}: ArchiveEntryPickerDialogProps) {
  const { t } = useI18n();
  const confirmLabel =
    mode === "upload"
      ? t("details.confirmUploadFromArchive")
      : mode === "replace"
        ? t("details.confirmReplaceFromArchive")
        : t("common.confirm");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(92dvh,100%)] flex-col overflow-hidden sm:max-h-[85vh] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("details.selectArchiveSubtitle")}</DialogTitle>
          <DialogDescription>
            {t("details.archiveDescription", { name: zipPickFileName || "-", count: zipPickEntries.length })}
          </DialogDescription>
        </DialogHeader>

        {mode === "upload" && (
          <div className="space-y-2">
            <p className="text-sm font-semibold">{t("details.uploadLabelTitle")}</p>
            <Input
              value={zipUploadLabel}
              maxLength={32}
              placeholder="zh&en"
              onChange={(event) => onZipUploadLabelChange(event.target.value)}
            />
          </div>
        )}

        <div className="space-y-2">
          <p className="text-sm font-semibold">{t("details.archiveSubtitleFiles")}</p>
          <div className={cn("max-h-[55vh] overflow-auto", zipLoading && "animate-pulse-soft")}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("details.filePath")}</TableHead>
                  <TableHead className="w-[100px] text-right">{t("details.size")}</TableHead>
                  {!hidePreview ? <TableHead className="w-[120px] text-center">{t("common.preview")}</TableHead> : null}
                  <TableHead className="w-[96px] text-center">{t("details.selectFile")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {zipPickEntries.map((entry) => {
                  const checked = selectedZipEntryId === entry.id;
                  return (
                    <TableRow
                      key={entry.id}
                      className={cn(checked && "bg-surface-hover")}
                      onClick={() => {
                        if (busy || uploading || zipLoading) {
                          return;
                        }
                        onSelectZipEntryId(checked ? "" : entry.id);
                      }}
                    >
                      <TableCell className="break-all text-xs">{entry.path}</TableCell>
                      <TableCell className="text-right text-xs">{Math.max(1, Math.round(entry.size / 1024))} KB</TableCell>
                      {!hidePreview ? (
                        <TableCell className="text-center">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            title={t("common.preview")}
                            aria-label={t("common.preview")}
                            onClick={(event) => {
                              event.stopPropagation();
                              onPreviewEntry(entry);
                            }}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      ) : null}
                      <TableCell className="text-center">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={busy || uploading || zipLoading}
                          aria-label={t("details.actionsForSubtitle", { name: entry.path })}
                          onChange={(event) => {
                            onSelectZipEntryId(event.target.checked ? entry.id : "");
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}

                {zipPickEntries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={hidePreview ? 3 : 4} className="py-6 text-center text-sm text-muted-foreground">
                      {t("details.noArchiveEntries")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.close")}
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={busy || uploading || zipLoading || !selectedZipEntryId}
          >
            {uploading ? <SpinnerIcon className="h-4 w-4" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
