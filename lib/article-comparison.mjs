import { compareArticleFormatting, stripOptionalTitleHtml } from "./html-format-comparison.mjs";

export { compareArticleFormatting } from "./html-format-comparison.mjs";

export const MAX_COMPARISON_LENGTH = 100_000;
export const MAX_DIFFERENCE_SAMPLES = 3;

const RIDE_FOOTER_LABEL = "에버랜드 우리아이 놀이기구 찾기↓↓ 아래 링크 클릭";
const RIDE_FOOTER_URL = "https://onecalc.kr/calc/everland-ride-passport/";
const SAMPLE_CHARACTER_LIMIT = 140;

function validationError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeRawText(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/^\uFEFF/, "")
    .trim();
}

function normalizeLine(value) {
  return value.trim().replace(/[ \t]+/g, " ");
}

function compactWhitespace(value) {
  return normalizeRawText(value).replace(/\s+/g, " ").trim();
}

function withoutWhitespace(value) {
  return normalizeRawText(value).replace(/\s+/g, "");
}

function stripOptionalTitle(value, title) {
  const normalized = normalizeRawText(value);
  if (!title?.trim()) return normalized;

  const lines = normalized.split("\n");
  const firstContentIndex = lines.findIndex((line) => normalizeLine(line));
  if (firstContentIndex < 0) return normalized;
  if (compactWhitespace(lines[firstContentIndex]) !== compactWhitespace(title)) return normalized;

  let bodyStart = firstContentIndex + 1;
  while (bodyStart < lines.length && !normalizeLine(lines[bodyStart])) bodyStart += 1;
  return normalizeRawText(lines.slice(bodyStart).join("\n"));
}

function contentLines(value) {
  return normalizeRawText(value)
    .split("\n")
    .map(normalizeLine)
    .filter(Boolean);
}

function paragraphCount(value) {
  const normalized = normalizeRawText(value);
  if (!normalized) return 0;
  return normalized.split(/\n\s*\n+/).filter((paragraph) => compactWhitespace(paragraph)).length;
}

function frequencies(values) {
  return values.reduce((result, value) => {
    result.set(value, (result.get(value) ?? 0) + 1);
    return result;
  }, new Map());
}

function multisetDifference(source, comparison) {
  const remaining = frequencies(comparison);
  return source.filter((value) => {
    const count = remaining.get(value) ?? 0;
    if (count < 1) return true;
    remaining.set(value, count - 1);
    return false;
  });
}

function boundedSamples(values) {
  return values.slice(0, MAX_DIFFERENCE_SAMPLES).map((value) =>
    value.length > SAMPLE_CHARACTER_LIMIT
      ? `${value.slice(0, SAMPLE_CHARACTER_LIMIT - 1)}…`
      : value,
  );
}

function similarityScore(expected, actual) {
  const expectedTokens = compactWhitespace(expected).match(/[\p{L}\p{N}]+|[^\s]/gu) ?? [];
  const actualTokens = compactWhitespace(actual).match(/[\p{L}\p{N}]+|[^\s]/gu) ?? [];
  if (expectedTokens.length === 0 && actualTokens.length === 0) return 100;

  const remaining = frequencies(actualTokens);
  const common = expectedTokens.reduce((count, token) => {
    const available = remaining.get(token) ?? 0;
    if (available < 1) return count;
    remaining.set(token, available - 1);
    return count + 1;
  }, 0);
  return Math.round((2 * common * 100) / (expectedTokens.length + actualTokens.length));
}

function issue(type, title, detail, samples = []) {
  return Object.freeze({ type, title, detail, samples: Object.freeze(boundedSamples(samples)) });
}

function formattingDifferenceIssue(formatting) {
  if (!formatting || formatting.status !== "different") return null;
  const mismatches = formatting.checks.filter((check) => !check.matched);
  return issue(
    "formatting",
    `글자 크기·서식 ${mismatches.length}개가 달라요`,
    "네이버 발행본의 서식 정보를 제공 원고와 비교했습니다. 아래 항목을 확인해 주세요.",
    mismatches.map((check) => `${check.label}: 예상 ${check.expected} / 실제 ${check.actual}`),
  );
}

