"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CircleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

type BubblePos = { top: number; left: number; width: number };

function measureBubbleSize(text: string): { width: number; height: number } {
  if (typeof document === "undefined") {
    return { width: Math.min(280, Math.max(48, text.length * 8 + 20)), height: 32 };
  }
  const el = document.createElement("div");
  el.style.cssText = [
    "position:fixed",
    "visibility:hidden",
    "pointer-events:none",
    "left:-9999px",
    "top:0",
    "z-index:-1",
    "box-sizing:border-box",
    "padding:8px 10px",
    "font-size:12px",
    "line-height:1.5",
    "font-weight:400",
    "max-width:min(20rem,calc(100vw - 1rem))",
    "white-space:normal"
  ].join(";");
  el.textContent = text;
  document.body.appendChild(el);
  const rect = el.getBoundingClientRect();
  document.body.removeChild(el);
  return {
    width: Math.max(48, Math.ceil(rect.width)),
    height: Math.max(28, Math.ceil(rect.height))
  };
}

function bubbleStyle(anchor: DOMRect, text: string): BubblePos {
  const gap = 8;
  const viewportPad = 8;
  const size = measureBubbleSize(text);
  const width = size.width;
  const height = size.height;
  const spaceBelow = window.innerHeight - anchor.bottom;
  const spaceAbove = anchor.top;
  const placeBelow =
    spaceBelow >= height + gap || spaceBelow >= spaceAbove;
  const top = placeBelow
    ? anchor.bottom + gap
    : Math.max(viewportPad, anchor.top - gap - height);
  let left = anchor.left + anchor.width / 2 - width / 2;
  if (width + viewportPad * 2 <= window.innerWidth) {
    left = Math.min(Math.max(viewportPad, left), window.innerWidth - width - viewportPad);
  } else {
    left = viewportPad;
  }
  return { top, left, width };
}

export type DialogHelpTipProps = {
  /** Help / explanatory copy shown in the bubble. */
  text: string;
  /** Accessible label for the trigger (defaults to text). */
  label?: string;
  className?: string;
  /** Optional multi-line content instead of plain text. */
  children?: ReactNode;
};

/**
 * Exclamation icon + popover bubble for functional help copy.
 * Prefer this over long DialogDescription paragraphs for non-critical explanations.
 */
export function DialogHelpTip({ text, label, className, children }: DialogHelpTipProps) {
  const tipId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<BubblePos | null>(null);
  const content = children ?? text;
  const measureText = text;

  function openBubble() {
    const anchor = buttonRef.current?.getBoundingClientRect();
    if (!anchor) {
      return;
    }
    setPos(bubbleStyle(anchor, measureText));
    setOpen(true);
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    function reposition() {
      const anchor = buttonRef.current?.getBoundingClientRect();
      if (!anchor) {
        return;
      }
      setPos(bubbleStyle(anchor, measureText));
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (buttonRef.current?.contains(target) || bubbleRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
      setPos(null);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setPos(null);
      }
    }

    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [measureText, open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={cn(
          "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          open && "bg-muted text-foreground",
          className
        )}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? tipId : undefined}
        aria-label={label ?? text}
        onClick={() => {
          if (open) {
            setOpen(false);
            setPos(null);
          } else {
            openBubble();
          }
        }}
      >
        <CircleAlert className="h-3.5 w-3.5" aria-hidden />
      </button>
      {typeof document !== "undefined" && open && pos
        ? createPortal(
            <div
              ref={bubbleRef}
              id={tipId}
              role="tooltip"
              className="fixed z-[200] max-w-[min(20rem,calc(100vw-1rem))] rounded-md border border-border bg-popover px-2.5 py-2 text-left text-xs font-normal leading-snug text-popover-foreground shadow-lg"
              style={{ top: pos.top, left: pos.left, width: pos.width }}
            >
              {typeof content === "string" ? <p className="whitespace-pre-wrap">{content}</p> : content}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
