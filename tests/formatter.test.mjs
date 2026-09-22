import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_HEADER_COLOR,
  MAX_INPUT_LENGTH,
  MAX_LINE_COUNT,
  formatArticles,
  normalizeWhitespace,
  renderArticle,
  splitArticles,
} from "../lib/formatter.mjs";

const bundledArticles = `# 첫 번째 글: 전기요금 줄이는 법

안녕하세요.  오늘은 전기요금을 정리합니다.

| 구분 | 월 비용 | 추천도 |
| --- | ---: | :---: |
| 기존 요금제 | 45,000원 | 보통 |
| 절약 요금제 | 31,000원 | 높음 |

- 대기전력을 끕니다.
- 사용 시간을 확인합니다.

---

# 두 번째 글: 여름철 절약 팁

## 핵심 요약

에어컨은 적정 온도로 설정하세요.`;

test("explicit dividers split a Korean article bundle without losing content", () => {
  const result = splitArticles(bundledArticles);

  assert.equal(result.method, "divider");
  assert.equal(result.articles.length, 2);
  assert.match(result.articles[0].source, /45,000원/);
  assert.match(result.articles[1].source, /여름철 절약 팁/);
});

test("repeated H1 headings split articles while H2 headings stay inside an article", () => {
  const result = splitArticles(`# 첫 글\n\n## 소제목\n\n내용\n\n# 둘째 글\n\n본문`);

  assert.equal(result.method, "heading");
  assert.equal(result.articles.length, 2);
  assert.match(result.articles[0].source, /## 소제목/);
});

test("numbered article labels split content and preserve the label title", () => {
  const result = splitArticles(`글 1: 봄 여행\n제주로 갑니다.\n\n글 2: 여름 여행\n강릉으로 갑니다.`);

  assert.equal(result.method, "label");
  assert.deepEqual(
    result.articles.map((article) => article.title),
    ["봄 여행", "여름 여행"],
  );
});

test("dividers inside fenced code do not split articles", () => {
  const result = splitArticles(`# 코드 예시\n\n\`\`\`md\n---\n\`\`\`\n\n본문`);

  assert.equal(result.method, "single");
  assert.equal(result.articles.length, 1);
});

test("a single ambiguous article is preserved and receives a warning", () => {
  const result = splitArticles(`제목 없는 원고입니다.\n\n내용을 그대로 보존합니다.`);

  assert.equal(result.method, "single");
  assert.equal(result.articles.length, 1);
  assert.ok(result.warnings.length > 0);
});

test("whitespace normalization keeps Korean and emoji while removing noisy spacing", () => {
  const normalized = normalizeWhitespace(`  안녕하세요.\u00a0\u00a0반갑습니다. 😊  \n\n\n\n다음 문단  `);

  assert.equal(normalized, `안녕하세요. 반갑습니다. 😊\n\n다음 문단`);
});

test("markdown tables render header color, alignment, and safe cell text", () => {
  const article = splitArticles(bundledArticles).articles[0];
  const rendered = renderArticle(article, { headerColor: "#DFF7E8" });

  assert.match(rendered.html, /<table/);
  assert.match(rendered.html, /background-color:#DFF7E8/);
  assert.match(rendered.html, /text-align:right/);
  assert.match(rendered.html, /text-align:center/);
  assert.equal(rendered.tableCount, 1);
  assert.match(rendered.plainText, /구분\t월 비용\t추천도/);
});

test("irregular table rows preserve extra cells and ordinary backslashes", () => {
  const article = splitArticles(`# 표 점검\n\n| 경로 | 상태 |\n| --- | --- |\n| C:\\Users | 정상 | LOST |`).articles[0];
  const rendered = renderArticle(article, { headerColor: DEFAULT_HEADER_COLOR });

  assert.match(rendered.html, /C:\\Users/);
  assert.match(rendered.html, /LOST/);
  assert.match(rendered.html, /<td[^>]*text-align:center;">LOST<\/td>/);
  assert.match(rendered.plainText, /C:\\Users\t정상\tLOST/);
});

test("fenced code keeps deliberate blank lines and ordered lists keep source numbers", () => {
  const article = splitArticles(`# 보존 점검\n\n\`\`\`txt\n첫 줄\n\n\n마지막 줄\n\`\`\`\n\n3. 셋째\n7. 일곱째`).articles[0];
  const rendered = renderArticle(article, { headerColor: DEFAULT_HEADER_COLOR });

  assert.match(rendered.plainText, /첫 줄\n\n\n마지막 줄/);
  assert.match(rendered.plainText, /3\. 셋째\n7\. 일곱째/);
  assert.match(rendered.html, /<li value="3"/);
  assert.match(rendered.html, /<li value="7"/);
});

test("a Setext heading underline is not treated as an article divider", () => {
  const result = splitArticles(`제목\n---\n\n본문입니다.`);

  assert.equal(result.method, "single");
  assert.equal(result.articles.length, 1);
});

test("a divider immediately before the next H1 still separates articles", () => {
  const result = splitArticles(`# 첫 글\n본문\n---\n# 둘째 글\n본문`);

  assert.equal(result.method, "divider");
  assert.equal(result.articles.length, 2);
});

test("a divider before a numbered H2 stays inside the reference article", () => {
  const result = formatArticles(`# 한 편의 글

## 1. 첫 번째 질문인가요?

A: 첫 답변입니다.

---

## 2. 두 번째 질문인가요?

A: 둘째 답변입니다.`);

  assert.equal(result.method, "single");
  assert.equal(result.articles.length, 1);
  assert.match(result.articles[0].html, /첫 번째 질문인가요\?/);
  assert.match(result.articles[0].html, /두 번째 질문인가요\?/);
  assert.equal((result.articles[0].html.match(/<hr /g) ?? []).length, 2);
});

test("a unicode visual divider before a reference heading is removed without duplicating our divider", () => {
  const result = formatArticles(`# 한 편의 글

도입 문단입니다.

────────────────────

## 1. 첫 번째 질문인가요?

A: 핵심 답변입니다.`);

  assert.equal(result.articles.length, 1);
  assert.doesNotMatch(result.articles[0].html, /─/);
  assert.doesNotMatch(result.articles[0].plainText, /─/);
  assert.equal((result.articles[0].html.match(/<hr /g) ?? []).length, 1);
});

test("a standalone unicode visual divider becomes our divider while inline marks remain", () => {
  const result = formatArticles(`# 구분선 정리

첫 문단입니다.

────────────────────

문장 안의 ─ 표시는 유지합니다.`);

  assert.equal((result.articles[0].html.match(/<hr /g) ?? []).length, 1);
  assert.doesNotMatch(result.articles[0].html, /────────────────────/);
  assert.match(result.articles[0].plainText, /문장 안의 ─ 표시는 유지합니다\./);
});

test("a unicode visual divider inside fenced code remains code", () => {
  const result = formatArticles(`# 코드 예시

\`\`\`text
────────────────────
\`\`\``);

  assert.match(result.articles[0].html, /<code[^>]*>────────────────────<\/code>/);
  assert.equal((result.articles[0].html.match(/<hr /g) ?? []).length, 0);
});

test("consecutive markdown and unicode dividers before a reference heading stay in one article", () => {
  const result = formatArticles(`# 혼합 구분선

도입 문단입니다.

---

────────────────────

## 1. 질문인가요?

A: 답변입니다.`);

  assert.equal(result.method, "single");
  assert.equal(result.articles.length, 1);
  assert.equal((result.articles[0].html.match(/<hr /g) ?? []).length, 1);
});

test("consecutive unicode and markdown divider variants collapse to one standard divider", () => {
  const result = formatArticles(`# 연속 구분선

첫 문단입니다.

─━═⎯—–

---

━━━━━━━━━━

## 1. 다음 질문인가요?

A: 답변입니다.`);

  assert.equal(result.method, "single");
  assert.equal(result.articles.length, 1);
  assert.equal((result.articles[0].html.match(/<hr /g) ?? []).length, 1);
  assert.doesNotMatch(result.articles[0].html, /[─━═⎯—–]/);
});

test("an adjacent mixed divider run preserves an article boundary", () => {
  const result = splitArticles(`# 첫 글

첫 본문입니다.

---
────────────────────

둘째 글 본문입니다.`);

  assert.equal(result.method, "divider");
  assert.equal(result.articles.length, 2);
  assert.match(result.articles[1].source, /둘째 글 본문입니다/);
});

test("a visual divider before the H1 is discarded with the leading title", () => {
  const result = formatArticles(`────────────────────

# 실제 제목

본문입니다.`);

  assert.equal(result.articles[0].title, "실제 제목");
  assert.doesNotMatch(result.articles[0].html, /실제 제목|<hr /);
  assert.match(result.articles[0].html, /본문입니다/);
});

test("an explicit divider before a generic H2 still separates articles", () => {
  const result = splitArticles(`# 첫 글

본문입니다.

---

## 둘째 글의 일반 소제목

다음 본문입니다.`);

  assert.equal(result.method, "divider");
  assert.equal(result.articles.length, 2);
  assert.match(result.articles[1].source, /둘째 글의 일반 소제목/);
});

test("a divider before a generic numbered question list still separates articles", () => {
  const result = splitArticles(`# 첫 글

첫 본문입니다.

---

1. 다음 글에서 확인할까요?
2. 두 번째 항목도 볼까요?`);

  assert.equal(result.method, "divider");
  assert.equal(result.articles.length, 2);
  assert.match(result.articles[1].source, /두 번째 항목도 볼까요\?/);
});

test("unsafe HTML and URL schemes never become executable markup", () => {
  const result = formatArticles(`# 안전 점검\n\n<script>alert(1)</script>\n\n[위험](javascript:alert(2))\n\n<img src=x onerror=alert(3)>`);
  const html = result.articles[0].html;

  assert.doesNotMatch(html, /<script|<img|onerror=|href="javascript:/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, />위험</);
});

test("inline markdown becomes semantic, Naver-friendly HTML", () => {
  const article = splitArticles(`# 제목\n\n**굵게**와 [공식 링크](https://help.naver.com)를 확인합니다.\n\n> 중요한 문장\n\n- 첫째\n- 둘째`).articles[0];
  const rendered = renderArticle(article, { headerColor: DEFAULT_HEADER_COLOR });

  assert.match(rendered.html, /<strong>굵게<\/strong>/);
  assert.match(rendered.html, /href="https:\/\/help\.naver\.com"/);
  assert.match(rendered.html, /<blockquote/);
  assert.match(rendered.html, /<ul/);
});

test("the reference Naver format turns question sections and answers into compact bold blocks", () => {
  const article = splitArticles(`# 기준 양식

“현장에서 바로 참여할 수 있을까요?”

가능합니다.

## 이 글에서 볼 내용

1. 첫 번째 질문은 무엇인가요?
2. 두 번째 질문은 무엇인가요?

## 1. 첫 번째 질문은 무엇인가요?

A: 핵심 답변을 먼저 안내합니다.

자세한 설명을 이어갑니다.

## 2. 두 번째 질문은 무엇인가요?

A: 두 번째 답변입니다.

## 그래서, 직접 해볼 만할까요?

마무리 판단을 안내합니다.`).articles[0];
  const rendered = renderArticle(article);

  assert.match(rendered.html, /font-size:16px[^>]*>.*이 글에서 볼 내용/s);
  assert.match(rendered.html, /<ol[^>]*>.*첫 번째 질문은 무엇인가요\?.*두 번째 질문은 무엇인가요\?/s);
  assert.match(rendered.html, /<strong>1\. 첫 번째 질문은 무엇인가요\?<\/strong>/);
  assert.match(rendered.html, /<strong>A: 핵심 답변을 먼저 안내합니다\.<\/strong>/);
  assert.match(rendered.html, /<strong>그래서, 직접 해볼 만할까요\?<\/strong>/);
  assert.equal((rendered.html.match(/<hr /g) ?? []).length, 3);
  assert.doesNotMatch(rendered.html, /<h2[^>]*>1\. 첫 번째 질문/);
});

test("numbered question lists remain lists unless followed by an A summary", () => {
  const listArticle = splitArticles(`# 질문 목록

1. 첫 번째 질문인가요?
2. 두 번째 질문인가요?`).articles[0];
  const listRendered = renderArticle(listArticle);

  assert.match(listRendered.html, /<ol/);
  assert.equal((listRendered.html.match(/<hr /g) ?? []).length, 0);

  const sectionArticle = splitArticles(`# 질문 섹션

1. 첫 번째 질문인가요?

A: 핵심 답변입니다.`).articles[0];
  const sectionRendered = renderArticle(sectionArticle);

  assert.match(sectionRendered.html, /<strong>1\. 첫 번째 질문인가요\?<\/strong>/);
  assert.match(sectionRendered.html, /<strong>A: 핵심 답변입니다\.<\/strong>/);
});

test("reference tables use the sampled gray header and center unmarked columns", () => {
  const article = splitArticles(`# 표 기준

| 구분 | 내용 |
| --- | --- |
| 행사 | 현장 미션 |`).articles[0];
  const rendered = renderArticle(article);

  assert.match(rendered.html, /background-color:#F7F7F7/);
  assert.match(rendered.html, /<th[^>]*text-align:center/);
  assert.match(rendered.html, /<td[^>]*text-align:center/);
});

test("empty and oversized input fail with clear validation codes", () => {
  assert.throws(() => formatArticles("   "), { code: "EMPTY_INPUT" });
  assert.throws(() => formatArticles("가".repeat(MAX_INPUT_LENGTH + 1)), {
    code: "INPUT_TOO_LONG",
  });
});

test("excessive line and article counts are rejected before rendering", () => {
  assert.throws(() => formatArticles(Array.from({ length: MAX_LINE_COUNT + 1 }, () => "가").join("\n")), {
    code: "TOO_MANY_LINES",
  });
  assert.throws(() => formatArticles(Array.from({ length: 51 }, (_, index) => `# 글 ${index + 1}\n본문`).join("\n")), {
    code: "TOO_MANY_ARTICLES",
  });
});

test("three to five articles are marked as the recommended range", () => {
  const result = formatArticles(`# 하나\n본문\n# 둘\n본문\n# 셋\n본문`);

  assert.equal(result.isRecommendedCount, true);
  assert.equal(result.articles.length, 3);
});

test("formatting returns immutable new article objects", () => {
  const split = splitArticles(bundledArticles);
  const before = structuredClone(split.articles);
  const result = formatArticles(bundledArticles);

  assert.deepEqual(split.articles, before);
  assert.notEqual(result.articles[0], split.articles[0]);
});
