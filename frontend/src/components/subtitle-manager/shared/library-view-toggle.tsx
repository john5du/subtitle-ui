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
    <div className="surface-subtle hidden h-9 items-center rounded-md p-0.5 md:inline-flex">
      {items.map((item) => {
        const active = item.value === value;
        return (
          <Button
            key={item.value}
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "h-8 w-8 border border-transparent",
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
