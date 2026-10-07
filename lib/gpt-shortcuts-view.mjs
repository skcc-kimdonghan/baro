export const SHORTCUTS_DIALOG_CLASS = "max-h-[min(720px,calc(100vh-2rem))] max-w-[calc(100%-2rem)] min-w-0 grid-cols-[minmax(0,1fr)] overflow-x-hidden overflow-y-auto sm:max-w-5xl";

export const SHORTCUTS_NAV_CLASS = "min-w-0 flex-1 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-[#e7efeb] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#afc5ba]";

export const SHORTCUTS_ROW_CLASS = "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-[var(--line)] p-3";

export function shortcutMoveControls(name, index, total) {
  const safeName = typeof name === "string" && name.trim() ? name.trim() : "바로가기";
  const safeIndex = Number.isInteger(index) ? index : -1;
  const safeTotal = Number.isInteger(total) && total > 0 ? total : 0;
  return Object.freeze({
    upLabel: `${safeName} 위로 이동`,
    downLabel: `${safeName} 아래로 이동`,
    canMoveUp: safeIndex > 0 && safeIndex < safeTotal,
    canMoveDown: safeIndex >= 0 && safeIndex < safeTotal - 1,
  });
}
