"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink, MoreHorizontal } from "lucide-react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

import type { RowActionItem } from "../types";

export function RowActionsMenu({
  label,
  items,
  triggerIcon,
  triggerClassName,
  menuDirection = "down",
  disabled = false
}: {
  label: string;
  items: RowActionItem[];
  triggerIcon?: ReactNode;
  triggerClassName?: string;
  menuDirection?: "up" | "down";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [withinDialog, setWithinDialog] = useState(false);
  const [resolvedDirection, setResolvedDirection] = useState<"up" | "down">(menuDirection);
  const [menuMaxHeight, setMenuMaxHeight] = useState(240);
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    width: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!containerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (disabled && open) {
      setOpen(false);
    }
  }, [disabled, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function updateMenuPlacement() {
      const triggerRect = triggerRef.current?.getBoundingClientRect();
      if (!triggerRect) {
        return;
      }
      const isWithinDialog = Boolean(
        containerRef.current?.closest("[data-dialog-content='true'],[data-alert-dialog-content='true']")
      );
      setWithinDialog(isWithinDialog);

      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const margin = 12;
      const gap = 6;
      const minPreferredHeight = 150;
      const spaceAbove = Math.max(0, triggerRect.top - margin);
      const spaceBelow = Math.max(0, viewportHeight - triggerRect.bottom - margin);

      let nextDirection = menuDirection;
      if (nextDirection === "up" && spaceAbove < minPreferredHeight && spaceBelow > spaceAbove) {
        nextDirection = "down";
      }
      if (nextDirection === "down" && spaceBelow < minPreferredHeight && spaceAbove > spaceBelow) {
        nextDirection = "up";
      }

      const targetSpace = nextDirection === "up" ? spaceAbove : spaceBelow;
      const menuWidth = Math.min(
        Math.max(210, triggerRect.width, menuRef.current?.offsetWidth ?? 0),
        Math.max(210, viewportWidth - margin * 2)
      );
      const left = Math.min(
        Math.max(triggerRect.right - menuWidth, margin),
        viewportWidth - menuWidth - margin
      );
      const maxHeight = Math.max(120, Math.floor(targetSpace - gap));
      const top = nextDirection === "down" ? Math.max(margin, triggerRect.bottom + gap) : undefined;
      const bottom = nextDirection === "up" ? Math.max(margin, viewportHeight - triggerRect.top + gap) : undefined;

      setResolvedDirection(nextDirection);
      setMenuMaxHeight(maxHeight);
      setMenuPosition({
        left,
        top,
        bottom,
        width: menuWidth
      });
    }

    updateMenuPlacement();
    const raf = window.requestAnimationFrame(updateMenuPlacement);
    window.addEventListener("resize", updateMenuPlacement);
    window.addEventListener("scroll", updateMenuPlacement, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", updateMenuPlacement);
      window.removeEventListener("scroll", updateMenuPlacement, true);
    };
  }, [open, menuDirection, items.length]);

  const menuItems = items.map((item, index) => {
    const showDivider = item.external && index > 0 && !items[index - 1]?.external;
    if (item.href && !item.disabled) {
      return (
        <a
          key={item.label}
          href={item.href}
          target={item.external ? "_blank" : undefined}
          rel={item.external ? "noreferrer" : undefined}
          className={cn(
            "surface-transition flex w-full items-center justify-between px-3 py-2.5 text-[13px] font-medium text-popover-foreground hover:bg-[rgba(255,255,255,0.08)] hover:text-white",
            showDivider && "mt-1 border-t border-border pt-3"
          )}
          onClick={() => setOpen(false)}
        >
          <span>{item.label}</span>
          {item.external && <ExternalLink className="h-4 w-4 text-popover-foreground/70" />}
        </a>
      );
    }

    return (
      <button
        key={item.label}
        type="button"
        role="menuitem"
        disabled={item.disabled}
        className={cn(
          "surface-transition flex w-full items-center justify-between px-3 py-2.5 text-left text-[13px] font-medium text-popover-foreground hover:bg-[rgba(255,255,255,0.08)] hover:text-white disabled:cursor-not-allowed disabled:text-[rgba(255,255,255,0.3)] disabled:opacity-60",
          showDivider && "mt-1 border-t border-border/80 pt-3"
        )}
        onClick={() => {
          if (item.disabled) {
            return;
          }
          setOpen(false);
          item.onSelect?.();
        }}
      >
        <span>{item.label}</span>
      </button>
    );
  });

  const inlineMenu = open && withinDialog ? (
    <div
      ref={menuRef}
      role="menu"
      style={{ maxHeight: `${menuMaxHeight}px` }}
      className={cn(
        "animate-fade-in-fast absolute right-0 z-[90] min-w-[210px] overflow-y-auto overscroll-contain border border-border bg-popover p-1.5 text-popover-foreground",
        resolvedDirection === "up" ? "bottom-full mb-1" : "top-full mt-1"
      )}
    >
      {menuItems}
    </div>
  ) : null;

  const portalMenu = open && !withinDialog && menuPosition ? (
    <div
      ref={menuRef}
      role="menu"
      style={{
        left: `${menuPosition.left}px`,
        width: `${menuPosition.width}px`,
        maxHeight: `${menuMaxHeight}px`,
        top: menuPosition.top !== undefined ? `${menuPosition.top}px` : undefined,
        bottom: menuPosition.bottom !== undefined ? `${menuPosition.bottom}px` : undefined
      }}
      className={cn(
        "animate-fade-in-fast fixed z-[130] min-w-[210px] overflow-y-auto overscroll-contain border border-border bg-popover p-1.5 text-popover-foreground",
        resolvedDirection === "up" ? "origin-bottom-right" : "origin-top-right"
      )}
    >
      {menuItems}
    </div>
  ) : null;

  return (
    <div
      ref={containerRef}
      className="relative flex justify-end"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <Button
        type="button"
        variant="outline"
        size="icon"
        ref={triggerRef}
        className={cn("h-9 w-9", triggerClassName)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
      >
        {triggerIcon ?? <MoreHorizontal className="h-4 w-4" />}
      </Button>
      {inlineMenu}
      {mounted && portalMenu ? createPortal(portalMenu, document.body) : null}
    </div>
  );
}
