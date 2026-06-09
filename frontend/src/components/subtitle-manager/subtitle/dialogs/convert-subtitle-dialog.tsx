import type { Subtitle, SubtitleSourceEncoding } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { SpinnerIcon } from "../../shared/pending-state";

const SOURCE_ENCODING_OPTIONS: SubtitleSourceEncoding[] = ["auto", "utf-8", "utf-16le", "utf-16be", "gb18030", "big5"];

interface ConvertSubtitleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subtitle: Subtitle | null;
  sourceEncoding: SubtitleSourceEncoding;
  onSourceEncodingChange: (value: SubtitleSourceEncoding) => void;
  convertPending: boolean;
  onConfirm: () => void;
}

export function ConvertSubtitleDialog({
  open,
  onOpenChange,
  subtitle,
  sourceEncoding,
  onSourceEncodingChange,
  convertPending,
  onConfirm
}: ConvertSubtitleDialogProps) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("conversion.convertSubtitleTitle")}</DialogTitle>
          <DialogDescription>
            {t("conversion.convertSubtitleDescription", { name: subtitle?.fileName ?? "-" })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("conversion.sourceEncoding")}</p>
          <Select
            value={sourceEncoding}
            onValueChange={(value) => onSourceEncodingChange(value as SubtitleSourceEncoding)}
            disabled={convertPending}
          >
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

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={convertPending}>
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={onConfirm} disabled={!subtitle || convertPending}>
            {convertPending ? <SpinnerIcon className="h-4 w-4" /> : null}
            {convertPending ? t("conversion.converting") : t("conversion.convertToAss")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
