import type { ReactNode } from "react";
import { LayoutGrid, List } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

import type { LibraryViewMode } from "../types";

export function LibraryViewToggle({
  value,
  onChange
}: {
  value: LibraryViewMode;
  onChange: (value: LibraryViewMode) => void;
}) {
  const { t } = useI18n();
  const items: Array<{
    value: LibraryViewMode;
    icon: ReactNode;
    label: string;
    ariaLabel: string;
  }> = [
    {
      value: "list",
      icon: <List className="h-4 w-4" />,
      label: t("common.listView"),
      ariaLabel: t("common.switchToListView")
    },
    {
      value: "card",
      icon: <LayoutGrid className="h-4 w-4" />,
      label: t("common.cardView"),
      ariaLabel: t("common.switchToCardView")
    }
  ];

  return (
    <div className="surface-subtle inline-flex w-full items-center p-1 sm:w-auto">
      {items.map((item) => {
        const active = item.value === value;
        return (
          <Button
            key={item.value}
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 flex-1 gap-2 px-3 text-xs font-medium sm:flex-none",
              active
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "text-foreground-muted hover:text-white"
            )}
            aria-pressed={active}
            aria-label={item.ariaLabel}
            title={item.ariaLabel}
            onClick={() => onChange(item.value)}
          >
            {item.icon}
            <span className="hidden sm:inline">{item.label}</span>
          </Button>
        );
      })}
    </div>
  );
}
