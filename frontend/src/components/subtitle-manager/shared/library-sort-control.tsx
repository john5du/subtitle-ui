"use client";

import { memo } from "react";

import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface LibrarySortOption<T extends string> {
  value: T;
  labelKey: MessageKey;
}

interface LibrarySortControlProps<T extends string> {
  value: T;
  order: "asc" | "desc";
  options: LibrarySortOption<T>[];
  onValueChange: (value: T) => void;
  onToggleOrder: () => void;
}

function LibrarySortControlInner<T extends string>({
  value,
  order,
  options,
  onValueChange,
  onToggleOrder
}: LibrarySortControlProps<T>) {
  const { t } = useI18n();
  const orderLabel = order === "desc" ? t("common.sortDescending") : t("common.sortAscending");
  const selected = options.find((option) => option.value === value);
  const fieldLabel = selected ? t(selected.labelKey) : t("common.sortBy");

  return (
    <div className="flex items-center gap-1.5">
      <Select value={value} onValueChange={(next) => onValueChange(next as T)}>
        <SelectTrigger className="h-9 w-[132px] shrink-0 px-2.5 text-sm" aria-label={t("common.sortBy")}>
          <SelectValue placeholder={t("common.sortBy")}>{fieldLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {t(option.labelKey)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9 w-9 shrink-0 px-0"
        aria-label={`${fieldLabel} · ${orderLabel}`}
        title={orderLabel}
        onClick={onToggleOrder}
      >
        <span className="text-sm" aria-hidden>
          {order === "desc" ? "↓" : "↑"}
        </span>
      </Button>
    </div>
  );
}

export const LibrarySortControl = memo(LibrarySortControlInner) as typeof LibrarySortControlInner;
