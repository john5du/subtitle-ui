"use client";

import { X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function ClearableSearchInput({
  value,
  onChange,
  placeholder,
  "aria-label": ariaLabel,
  className
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  "aria-label"?: string;
  className?: string;
}) {
  const { t } = useI18n();

  return (
    <div className={cn("relative min-w-0 flex-1 xl:w-[260px] xl:flex-none", className)}>
      <Input
        size="sm"
        className="w-full pr-8"
        value={value}
        aria-label={ariaLabel}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {value ? (
        <button
          type="button"
          aria-label={t("common.clear")}
          title={t("common.clear")}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
          onClick={() => onChange("")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}
