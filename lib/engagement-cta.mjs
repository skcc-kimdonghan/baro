const FIXED_CLOSING = Object.freeze({
  question: "가장 헷갈렸던 조건이나 더 궁금한 내용이 더 있으신가요?",
  comment: "댓글로 남겨주시면 다음 글에서 쉽게 정리해 보겠습니다.",
  empathy: "마지막으로 글이 도움이 되셨다면 공감으로 알려주시면 감사하겠습니다.^^",
});

const LEGACY_CLOSING_LINES = Object.freeze([
  "가장 헷갈렸던 조건이나 더 궁금한 내용은 무엇인가요?",
  "글이 도움이 되셨다면 공감으로 알려주시면 감사하겠습니다.",
]);

export function isFixedEngagementLine(value) {
  const trimmed = String(value ?? "").trim();
  const wrapperMatch = /^(\*\*|__)(.+)\1$/.exec(trimmed);
  const unwrapped = wrapperMatch?.[2]?.trim() ?? trimmed;
  return Object.values(FIXED_CLOSING).includes(unwrapped) || LEGACY_CLOSING_LINES.includes(unwrapped);
}

export function createEngagementClosing() {
  return Object.freeze({
    topic: "universal",
    paragraphs: Object.freeze([
      FIXED_CLOSING.question,
      FIXED_CLOSING.comment,
      FIXED_CLOSING.empathy,
    ]),
    addedParts: Object.freeze(["question", "comment", "empathy"]),
  });
}
