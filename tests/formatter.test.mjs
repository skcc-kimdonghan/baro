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
