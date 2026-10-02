import { MAX_COMPARISON_HTML_LENGTH } from "./html-format-comparison.mjs";

export const MAX_PUBLICATION_TEXT_LENGTH = 100_000;

function textLengthError() {
  const error = new Error(`실제 발행 글은 ${MAX_PUBLICATION_TEXT_LENGTH.toLocaleString("ko-KR")}자까지 비교할 수 있습니다.`);
  error.code = "ACTUAL_ARTICLE_TOO_LONG";
  return error;
}

function clampSelection(value, length, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(length, Math.trunc(value)));
}

export function createPublicationPasteState({
  currentText = "",
  selectionStart,
  selectionEnd,
  plainText = "",
  htmlText = "",
}) {
  const current = String(currentText);
  const start = clampSelection(selectionStart, current.length, current.length);
  const end = Math.max(start, clampSelection(selectionEnd, current.length, start));
  const insertedText = String(plainText);
  const nextLength = current.length - (end - start) + insertedText.length;
  if (nextLength > MAX_PUBLICATION_TEXT_LENGTH) throw textLengthError();
  const publishedText = `${current.slice(0, start)}${insertedText}${current.slice(end)}`;
  const richHtml = String(htmlText);
  const replacesEverything = start === 0 && end === current.length;
  const keepsRichHtml = replacesEverything && richHtml.trim() && richHtml.length <= MAX_COMPARISON_HTML_LENGTH;

  return Object.freeze({
    publishedText,
    publishedHtml: keepsRichHtml ? richHtml : "",
    captureMode: keepsRichHtml ? "rich-html" : "text-only",
  });
}

export function applyPublicationTextEdit(current, publishedText) {
  return Object.freeze({
    ...current,
    publishedText: String(publishedText),
    publishedHtml: "",
    captureMode: "text-only",
  });
}
