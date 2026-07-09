import { Info } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import type { Subtitle } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";

import { getSubtitleSourceDetail } from "./source-utils";

type SubtitleSourceDetailButtonProps = {
  subtitle: Subtitle;
  sourceLabel: string;
  className?: string;
};

export function SubtitleSourceDetailButton({ subtitle, sourceLabel, className }: SubtitleSourceDetailButtonProps) {
  const { t } = useI18n();
  const detail = getSubtitleSourceDetail(subtitle);

  if (!detail) {
    return null;
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-foreground", className)}
          title={t("details.sourceDetail")}
          aria-label={t("details.sourceDetail")}
        >
          <Info className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("details.sourceDetailTitle")}</DialogTitle>
          <DialogDescription>{sourceLabel}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">
            {t("details.sourceDetail")}
          </p>
          <p className="surface-panel break-all p-3 text-sm text-foreground">
            {detail}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
