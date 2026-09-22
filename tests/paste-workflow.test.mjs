import test from "node:test";
import assert from "node:assert/strict";

import { composePastedValue, shouldAutoFormatPaste } from "../lib/paste-workflow.mjs";

test("pasted article bundles replace the current selection without losing surrounding text", () => {
  const result = composePastedValue({
    currentValue: "앞부분 삭제할부분 뒷부분",
    pastedText: "1편: 첫 글\n본문\n\n2편: 둘째 글\n본문",
    selectionStart: 4,
    selectionEnd: 9,
  });

  assert.equal(result, "앞부분 1편: 첫 글\n본문\n\n2편: 둘째 글\n본문 뒷부분");
});

test("paste composition clamps invalid selection positions safely", () => {
  assert.equal(
    composePastedValue({
      currentValue: "기존",
      pastedText: "새 글",
      selectionStart: -100,
      selectionEnd: 999,
    }),
    "새 글",
  );
});

test("empty input and full replacement pastes trigger automatic formatting", () => {
  assert.equal(shouldAutoFormatPaste({
    currentValue: "",
    pastedText: "1편: 새 글\n본문",
    selectionStart: 0,
    selectionEnd: 0,
  }), true);
  assert.equal(shouldAutoFormatPaste({
    currentValue: "기존 원고",
    pastedText: "교체할 전문",
    selectionStart: 0,
    selectionEnd: 5,
  }), true);
});

test("partial editing pastes stay in the textarea without automatic formatting", () => {
  assert.equal(shouldAutoFormatPaste({
    currentValue: "기존 원고의 문장을 수정합니다.",
    pastedText: "새 문장",
    selectionStart: 3,
    selectionEnd: 6,
  }), false);
  assert.equal(shouldAutoFormatPaste({
    currentValue: "기존 원고",
    pastedText: "   ",
    selectionStart: 0,
    selectionEnd: 5,
  }), false);
});
