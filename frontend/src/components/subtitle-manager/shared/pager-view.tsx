import { useI18n } from "@/lib/i18n";
import type { Pager } from "@/lib/types";
import { Button } from "@/components/ui/button";

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

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Button type="button" variant="outline" size="sm" disabled={disabled || pager.page <= 1} onClick={() => onSetPage(pager.page - 1)}>
        {t("pager.prev")}
      </Button>
      <span className="text-xs text-muted-foreground">
        {t("pager.summary", { page: pager.page, totalPages, total: pager.total })}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || pager.page >= totalPages}
        onClick={() => onSetPage(pager.page + 1)}
      >
        {t("pager.next")}
      </Button>
    </div>
  );
}
