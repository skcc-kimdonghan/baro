import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_COMPARISON_LENGTH,
  MAX_DIFFERENCE_SAMPLES,
  comparePublishedArticle,
} from "../lib/article-comparison.mjs";

const RIDE_URL = "https://onecalc.kr/calc/everland-ride-passport/";

test("an identical published article matches and an identical title line is ignored", () => {
  const expected = "첫 문단입니다.\n\n둘째 문단입니다.";
  const result = comparePublishedArticle(expected, `테스트 제목\n\n${expected}`, {
    title: "테스트 제목",
  });

  assert.equal(result.status, "match");
  assert.equal(result.score, 100);
  assert.deepEqual(result.issues, []);
});

test("a legitimate first body line matching the title is not removed from an exact article", () => {
  const text = "같은 제목\n\n본문입니다.";
  const result = comparePublishedArticle(text, text, { title: "같은 제목" });

  assert.equal(result.status, "match");
  assert.equal(result.score, 100);
});

test("whitespace and paragraph-only changes are separated from content changes", () => {
  const result = comparePublishedArticle(
    "첫 문장입니다.\n\n둘째 문장입니다.",
    "첫   문장입니다. 둘째 문장입니다.",
  );

  assert.equal(result.status, "formatting-only");
  assert.equal(result.score, 100);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].type, "formatting");
});

test("Korean word-spacing changes are classified as formatting-only", () => {
  const result = comparePublishedArticle(
    "이렇게 할 수 있습니다. 놀이기구를 확인하세요.",
    "이렇게 할수 있습니다. 놀이 기구를 확인하세요.",
  );

  assert.equal(result.status, "formatting-only");
  assert.equal(result.score, 100);
});

test("missing and added lines are reported with bounded samples", () => {
  const expected = ["공통", "누락 1", "누락 2", "누락 3", "누락 4"].join("\n\n");
  const actual = ["공통", "추가 1", "추가 2", "추가 3", "추가 4"].join("\n\n");
  const result = comparePublishedArticle(expected, actual);

  assert.equal(result.status, "different");
  assert.ok(result.score < 100);
  assert.ok(result.issues.some((issue) => issue.type === "missing"));
  assert.ok(result.issues.some((issue) => issue.type === "added"));
  assert.ok(result.issues.every((issue) => issue.samples.length <= MAX_DIFFERENCE_SAMPLES));
});

test("reordered lines are reported without false missing or added content", () => {
  const result = comparePublishedArticle("첫째\n\n둘째\n\n셋째", "셋째\n\n첫째\n\n둘째");

  assert.equal(result.status, "different");
  assert.ok(result.issues.some((issue) => issue.type === "order"));
  assert.ok(!result.issues.some((issue) => issue.type === "missing"));
  assert.ok(!result.issues.some((issue) => issue.type === "added"));
});

test("a missing amusement-ride footer link receives a dedicated issue", () => {
  const expected = `놀이기구 안내입니다.\n\n에버랜드 우리아이 놀이기구 찾기↓↓ 아래 링크 클릭\n${RIDE_URL}`;
  const result = comparePublishedArticle(expected, "놀이기구 안내입니다.");

  const footerIssue = result.issues.find((issue) => issue.type === "ride-footer");
  assert.ok(footerIssue);
  assert.match(footerIssue.detail, /링크/);
  assert.ok(!result.issues.some((issue) => issue.type === "missing" && issue.samples.includes(RIDE_URL)));
});

test("empty and oversized actual articles are rejected", () => {
  assert.throws(
    () => comparePublishedArticle("제공 원고", "   "),
    (error) => error instanceof Error && error.code === "EMPTY_ACTUAL_ARTICLE",
  );
  assert.throws(
    () => comparePublishedArticle("제공 원고", "가".repeat(MAX_COMPARISON_LENGTH + 1)),
    (error) => error instanceof Error && error.code === "ACTUAL_ARTICLE_TOO_LONG",
  );
  assert.throws(
    () => comparePublishedArticle("가".repeat(MAX_COMPARISON_LENGTH + 1), "발행 원고"),
    (error) => error instanceof Error && error.code === "EXPECTED_ARTICLE_TOO_LONG",
  );
});

test("content differences never report a rounded 100 percent score", () => {
  const expected = Array.from({ length: 500 }, (_, index) => `단어${index}`).join(" ");
  const actual = expected.replace(" 단어499", "");
  const result = comparePublishedArticle(expected, actual);

  assert.equal(result.status, "different");
  assert.ok(result.score <= 99);
});

test("HTML-looking pasted text remains inert comparison text", () => {
  const result = comparePublishedArticle("안전한 본문", "<script>alert(1)</script>");
  const addedIssue = result.issues.find((issue) => issue.type === "added");

  assert.ok(addedIssue);
  assert.equal(addedIssue.samples[0], "<script>alert(1)</script>");
});
