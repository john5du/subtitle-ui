import { useI18n } from "@/lib/i18n";

import { SpinnerIcon } from "./pending-state";

export function UploadBlockingOverlay({ message }: { message: string }) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-[rgba(31,34,40,0.85)]">
      <div className="animate-scale-in mx-4 flex min-w-[280px] max-w-[420px] flex-col items-center gap-3 border bg-card px-6 py-7 text-center">
        <span className="inline-flex h-12 w-12 items-center justify-center border border-input bg-surface-strong text-white">
          <SpinnerIcon className="h-5 w-5" />
        </span>
        <div className="space-y-1">
          <p className="text-sm font-semibold">{t("details.uploadingSubtitlesTitle")}</p>
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {message || t("details.uploadingSubtitleFiles")}
          </p>
        </div>
      </div>
    </div>
  );
}
