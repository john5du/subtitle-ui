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
import { DialogHelpTip } from "@/components/ui/dialog-help-tip";

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
  const backupNote = t("details.replaceSubtitleBackupNote");

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-1.5">
            <span>{t("details.replaceSubtitleTitle")}</span>
            <DialogHelpTip text={backupNote} />
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("details.replaceSubtitleDescription", {
              current: subtitle?.fileName ?? "-",
              next: newFileName
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
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
