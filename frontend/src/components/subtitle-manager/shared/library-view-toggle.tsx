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
    ariaLabel: string;
  }> = [
    {
      value: "list",
      icon: <List className="h-4 w-4" />,
      ariaLabel: t("common.switchToListView")
    },
    {
      value: "card",
      icon: <LayoutGrid className="h-4 w-4" />,
      ariaLabel: t("common.switchToCardView")
    }
  ];

  return (
    <div className="surface-subtle hidden items-center rounded-md p-1 md:inline-flex">
      {items.map((item) => {
        const active = item.value === value;
        return (
          <Button
            key={item.value}
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "h-10 w-10 border border-transparent touch-target sm:h-8 sm:w-8",
              active
                ? "border-input bg-surface-hover text-foreground hover:bg-surface-hover"
                : "text-foreground-muted hover:text-foreground"
            )}
            aria-pressed={active}
            aria-label={item.ariaLabel}
            title={item.ariaLabel}
            onClick={() => onChange(item.value)}
          >
            {item.icon}
          </Button>
        );
      })}
    </div>
  );
}
