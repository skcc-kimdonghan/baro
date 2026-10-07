import assert from "node:assert/strict";
import test from "node:test";

import {
  SHORTCUTS_DIALOG_CLASS,
  SHORTCUTS_NAV_CLASS,
  SHORTCUTS_ROW_CLASS,
  shortcutMoveControls,
} from "../lib/gpt-shortcuts-view.mjs";

test("the shortcut manager uses a genuinely wide desktop dialog without horizontal clipping", () => {
  assert.match(SHORTCUTS_DIALOG_CLASS, /max-w-\[calc\(100%-2rem\)\]/);
  assert.match(SHORTCUTS_DIALOG_CLASS, /sm:max-w-5xl/);
  assert.match(SHORTCUTS_DIALOG_CLASS, /grid-cols-\[minmax\(0,1fr\)\]/);
  assert.match(SHORTCUTS_DIALOG_CLASS, /overflow-x-hidden/);
  assert.doesNotMatch(SHORTCUTS_DIALOG_CLASS, /sm:max-w-(?:xl|2xl)(?:\s|$)/);
});

test("shortcut rows keep their text shrinkable and all action buttons inside the dialog", () => {
  assert.match(SHORTCUTS_ROW_CLASS, /min-w-0/);
  assert.match(SHORTCUTS_ROW_CLASS, /grid-cols-\[minmax\(0,1fr\)_auto\]/);
});

test("the shortcut bar exposes a visible horizontal scrollbar only inside its own row", () => {
  assert.match(SHORTCUTS_NAV_CLASS, /overflow-x-auto/);
  assert.match(SHORTCUTS_NAV_CLASS, /overscroll-x-contain/);
  assert.match(SHORTCUTS_NAV_CLASS, /scrollbar-width:thin/);
  assert.match(SHORTCUTS_NAV_CLASS, /webkit-scrollbar/);
});

test("shortcut move controls describe accessible first, middle, and last positions", () => {
  const first = shortcutMoveControls("첫 번째", 0, 3);
  const middle = shortcutMoveControls("두 번째", 1, 3);
  const last = shortcutMoveControls("세 번째", 2, 3);

  assert.deepEqual(first, {
    upLabel: "첫 번째 위로 이동",
    downLabel: "첫 번째 아래로 이동",
    canMoveUp: false,
    canMoveDown: true,
  });
  assert.deepEqual(middle, {
    upLabel: "두 번째 위로 이동",
    downLabel: "두 번째 아래로 이동",
    canMoveUp: true,
    canMoveDown: true,
  });
  assert.equal(last.canMoveUp, true);
  assert.equal(last.canMoveDown, false);
  assert.ok(Object.isFrozen(middle));
});
