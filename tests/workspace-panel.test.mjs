import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPACT_WORKSPACE_HEIGHT_CLASS,
  RESULT_LIST_CLASS,
  RESULT_WORKSPACE_CLASS,
  inputPanelView,
} from "../lib/workspace-panel.mjs";

test("the compact input panel matches the desktop result workspace height", () => {
  const view = inputPanelView(false);

  assert.equal(view.expanded, false);
  assert.equal(view.toggleLabel, "입력창 펼치기");
  assert.match(view.panelClass, new RegExp(COMPACT_WORKSPACE_HEIGHT_CLASS.replaceAll("[", "\\[").replaceAll("]", "\\]")));
  assert.match(RESULT_WORKSPACE_CLASS, new RegExp(COMPACT_WORKSPACE_HEIGHT_CLASS.replaceAll("[", "\\[").replaceAll("]", "\\]")));
  assert.match(view.textareaClass, /resize-none/);
  assert.equal(RESULT_LIST_CLASS.split(" ").includes("overflow-y-auto"), false);
  assert.equal(RESULT_LIST_CLASS.split(" ").includes("xl:overflow-y-auto"), true);
  assert.equal(RESULT_LIST_CLASS.split(" ").some((className) => className.startsWith("max-h-")), false);
  assert.ok(Object.isFrozen(view));
});

test("the expanded input panel reveals more editing space and can be collapsed", () => {
  const view = inputPanelView(true);

  assert.equal(view.expanded, true);
  assert.equal(view.toggleLabel, "입력창 접기");
  assert.doesNotMatch(view.panelClass, /xl:h-\[760px\]/);
  assert.match(view.panelClass, /xl:min-h-\[760px\]/);
  assert.match(view.textareaClass, /min-h-\[70vh\]/);
  assert.match(view.textareaClass, /resize-y/);
});