export function comparePublishedArticle(expectedText, actualText, options = {}) {
  const rawExpected = String(expectedText ?? "");
  const rawActual = String(actualText ?? "");
  if (rawExpected.length > MAX_COMPARISON_LENGTH) {
    throw validationError(
      `제공 원고는 ${MAX_COMPARISON_LENGTH.toLocaleString("ko-KR")}자까지 비교할 수 있습니다.`,
      "EXPECTED_ARTICLE_TOO_LONG",
    );
  }
  if (rawActual.length > MAX_COMPARISON_LENGTH) {
    throw validationError(
      `실제 발행 글은 ${MAX_COMPARISON_LENGTH.toLocaleString("ko-KR")}자까지 비교할 수 있습니다.`,
      "ACTUAL_ARTICLE_TOO_LONG",
    );
  }

  const expected = normalizeRawText(rawExpected);
  if (!expected) throw validationError("비교할 제공 원고가 없습니다.", "EMPTY_EXPECTED_ARTICLE");
  if (!rawActual.trim()) {
    throw validationError("실제로 발행한 글을 붙여넣어 주세요.", "EMPTY_ACTUAL_ARTICLE");
  }

  const normalizedActual = normalizeRawText(rawActual);
  const withoutTitle = stripOptionalTitle(rawActual, options.title);
  const actual =
    normalizedActual === expected || similarityScore(normalizedActual, expected) >= similarityScore(withoutTitle, expected)
      ? normalizedActual
      : withoutTitle;
  const actualHtml = actual === withoutTitle && normalizedActual !== withoutTitle
    ? stripOptionalTitleHtml(options.actualHtml, options.title)
    : options.actualHtml;
  const formatting = Object.hasOwn(options, "expectedHtml")
    ? compareArticleFormatting(options.expectedHtml, actualHtml, {
      compareTextPositions: withoutWhitespace(expected) === withoutWhitespace(actual),
    })
    : null;
  const formattingIssue = formattingDifferenceIssue(formatting);
  const baseResult = {
    expectedCharacters: expected.length,
    actualCharacters: actual.length,
    ...(formatting ? { formatting } : {}),
  };

  if (expected === actual) {
    const hasFormattingDifference = Boolean(formattingIssue);
    return Object.freeze({
      ...baseResult,
      status: hasFormattingDifference ? "formatting-only" : "match",
      score: 100,
      summary: hasFormattingDifference
        ? "내용은 일치하지만 글자 크기·서식이 다릅니다."
        : formatting?.status === "unavailable"
          ? "내용은 일치합니다. 서식은 HTML이 없어 확인하지 못했습니다."
          : "제공한 본문과 일치합니다.",
      issues: Object.freeze(formattingIssue ? [formattingIssue] : []),
    });
  }

  if (withoutWhitespace(expected) === withoutWhitespace(actual)) {
    const paragraphIssue = issue(
      "formatting",
      "문단·띄어쓰기가 달라요",
      `내용은 같지만 문단 수가 ${paragraphCount(expected)}개에서 ${paragraphCount(actual)}개로 달라졌습니다.`,
    );
    return Object.freeze({
      ...baseResult,
      status: "formatting-only",
      score: 100,
      summary: formattingIssue
        ? "내용은 같고 문단·띄어쓰기와 글자 크기·서식이 다릅니다."
        : "내용은 같고 문단·띄어쓰기만 다릅니다.",
      issues: Object.freeze([paragraphIssue, ...(formattingIssue ? [formattingIssue] : [])]),
    });
  }

  const expectedLines = contentLines(expected);
  const actualLines = contentLines(actual);
  const footerMissing = expected.includes(RIDE_FOOTER_URL) && !actual.includes(RIDE_FOOTER_URL);
  const ignoredFooterLines = footerMissing ? new Set([RIDE_FOOTER_LABEL, RIDE_FOOTER_URL]) : new Set();
  const missingLines = multisetDifference(expectedLines, actualLines).filter(
    (line) => !ignoredFooterLines.has(line),
  );
  const addedLines = multisetDifference(actualLines, expectedLines);
  const issues = [];

  if (formattingIssue) issues.push(formattingIssue);

  if (footerMissing) {
    issues.push(
      issue(
        "ride-footer",
        "놀이기구 찾기 링크가 빠졌어요",
        "본문 하단의 에버랜드 우리아이 놀이기구 찾기 안내와 링크를 다시 넣어 주세요.",
        [RIDE_FOOTER_URL],
      ),
    );
  }
  if (missingLines.length > 0) {
    issues.push(
      issue(
        "missing",
        "빠진 내용이 있어요",
        `제공 원고의 ${missingLines.length}개 줄을 실제 발행 글에서 찾지 못했습니다.`,
        missingLines,
      ),
    );
  }
  if (addedLines.length > 0) {
    issues.push(
      issue(
        "added",
        "추가된 내용이 있어요",
        `실제 발행 글에 제공 원고에는 없던 ${addedLines.length}개 줄이 있습니다.`,
        addedLines,
      ),
    );
  }

  const sameLineMultiset = missingLines.length === 0 && addedLines.length === 0 && !footerMissing;
  if (sameLineMultiset && expectedLines.join("\n") !== actualLines.join("\n")) {
    issues.push(
      issue(
        "order",
        "문장 순서가 달라요",
        "내용은 모두 있지만 실제 발행 글의 문장 순서가 제공 원고와 다릅니다.",
      ),
    );
  }

  const expectedParagraphs = paragraphCount(expected);
  const actualParagraphs = paragraphCount(actual);
  if (expectedParagraphs !== actualParagraphs) {
    issues.push(
      issue(
        "formatting",
        "문단·줄바꿈도 확인해 주세요",
        `문단 수가 ${expectedParagraphs}개에서 ${actualParagraphs}개로 달라졌습니다.`,
      ),
    );
  }

  const rawScore = similarityScore(expected, actual);
  const score = Math.min(sameLineMultiset ? Math.min(rawScore, 95) : rawScore, 99);
  return Object.freeze({
    ...baseResult,
    status: "different",
    score,
    summary: `확인할 차이 ${issues.length}건을 찾았습니다.`,
    issues: Object.freeze(issues),
  });
}
