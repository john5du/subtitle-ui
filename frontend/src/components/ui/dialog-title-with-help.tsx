"use client";

import type { ReactNode } from "react";

import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DialogHelpTip } from "@/components/ui/dialog-help-tip";
import { cn } from "@/lib/utils";

type DialogTitleWithHelpProps = {
  title: ReactNode;
  help: string;
  /** Optional aria-label for the help tip trigger. Defaults to help. */
  helpLabel?: string;
  /**
   * Screen-reader description. Defaults to `help`.
   * Pass a different string when the tip is secondary context and the description is primary.
   */
  description?: string;
  className?: string;
  /** When false, skip sr-only DialogDescription (e.g. visible body copy already present). */
  srDescription?: boolean;
};

/** Title + DialogHelpTip + optional sr-only description (dialog convention). */
export function DialogTitleWithHelp({
  title,
  help,
  helpLabel,
  description,
  className,
  srDescription = true
}: DialogTitleWithHelpProps) {
  const a11yText = description ?? help;
  return (
    <>
      <DialogTitle className={cn("flex items-center gap-1.5", className)}>
        <span>{title}</span>
        <DialogHelpTip text={help} label={helpLabel ?? help} />
      </DialogTitle>
      {srDescription ? <DialogDescription className="sr-only">{a11yText}</DialogDescription> : null}
    </>
  );
}
