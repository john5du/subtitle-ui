import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { SpinnerIcon } from "../../shared/pending-state";

interface UploadSubtitleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingUploadFile: File | null;
  uploadLabel: string;
  onUploadLabelChange: (value: string) => void;
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
