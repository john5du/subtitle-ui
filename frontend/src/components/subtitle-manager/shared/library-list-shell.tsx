"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { PanelLeftClose, PanelLeftOpen, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Pager } from "@/lib/types";
import { cn } from "@/lib/utils";

import { ClearableSearchInput } from "./clearable-search-input";
import { InlinePending, PanelLoadingOverlay, SpinnerIcon } from "./pending-state";
import { PagerView } from "./pager-view";
import { useDebouncedDraftQuery } from "./use-debounced-draft-query";

export function LibraryListShell({
  query,
  onQueryChange,
  searchAriaLabel,
  searchPlaceholder,
  sortControl,
  viewToggle,
  onRefresh,
  refreshing,
  refreshDisabled,
  refreshLabel,
  sidebarCollapsed = false,
  sidebarToggleLabel,
  onToggleSidebar,
  pending,
  hasItems,
  updatingLabel,
  overlayLabel,
  pager,
  onSetPage,
  scrollSoft = false,
  children
}: {
  query: string;
  onQueryChange: (value: string) => void;
  searchAriaLabel: string;
  searchPlaceholder: string;
  sortControl: ReactNode;
  viewToggle: ReactNode;
  onRefresh: () => void | Promise<void>;
  refreshing: boolean;
  refreshDisabled: boolean;
  refreshLabel: string;
  sidebarCollapsed?: boolean;
  sidebarToggleLabel?: string;
  onToggleSidebar?: () => void;
  pending: boolean;
  hasItems: boolean;
  updatingLabel: string;
  /** Defaults to updatingLabel. */
  overlayLabel?: string;
  pager: Pager;
  onSetPage: (page: number) => void;
  /** Soft pulse while pending with items (list mode). */
  scrollSoft?: boolean;
  children: ReactNode;
}) {
  const [draftQuery, setDraftQuery] = useDebouncedDraftQuery(query, onQueryChange);
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const showPager = Math.max(1, pager.totalPages) > 1 || pager.total > 0;

  useEffect(() => {
    scrollViewportRef.current?.scrollTo({ top: 0, left: 0 });
  }, [pager.page]);

  return (
    <Card className="surface-panel animate-fade-in-up flex h-full flex-col">
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="hidden items-center gap-2 lg:flex">
            {onToggleSidebar && sidebarToggleLabel ? (
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={onToggleSidebar}
                aria-label={sidebarToggleLabel}
                title={sidebarToggleLabel}
              >
                {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => void onRefresh()}
              disabled={refreshDisabled}
              aria-label={refreshLabel}
              title={refreshLabel}
            >
              {refreshing ? <SpinnerIcon className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
          <div className="flex w-full min-w-0 items-center gap-2 sm:justify-end xl:w-auto">
            <ClearableSearchInput
              value={draftQuery}
              onChange={setDraftQuery}
              aria-label={searchAriaLabel}
              placeholder={searchPlaceholder}
            />
            <div className="flex shrink-0 items-center gap-2">
              {sortControl}
              {viewToggle}
            </div>
          </div>
        </div>
        {pending && hasItems ? <InlinePending label={updatingLabel} /> : null}
      </CardHeader>

      <CardContent className="relative flex min-h-0 flex-1 flex-col p-0">
        <ScrollArea
          viewportRef={scrollViewportRef}
          className={cn("min-h-0 flex-1", scrollSoft && "surface-subtle", pending && hasItems && "animate-pulse-soft")}
        >
          <div className={cn(showPager && "pb-20")}>{children}</div>
        </ScrollArea>
        {pending && hasItems ? <PanelLoadingOverlay label={overlayLabel ?? updatingLabel} /> : null}
        <PagerView pager={pager} onSetPage={onSetPage} disabled={pending} />
      </CardContent>
    </Card>
  );
}
