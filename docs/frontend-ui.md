# Frontend UI conventions

Shared control density, library shells, drawers, and empty states. Dialog modal frames are covered in [`frontend-dialogs.md`](./frontend-dialogs.md).

## Control density

| Density | Height | Prefer | Use when |
|---------|--------|--------|----------|
| **default** | `h-10` | `Button` default / `size="icon"`; `Input` / `SelectTrigger` default | Primary form fields, login, dialog primary CTA row |
| **toolbar** | `h-9` | `Button size="icon-sm"`; `Input size="sm"`; `SelectTrigger size="sm"` | List toolbars, sidebar, filter bars, settings rows, dense headers |
| **row-action** | `h-10` → `sm:h-8` | `rowActionIconClassName` / `rowActionTextClassName` from `control-sizes.ts` (also `subtitleRowActionIconClassName` on track cards) | Subtitle track cards, touch-friendly row ops |
| **micro** | `h-7`–`h-8` | one-off with comment | Pager jump input, chips, tertiary ghost |

Do **not** sprinkle `className="h-9 w-9"` / `className="h-9"` when a size prop exists. Prefer `Button size="icon-sm"` / `Input size="sm"` / `SelectTrigger size="sm"` for toolbar density.

Tokens: `frontend/src/components/ui/control-sizes.ts`

```ts
rowActionIconClassName
rowActionTextClassName
settingsRowMinClassName  // min-h-[56px]
```

## Library list shell

Movie / TV series lists share chrome via:

| Piece | Path |
|-------|------|
| Shell | `shared/library-list-shell.tsx` |
| Debounced query | `shared/use-debounced-draft-query.ts` |
| Search input | `shared/clearable-search-input.tsx` |
| Card grid math | `shared/card-grid.ts` + `use-card-grid-columns.ts` |
| Poster card | `shared/library-poster-card.tsx` |
| Sort / view | `shared/library-sort-control.tsx`, `library-view-toggle.tsx` |
| Pager | `shared/pager-view.tsx` |

Feature panels (`movie-list-panel`, `tv-series-list-panel`) only supply columns, row/card renderers, and empty states.

## Drawers

`DialogDrawerContent` accepts `size`:

| Size | Desktop width | Use |
|------|---------------|-----|
| **md** | 680px / 760px xl | Movie subtitle manager |
| **lg** | 840px / 1040px xl | Default dense drawer |
| **xl** | 840px / 1240px xl | TV series workspace |

Pass `className="p-0"` when the drawer body owns padding. Do not override width with one-off `sm:w-[min(...)]` unless updating tokens in `dialog.tsx` and this table.

Close control is built into the drawer (top-right). See also `docs/frontend-dialogs.md` (Drawer section).

## Empty & settings rows

- **`EmptyPanel`** (`shared/empty-panel.tsx`) — centered muted empty state; `padded` adds `min-h-[var(--panel-min-h)]`.
- **`SettingsActionRow`** (`shared/settings-action-row.tsx`) — label + trailing controls; `bare` for rows inside a divided `surface-panel`.

## Checklist (new UI)

1. Toolbar controls: `icon-sm` / `size="sm"`, not raw `h-9`.
2. New library list: compose `LibraryListShell`, do not fork toolbar/pager.
3. Modal dialogs: `sm|md|lg` + `DialogTitleWithHelp` when help tip is needed (`frontend-dialogs.md`).
4. Side drawers: `DialogDrawerContent size="md|lg|xl"`.
5. Empty states: `EmptyPanel` when pattern matches.
6. Avoid inventing new max-width/height frames; extend tokens + docs.

## Related

- `docs/frontend-dialogs.md` — modal sizes, footer, help tips
- `frontend/src/components/ui/dialog.tsx` — size class maps
- `frontend/src/app/globals.css` — color / layout CSS variables
