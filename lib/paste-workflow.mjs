function clampPosition(value, position) {
  if (!Number.isFinite(position)) return value.length;
  return Math.min(value.length, Math.max(0, Math.trunc(position)));
}

export function composePastedValue({ currentValue, pastedText, selectionStart, selectionEnd }) {
  const current = String(currentValue ?? "");
  const pasted = String(pastedText ?? "");
  const start = clampPosition(current, selectionStart);
  const end = clampPosition(current, selectionEnd);
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  return `${current.slice(0, from)}${pasted}${current.slice(to)}`;
}

export function shouldAutoFormatPaste({ currentValue, pastedText, selectionStart, selectionEnd }) {
  const current = String(currentValue ?? "");
  const pasted = String(pastedText ?? "");
  if (!pasted.trim()) return false;
  if (!current.trim()) return true;

  const start = clampPosition(current, selectionStart);
  const end = clampPosition(current, selectionEnd);
  return Math.min(start, end) === 0 && Math.max(start, end) === current.length;
}
