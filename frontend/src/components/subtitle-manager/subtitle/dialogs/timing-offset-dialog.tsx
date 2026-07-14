import type { Subtitle } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { DialogHelpTip } from "@/components/ui/dialog-help-tip";
import { Input } from "@/components/ui/input";

import { SpinnerIcon } from "../../shared/pending-state";

const MAX_OFFSET_SECONDS = 12 * 60 * 60;
const OFFSET_PRESETS = [-5, -1, -0.5, 0.5, 1, 5];

interface TimingOffsetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subtitle: Subtitle | null;
  offsetSeconds: string;
  onOffsetSecondsChange: (value: string) => void;
  offsetPending: boolean;
  onConfirm: (offsetMs: number) => void;
}

export function parseOffsetSecondsToMilliseconds(value: string) {
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  const seconds = Number(trimmed);
  if (!Number.isFinite(seconds)) {
    return null;
  }
  const offsetMs = Math.round(seconds * 1000);
  if (offsetMs === 0 || Math.abs(offsetMs) > MAX_OFFSET_SECONDS * 1000) {
    return null;
  }
  return offsetMs;
}

function formatPresetLabel(seconds: number) {
  return `${seconds > 0 ? "+" : ""}${seconds}s`;
}

export function TimingOffsetDialog({
  open,
  onOpenChange,
  subtitle,
  offsetSeconds,
  onOffsetSecondsChange,
  offsetPending,
  onConfirm
}: TimingOffsetDialogProps) {
  const { t } = useI18n();
  const offsetMs = parseOffsetSecondsToMilliseconds(offsetSeconds);
  const contextText = t("timing.offsetDescription", { name: subtitle?.fileName ?? "-" });
  const helpText = `${t("timing.offsetHint")}\n${t("timing.offsetBackupNote")}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            <span>{t("timing.offsetTitle")}</span>
            <DialogHelpTip text={helpText} label={helpText} />
          </DialogTitle>
          <DialogDescription className="sr-only">{contextText}</DialogDescription>
          <p className="text-sm text-muted-foreground">{contextText}</p>
        </DialogHeader>

        <div className="space-y-4">
          <label className="space-y-2 text-sm">
            <span className="font-medium">{t("timing.offsetSecondsLabel")}</span>
            <Input
              type="number"
              inputMode="decimal"
              step="0.1"
              min={-MAX_OFFSET_SECONDS}
              max={MAX_OFFSET_SECONDS}
              value={offsetSeconds}
              onChange={(event) => onOffsetSecondsChange(event.target.value)}
              disabled={offsetPending}
            />
          </label>

          <div className="flex flex-wrap gap-1.5">
            {OFFSET_PRESETS.map((seconds) => (
              <Button
                key={seconds}
                type="button"
                variant="outline"
                size="sm"
                className="h-8 px-2 text-xs"
                disabled={offsetPending}
                onClick={() => onOffsetSecondsChange(String(seconds))}
              >
                {formatPresetLabel(seconds)}
              </Button>
            ))}
          </div>

          {offsetSeconds.trim() && !offsetMs ? (
            <p className="text-xs text-destructive">{t("timing.invalidOffset")}</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={offsetPending}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={!subtitle || !offsetMs || offsetPending}
            onClick={() => {
              if (offsetMs) {
                onConfirm(offsetMs);
              }
            }}
          >
            {offsetPending ? <SpinnerIcon className="mr-2 h-4 w-4" /> : null}
            {offsetPending ? t("timing.offsetting") : t("timing.applyOffset")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
