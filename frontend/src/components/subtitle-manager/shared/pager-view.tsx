import { useEffect, useState, type KeyboardEvent } from "react";

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

  return (
    <div className="surface-subtle flex flex-col gap-3 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <Button type="button" variant="outline" size="sm" className="sm:min-w-[92px]" disabled={disabled || pager.page <= 1} onClick={() => onSetPage(pager.page - 1)}>
        {t("pager.prev")}
      </Button>
      <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
        <span>{t("pager.summary", { page: pager.page, totalPages, total: pager.total })}</span>
        {totalPages > 1 && (
          <span className="flex items-center gap-1">
            <label className="sr-only" htmlFor="pager-goto-input">
              {jumpAria}
            </label>
            <Input
              id="pager-goto-input"
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
        size="sm"
        className="sm:min-w-[92px]"
        disabled={disabled || pager.page >= totalPages}
        onClick={() => onSetPage(pager.page + 1)}
      >
        {t("pager.next")}
      </Button>
    </div>
  );
}
