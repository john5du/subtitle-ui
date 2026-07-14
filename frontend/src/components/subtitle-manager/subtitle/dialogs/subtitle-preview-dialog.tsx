import { useI18n } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { InlinePending } from "../../shared/pending-state";
import { SUBTITLE_PREVIEW_CHAR_LIMIT } from "../preview-utils";

interface SubtitlePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  previewTitle: string;
  previewStatus: "idle" | "loading" | "success" | "error" | "empty";
  previewError: string;
  previewContent: string;
  previewEncoding: string;
  previewTruncated: boolean;
}

export function SubtitlePreviewDialog({
  open,
  onOpenChange,
  previewTitle,
  previewStatus,
  previewError,
  previewContent,
  previewEncoding,
  previewTruncated
}: SubtitlePreviewDialogProps) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t("details.previewTitle", { name: previewTitle || "-" })}</DialogTitle>
        </DialogHeader>

        <DialogBody>
          <div className="min-h-0 flex-1 overflow-auto bg-surface-subtle p-3">
            {previewStatus === "loading" && (
              <div className="flex h-full items-center justify-center">
                <InlinePending label={t("details.previewLoading")} />
              </div>
            )}

            {previewStatus === "error" && (
              <div className="flex h-full items-center justify-center text-sm text-destructive">
                {t("details.previewFailed", { error: previewError || "-" })}
              </div>
            )}

            {previewStatus === "empty" && (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {t("details.previewEmpty")}
              </div>
            )}

            {previewStatus === "success" && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {previewEncoding && <Badge variant="secondary">{previewEncoding}</Badge>}
                  {previewTruncated && (
                    <span className="text-xs text-muted-foreground">
                      {t("details.previewTruncated", { count: SUBTITLE_PREVIEW_CHAR_LIMIT })}
                    </span>
                  )}
                </div>
                <pre className="overflow-auto whitespace-pre-wrap break-words bg-surface-strong p-3 font-mono text-xs leading-5">
                  {previewContent}
                </pre>
              </div>
            )}
          </div>
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
