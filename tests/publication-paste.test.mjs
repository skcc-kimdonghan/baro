import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_PUBLICATION_TEXT_LENGTH,
  applyPublicationTextEdit,
  createPublicationPasteState,
} from "../lib/publication-paste.mjs";

test("a full publication paste keeps plain text and clipboard HTML together", () => {
  const pasted = createPublicationPasteState({
    currentText: "기존 내용",
    selectionStart: 0,
    selectionEnd: 5,
    plainText: "발행 본문",
    htmlText: "<p><strong>발행 본문</strong></p>",
  });

  assert.equal(pasted.publishedText, "발행 본문");
  assert.equal(pasted.publishedHtml, "<p><strong>발행 본문</strong></p>");
  assert.equal(pasted.captureMode, "rich-html");
});

test("manual edits and partial pastes invalidate whole-document HTML", () => {
  const rich = createPublicationPasteState({
    currentText: "",
    selectionStart: 0,
    selectionEnd: 0,
    plainText: "발행 본문",
    htmlText: "<p>발행 본문</p>",
  });
  const edited = applyPublicationTextEdit(rich, "수정한 발행 본문");
  const partial = createPublicationPasteState({
    currentText: "앞 문장 뒤 문장",
    selectionStart: 5,
    selectionEnd: 5,
    plainText: "삽입",
    htmlText: "<strong>삽입</strong>",
  });

  assert.equal(edited.publishedHtml, "");
  assert.equal(edited.captureMode, "text-only");
  assert.equal(partial.publishedText, "앞 문장 삽입뒤 문장");
  assert.equal(partial.publishedHtml, "");
  assert.equal(partial.captureMode, "text-only");
});

test("plain clipboard data remains text-only", () => {
  const pasted = createPublicationPasteState({
    currentText: "",
    selectionStart: 0,
    selectionEnd: 0,
    plainText: "일반 텍스트",
    htmlText: "",
  });

  assert.equal(pasted.publishedText, "일반 텍스트");
  assert.equal(pasted.publishedHtml, "");
  assert.equal(pasted.captureMode, "text-only");
});

test("an oversized paste is rejected before replacing the current publication", () => {
  assert.throws(
    () => createPublicationPasteState({
      currentText: "보존할 기존 발행본",
      selectionStart: 0,
      selectionEnd: 0,
      plainText: "가".repeat(MAX_PUBLICATION_TEXT_LENGTH + 1),
      htmlText: "<p>너무 긴 본문</p>",
    }),
    (error) => error instanceof Error && error.code === "ACTUAL_ARTICLE_TOO_LONG",
  );
});
