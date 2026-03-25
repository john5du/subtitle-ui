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

interface DeleteSubtitleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subtitle: Subtitle;
  deletePending: boolean;
  onConfirm: () => void;
}

export function DeleteSubtitleDialog({
  open,
  onOpenChange,
  subtitle,
  deletePending,
  onConfirm
}: DeleteSubtitleDialogProps) {
  const { t } = useI18n();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("details.deleteSubtitleTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("details.deleteSubtitleDescription", { name: subtitle.fileName })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deletePending}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
            disabled={deletePending}
          >
            {deletePending ? t("details.deleting") : t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
