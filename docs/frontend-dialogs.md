# Frontend dialog conventions

All modal dialogs use `DialogContent` / `AlertDialogContent` with a **size** prop (`sm` | `md` | `lg`). Do not invent one-off `max-w-*` / `h-*` frames on individual dialogs unless the size tokens truly cannot fit (then update the tokens here and in `frontend/src/components/ui/dialog.tsx`).

Side drawers (`DialogDrawerContent`) and bottom sheets (`DialogSheetContent`) are **out of scope** of the sm/md/lg frame; they keep their own layout.

## Size groups

| Size | Desktop frame (sm+) | Mobile | Use when |
|------|---------------------|--------|----------|
| **sm** | width `32rem` (max 94vw); height auto, max `90vh` | bottom sheet, max `92dvh` | Confirmations, simple forms (few fields) |
| **md** | width `42rem`, height `min(40rem, 90vh)` fixed | bottom sheet, max `92dvh` | Search results, archive entry pickers, moderate lists |
| **lg** | width `56rem`, height `min(52rem, 90vh)` fixed | bottom sheet, max `92dvh` | Dense tables, batch ops, preview, operation logs |

Tokens live in `dialogSizeClassName` (`frontend/src/components/ui/dialog.tsx`) and are shared by `AlertDialogContent`.

### Inventory

**sm — confirm / simple form**

- Delete subtitle (`AlertDialog`)
- Replace subtitle (`AlertDialog` + help tip for backup note)
- Clear logs confirm (`AlertDialog`)
- Sign out confirm (`AlertDialog`)
- Batch delete confirm (`AlertDialog`)
- Upload subtitle label form
- Convert to ASS
- Timing offset
- Source detail

**md — search / pick**

- SubHD download search
- Archive entry picker

**lg — dense workspace**

- Normalize subtitles
- TV batch delete
- TV season batch upload
- Subtitle preview
- Operation logs

## Layout structure

```tsx
<DialogContent size="md"> {/* or sm / lg */}
  <DialogHeader>
    <DialogTitle className="flex items-center gap-1.5">
      <span>{title}</span>
      {/* optional functional help — see below */}
      <DialogHelpTip text={help} />
    </DialogTitle>
    {/* Keep a11y description; hide visually when tip replaces body copy */}
    <DialogDescription className="sr-only">{help}</DialogDescription>
  </DialogHeader>

  <DialogBody>
    {/* scrollable / flex-1 content for md & lg */}
  </DialogBody>

  <DialogFooter>
    <Button variant="outline">Cancel / Close</Button>
    <Button>Primary</Button>
  </DialogFooter>
</DialogContent>
```

- **Header**: title only (plus optional help tip). No long paragraphs under the title for functional explanations.
- **Body** (`DialogBody`): required for **md/lg** so the frame scrolls inside a fixed height. Optional for short **sm** dialogs.
- **Footer** (`DialogFooter` / `AlertDialogFooter`): always at the bottom of the dialog frame.
  - Order: **Cancel/Close (outline) → primary action**
  - Mobile: stacked, primary on top (`flex-col-reverse`)
  - Desktop: right-aligned row
  - Shared chrome: top border + `pt-4`

## Functional help: exclamation + bubble

Use **`DialogHelpTip`** (`frontend/src/components/ui/dialog-help-tip.tsx`) for **explanatory / non-action-critical** copy:

- How a feature works (normalize rules, offset sign, backup behavior, …)
- Secondary context that would otherwise be a long `DialogDescription` paragraph

Do **not** use the tip for:

- The main confirmation sentence of a destructive action (keep as `AlertDialogDescription` body text)
- Live status, errors, or validation messages (inline in the body)

Pattern:

```tsx
<DialogTitle className="flex items-center gap-1.5">
  <span>{t("…title")}</span>
  <DialogHelpTip text={t("…helpOrDescription")} />
</DialogTitle>
<DialogDescription className="sr-only">{t("…helpOrDescription")}</DialogDescription>
```

Trigger is a `CircleAlert` icon button; content opens in a floating bubble (portal). Screen readers still get the text via `aria-label` and/or `sr-only` description.

## Checklist for new dialogs

1. Pick **sm / md / lg** from the table above; pass `size="…"`.
2. Use shared `DialogHeader` / `DialogBody` / `DialogFooter` (or Alert equivalents).
3. Footer buttons: cancel outline left of primary; no custom absolute-positioned action bars.
4. Move functional explanations into `DialogHelpTip`, not multi-line descriptions under the title.
5. Keep critical confirm copy visible in the body for Alert dialogs.
6. Avoid per-dialog width/height class overrides.

## Related files

- `frontend/src/components/ui/dialog.tsx` — size tokens, `DialogContent`, `DialogBody`, `DialogFooter`
- `frontend/src/components/ui/alert-dialog.tsx` — same sizes for confirms
- `frontend/src/components/ui/dialog-help-tip.tsx` — help bubble
- Feature dialogs under `frontend/src/components/subtitle-manager/**/**/*-dialog.tsx`
