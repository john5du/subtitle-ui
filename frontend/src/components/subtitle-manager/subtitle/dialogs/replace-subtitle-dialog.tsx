import type { Subtitle } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";

interface ReplaceSubtitleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subtitle: Subtitle | null;
  newFileName: string;
  replacePending: boolean;
  onConfirm: () => void;
}

export function ReplaceSubtitleDialog({
  open,
  onOpenChange,
  subtitle,
  newFileName,
  replacePending,
  onConfirm
}: ReplaceSubtitleDialogProps) {
  const { t } = useI18n();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("details.replaceSubtitleTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("details.replaceSubtitleDescription", {
              current: subtitle?.fileName ?? "-",
              next: newFileName
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p className="text-xs text-muted-foreground">{t("details.replaceSubtitleBackupNote")}</p>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={replacePending}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
            disabled={replacePending}
          >
            {replacePending ? t("common.replacing") : t("common.replace")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
