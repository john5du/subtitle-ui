# Frontend dialog conventions

All modal dialogs use `DialogContent` / `AlertDialogContent` with a **size** prop (`sm` | `md` | `lg` | `xl`). Do not invent one-off `max-w-*` / `h-*` frames on individual dialogs unless the size tokens truly cannot fit (then update the tokens here and in `frontend/src/components/ui/dialog.tsx`).

Side drawers use `DialogDrawerContent` with its own size scale (`md` | `lg` | `xl`) — see [Drawers](#drawers) below. Bottom sheets (`DialogSheetContent`) stay layout-specific.

Broader UI density / list shells: [`frontend-ui.md`](./frontend-ui.md).

## Size groups (modals)

| Size | Desktop frame (sm+) | Mobile | Use when |
|------|---------------------|--------|----------|
| **sm** | width `32rem` (max 94vw); height auto, max `90vh` | bottom sheet, max `92dvh` | Confirmations, simple forms (few fields) |
| **md** | width `42rem`, height `min(40rem, 90vh)` fixed | bottom sheet, max `92dvh` | Search results, archive entry pickers, moderate lists |
| **lg** | width `56rem`, height `min(52rem, 90vh)` fixed | bottom sheet, max `92dvh` | Dense tables, batch ops, text preview, operation logs |
| **xl** | width `72rem` (max 96vw); height `min(90vh, 56rem)` fixed | bottom sheet, max `92dvh` | Video playback + subtitle preview (ArtPlayer) |

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
- Subtitle text preview
- Operation logs (`DialogHeader` + `DialogBody`; header may include actions)

**xl — media preview**

- Video + subtitle playback preview (ArtPlayer)

## Drawers

`DialogDrawerContent` size prop (`DialogDrawerSize`):

| Size | Desktop width | Inventory |
|------|---------------|-----------|
| **md** | `680px` / `760px` (xl) | Movie subtitle manager |
| **lg** | `840px` / `1040px` (xl) | Default (if used without override) |
| **xl** | `840px` / `1240px` (xl) | TV series workspace |

Tokens: `dialogDrawerSizeClassName` in `dialog.tsx`. Prefer `size="…"` + optional `className="p-0"`; do not re-declare width classes in feature code.

## Layout structure

```tsx
<DialogContent size="md"> {/* or sm / lg */}
  <DialogHeader>
    <DialogTitleWithHelp title={title} help={help} />
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

Prefer **`DialogTitleWithHelp`** (`frontend/src/components/ui/dialog-title-with-help.tsx`) for the standard title + tip + sr-only description.

Low-level **`DialogHelpTip`** (`dialog-help-tip.tsx`) for custom headers (e.g. `AlertDialogTitle` with a tip next to destructive confirm copy).

Use help tips for **explanatory / non-action-critical** copy:

- How a feature works (normalize rules, offset sign, backup behavior, …)
- Secondary context that would otherwise be a long `DialogDescription` paragraph

Do **not** use the tip for:

- The main confirmation sentence of a destructive action (keep as `AlertDialogDescription` body text)
- Live status, errors, or validation messages (inline in the body)

```tsx
// Preferred
<DialogTitleWithHelp title={t("…title")} help={t("…helpOrDescription")} />

// When sr-only description differs from tip text:
<DialogTitleWithHelp title={…} help={tipText} description={contextText} />

// AlertDialog (manual — TitleWithHelp uses Dialog primitives)
<AlertDialogTitle className="flex items-center gap-1.5">
  <span>{t("…title")}</span>
  <DialogHelpTip text={backupNote} />
</AlertDialogTitle>
```

Trigger is a `CircleAlert` icon button; content opens in a floating bubble (portal). Screen readers still get the text via `aria-label` and/or `sr-only` description.

## Checklist for new dialogs

1. Pick **sm / md / lg** (modals) or **md / lg / xl** (drawers); pass `size="…"`.
2. Use shared `DialogHeader` / `DialogBody` / `DialogFooter` (or Alert equivalents).
3. Footer buttons: cancel outline left of primary; no custom absolute-positioned action bars.
4. Prefer `DialogTitleWithHelp` for functional help; keep critical confirm copy visible in Alert body.
5. Avoid per-dialog width/height class overrides.

## Related files

- `frontend/src/components/ui/dialog.tsx` — size tokens, `DialogContent`, `DialogDrawerContent`, `DialogBody`, `DialogFooter`
- `frontend/src/components/ui/alert-dialog.tsx` — same modal sizes for confirms
- `frontend/src/components/ui/dialog-help-tip.tsx` — help bubble
- `frontend/src/components/ui/dialog-title-with-help.tsx` — title + tip + sr-only description
- `docs/frontend-ui.md` — control density, library shell, empty states
- Feature dialogs under `frontend/src/components/subtitle-manager/**/**/*-dialog.tsx`
