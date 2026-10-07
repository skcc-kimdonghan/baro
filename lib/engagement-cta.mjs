const INFORMATION_CLOSING = Object.freeze({
  question: "가장 헷갈렸던 조건이나 더 궁금한 내용이 더 있으신가요?",
  comment: "댓글로 남겨주시면 다음 글에서 쉽게 정리해 보겠습니다.",
  empathy: "마지막으로 글이 도움이 되셨다면 공감으로 알려주시면 감사하겠습니다.^^",
});

const ADVERTISEMENT_CLOSING = Object.freeze({
  priority: "준비물은 많이 챙기는 것보다 내 일정에 필요한 것만 고르는 게 더 중요합니다.",
  experience: "직접 써보니 유용했던 물건이나 굳이 필요 없었던 준비물이 있다면 댓글로 알려주세요.",
  followup: "다른 분들이 준비할 때 참고할 수 있도록 다음 글에서도 함께 정리해 보겠습니다.",
  empathy: "글이 도움이 되셨다면 공감으로 알려주시면 감사하겠습니다.^^",
});

const LEGACY_CLOSING_LINES = Object.freeze([
  "가장 헷갈렸던 조건이나 더 궁금한 내용은 무엇인가요?",
  "헷갈렸던 조건이나 더 궁금한 내용이 더 있으신가요?",
  "글이 도움이 되셨다면 공감으로 알려주시면 감사하겠습니다.",
]);

export function isFixedEngagementLine(value) {
  const trimmed = String(value ?? "").trim();
  const normalized = trimmed
    .replace(/\*\*|__/g, "")
    .replace(/(?:\\|<br\s*\/?\s*>)\s*$/i, "")
    .trim();
  return Object.values(INFORMATION_CLOSING).includes(normalized)
    || Object.values(ADVERTISEMENT_CLOSING).includes(normalized)
    || LEGACY_CLOSING_LINES.includes(normalized);
}

export function createEngagementClosing(articleType = "information") {
  if (articleType === "advertisement") {
    return Object.freeze({
      topic: "advertisement",
      paragraphs: Object.freeze([
        ADVERTISEMENT_CLOSING.priority,
        ADVERTISEMENT_CLOSING.experience,
        ADVERTISEMENT_CLOSING.followup,
        ADVERTISEMENT_CLOSING.empathy,
      ]),
      addedParts: Object.freeze(["advertisement-priority", "advertisement-experience", "advertisement-followup", "advertisement-empathy"]),
    });
  }
  return Object.freeze({
    topic: "universal",
    paragraphs: Object.freeze([
      INFORMATION_CLOSING.question,
      INFORMATION_CLOSING.comment,
      INFORMATION_CLOSING.empathy,
    ]),
    addedParts: Object.freeze(["question", "comment", "empathy"]),
  });
}
