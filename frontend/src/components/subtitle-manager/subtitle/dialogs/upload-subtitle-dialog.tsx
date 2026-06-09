import type { SubtitleSourceEncoding } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { SpinnerIcon } from "../../shared/pending-state";

const SOURCE_ENCODING_OPTIONS: SubtitleSourceEncoding[] = ["auto", "utf-8", "utf-16le", "utf-16be", "gb18030", "big5"];

interface UploadSubtitleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingUploadFile: File | null;
  uploadLabel: string;
  onUploadLabelChange: (value: string) => void;
  canConvertToAss: boolean;
  convertToAss: boolean;
  onConvertToAssChange: (value: boolean) => void;
  sourceEncoding: SubtitleSourceEncoding;
  onSourceEncodingChange: (value: SubtitleSourceEncoding) => void;
  onConfirm: () => void;
  busy: boolean;
  uploadPending: boolean;
}

export function UploadSubtitleDialog({
  open,
  onOpenChange,
  pendingUploadFile,
  uploadLabel,
  onUploadLabelChange,
  canConvertToAss,
  convertToAss,
  onConvertToAssChange,
  sourceEncoding,
  onSourceEncodingChange,
  onConfirm,
  busy,
  uploadPending
}: UploadSubtitleDialogProps) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("details.uploadLabelTitle")}</DialogTitle>
          <DialogDescription>
            {pendingUploadFile ? t("details.fileDescription", { name: pendingUploadFile.name }) : t("details.uploadLabelDescription")}
          </DialogDescription>
        </DialogHeader>

        <Input
          value={uploadLabel}
          maxLength={32}
          placeholder="zh"
          onChange={(event) => onUploadLabelChange(event.target.value)}
        />

        <div className="space-y-3 border border-border bg-surface-subtle p-3">
          <label className="flex items-center gap-3 text-sm font-medium">
            <input
              type="checkbox"
              checked={convertToAss}
              disabled={!canConvertToAss || busy}
              onChange={(event) => onConvertToAssChange(event.target.checked)}
            />
            <span>{t("conversion.uploadConvertToAss")}</span>
          </label>

          {convertToAss && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("conversion.sourceEncoding")}</p>
              <Select value={sourceEncoding} onValueChange={(value) => onSourceEncodingChange(value as SubtitleSourceEncoding)} disabled={busy}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_ENCODING_OPTIONS.map((encoding) => (
                    <SelectItem key={encoding} value={encoding}>
                      {encoding.toUpperCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={!pendingUploadFile || busy}
          >
            {uploadPending ? <SpinnerIcon className="h-4 w-4" /> : null}
            {uploadPending ? t("details.uploading") : t("details.upload")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
