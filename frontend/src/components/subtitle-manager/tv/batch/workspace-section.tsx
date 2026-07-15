import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface WorkspaceSectionProps {
  icon: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  aside?: ReactNode;
}

export function WorkspaceSection({ icon, title, description, children, className, aside }: WorkspaceSectionProps) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-foreground-muted">{icon}</span>
            <h3 className="text-sm font-semibold uppercase tracking-section text-foreground-muted">{title}</h3>
          </div>
          {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {aside ? <div className="flex shrink-0 flex-wrap items-center gap-2">{aside}</div> : null}
      </div>
      <div>{children}</div>
    </section>
  );
}
