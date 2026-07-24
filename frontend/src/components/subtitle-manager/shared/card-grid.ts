const CARD_GRID_MIN_WIDTH = 176;
const CARD_GRID_GAP = 12;
export const CARD_GRID_CLASS = "grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-3";
const CARD_PAGE_SIZE_TARGET = 30;
const CARD_PAGE_SIZE_MAX = 200;

export function cardGridColumnsFromWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) {
    return 1;
  }
  return Math.max(1, Math.floor((width + CARD_GRID_GAP) / (CARD_GRID_MIN_WIDTH + CARD_GRID_GAP)));
}

export function cardGridPageSize(
  columns: number,
  target = CARD_PAGE_SIZE_TARGET,
  max = CARD_PAGE_SIZE_MAX
): number {
  const cols = Math.max(1, Math.floor(columns));
  let size = Math.max(cols, Math.round(target / cols) * cols);
  if (size > max) {
    size = Math.floor(max / cols) * cols;
  }
  return Math.max(cols, size);
}
