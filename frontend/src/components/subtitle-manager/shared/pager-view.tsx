import { useEffect, useId, useState, type KeyboardEvent } from "react";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import type { Pager } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PagerView({
  pager,
  onSetPage,
  disabled = false
}: {
  pager: Pager;
  onSetPage: (page: number) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const totalPages = Math.max(1, pager.totalPages);
  const [jumpDraft, setJumpDraft] = useState(String(pager.page));
  const jumpInputId = useId();

  useEffect(() => {
    setJumpDraft(String(pager.page));
  }, [pager.page]);

  if (totalPages <= 1 && pager.total <= 0) {
    return null;
  }

  function commitJump() {
    const next = Number.parseInt(jumpDraft, 10);
    if (!Number.isFinite(next)) {
      setJumpDraft(String(pager.page));
      return;
    }
    const clamped = Math.min(Math.max(next, 1), totalPages);
    if (clamped !== pager.page) {
      onSetPage(clamped);
    } else {
      setJumpDraft(String(pager.page));
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitJump();
    }
  }

  const jumpAria = t("pager.gotoAria", { page: pager.page, totalPages });
  const prevLabel = t("pager.prev");
  const nextLabel = t("pager.next");
  const summaryArgs = { page: pager.page, totalPages, total: pager.total };

  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-20 flex justify-center sm:inset-x-4 sm:bottom-4">
      <div className="pointer-events-auto flex w-full max-w-[720px] items-center justify-between gap-2 border border-border bg-card/90 px-3 py-2.5 shadow-lg backdrop-blur sm:w-auto sm:min-w-[420px]">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-10 w-10 shrink-0 touch-target sm:h-8 sm:w-8"
          disabled={disabled || pager.page <= 1}
          onClick={() => onSetPage(pager.page - 1)}
          aria-label={prevLabel}
          title={prevLabel}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex min-w-0 items-center justify-center gap-3 text-xs text-muted-foreground">
          <span className="sm:hidden">{t("pager.summaryCompact", summaryArgs)}</span>
          <span className="hidden sm:inline">{t("pager.summary", summaryArgs)}</span>
          {totalPages > 1 && (
            <span className="hidden items-center gap-1 sm:flex">
              <label className="sr-only" htmlFor={jumpInputId}>
                {jumpAria}
              </label>
              <Input
                id={jumpInputId}
                inputMode="numeric"
                pattern="[0-9]*"
                className="h-7 w-14 px-2 text-center text-xs"
                value={jumpDraft}
                disabled={disabled}
                aria-label={jumpAria}
                onChange={(event) => setJumpDraft(event.target.value.replace(/[^0-9]/g, ""))}
                onBlur={commitJump}
                onKeyDown={onKeyDown}
              />
              <span>/ {totalPages}</span>
            </span>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-10 w-10 shrink-0 touch-target sm:h-8 sm:w-8"
          disabled={disabled || pager.page >= totalPages}
          onClick={() => onSetPage(pager.page + 1)}
          aria-label={nextLabel}
          title={nextLabel}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
