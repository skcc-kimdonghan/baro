import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import {
  DEFAULT_HEADER_COLOR,
  MAX_INPUT_LENGTH,
  MAX_LINE_COUNT,
  createCopyPayload,
  createImagePromptPayload,
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

test("plain numbered labels keep URL-looking titles for backwards compatibility", () => {
  const result = splitArticles(`1번 글: https://example.com 방문 후기
첫 번째 본문입니다.

2번 글: 일반 제목
두 번째 본문입니다.`);

  assert.equal(result.method, "label");
  assert.equal(result.articles.length, 2);
  assert.equal(result.articles[0].title, "https://example.com 방문 후기");
});

test("number-first Markdown labels such as ### 2번 글 split pasted article bundles", () => {
  const result = splitArticles(`### 1번 글
# 봄 여행
제주로 갑니다.

### 2번 글&#x20;
# 여름 여행
강릉으로 갑니다.

### 3번 글: 가을 여행
설악산으로 갑니다.`);

  assert.equal(result.method, "label");
  assert.deepEqual(
    result.articles.map((article) => article.title),
    ["봄 여행", "여름 여행", "가을 여행"],
  );
  assert.match(result.articles[1].bodySource, /강릉으로 갑니다/);
});

test("numbered Markdown labels accept long dash separators with or without spaces", () => {
  for (const separator of [" — ", "—", " – ", "–", " ― ", "―"]) {
    const result = splitArticles(`먼저 5개 모두 최신 조건을 다시 확인해서 썼습니다. 각 글은 폰에서 따로 복사할 수 있게 분리했습니다.

### 1번 글${separator}롯데월드 부산 오후권 17,100원

롯데월드 부산 오후권 첫 번째 본문입니다.

### 2번 글${separator}롯데월드 부산 종일권 할인

두 번째 본문입니다.

### 3번 글${separator}좀비월드 공연 동선

세 번째 본문입니다.

### 4번 글${separator}아이와 방문 준비물

네 번째 본문입니다.

### 5번 글${separator}저녁 공연 — 관람 팁

다섯 번째 본문입니다.`);

    assert.equal(result.method, "label", separator);
    assert.equal(result.articles.length, 5, separator);
    assert.deepEqual(
      result.articles.map((article) => article.title),
      [
        "롯데월드 부산 오후권 17,100원",
        "롯데월드 부산 종일권 할인",
        "좀비월드 공연 동선",
        "아이와 방문 준비물",
        "저녁 공연 — 관람 팁",
      ],
      separator,
    );
    assert.doesNotMatch(result.articles[0].bodySource, /먼저 5개|### 1번 글/);
    assert.match(result.articles[4].bodySource, /다섯 번째 본문입니다/);
  }
});

test("repeated dash-label examples inside an existing article do not discard its introduction", () => {
  const result = splitArticles(`# 블로그 글을 폰에서 복사하는 방법

이 글은 글별 원고를 폰에서 각각 복사하기 좋게 나누는 방법을 설명합니다.

### 1번 글—표현 예시
첫 번째 예시를 설명합니다.

### 2번 글—표현 예시
두 번째 예시를 설명합니다.`);

  assert.equal(result.method, "single");
  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0].title, "블로그 글을 폰에서 복사하는 방법");
  assert.match(result.articles[0].bodySource, /글별 원고를 폰에서 각각 복사하기 좋게 나누는 방법/);
  assert.match(result.articles[0].bodySource, /### 1번 글—표현 예시/);
  assert.match(result.articles[0].bodySource, /### 2번 글—표현 예시/);
});

test("repeated dash labels inside multiline inline code do not split a wrapped article", () => {
  const result = splitArticles(`아래는 글별 원고를 폰에서 따로 복사할 수 있게 분리했습니다.

\`코드 예시가 시작됩니다.
### 1번 글—첫 번째 표현
첫 번째 코드 내용입니다.

### 2번 글—두 번째 표현
두 번째 코드 내용입니다.
코드 예시가 끝납니다.\`

마지막 실제 본문입니다.`);

  assert.equal(result.method, "single");
  assert.equal(result.articles.length, 1);
  assert.match(result.articles[0].bodySource, /### 1번 글—첫 번째 표현/);
  assert.match(result.articles[0].bodySource, /### 2번 글—두 번째 표현/);
  assert.match(result.articles[0].bodySource, /마지막 실제 본문입니다/);
});

test("inline code before a dash label cannot expose a false line-start boundary", () => {
  const result = splitArticles(`아래는 글별 원고를 폰에서 따로 복사할 수 있게 분리했습니다.

\`예시\`### 1번 글—첫 번째 표현
첫 번째 실제 본문입니다.

\`예시\`### 2번 글—두 번째 표현
두 번째 실제 본문입니다.`);

  assert.equal(result.method, "single");
  assert.equal(result.articles.length, 1);
  assert.match(result.articles[0].bodySource, /`예시`### 1번 글—첫 번째 표현/);
  assert.match(result.articles[0].bodySource, /`예시`### 2번 글—두 번째 표현/);
});

test("a divider inside multiline inline code stays code instead of splitting the article", () => {
  const result = splitArticles(`# 코드 안내

\`코드 예시가 시작됩니다.

---

코드 예시가 끝납니다.\`

마지막 실제 본문입니다.`);

  assert.equal(result.method, "single");
  assert.equal(result.articles.length, 1);
  assert.match(result.articles[0].bodySource, /---/);
  assert.match(result.articles[0].bodySource, /마지막 실제 본문입니다/);
});

test("an escaped backtick before a wrapped bundle does not hide real dash labels", () => {
  const escapedBacktick = `${String.fromCharCode(92)}${String.fromCharCode(96)}`;
  const result = splitArticles(`아래는 글별 원고를 폰에서 따로 복사할 수 있게 분리했습니다.

백틱 문자는 ${escapedBacktick}처럼 표시합니다.

### 1번 글—첫 번째 제목
첫 번째 본문입니다.

### 2번 글—두 번째 제목
두 번째 본문입니다.`);

  assert.equal(result.method, "label");
  assert.equal(result.articles.length, 2);
  assert.deepEqual(result.articles.map((article) => article.title), ["첫 번째 제목", "두 번째 제목"]);
});

test("repeated topic-number headings such as 에버랜드 1번 split article bundles", () => {
  const result = splitArticles(`아래는 글별 최종 원고입니다.

## 에버랜드 1번

첫 번째 에버랜드 제목

첫 번째 본문입니다.

## 에버랜드 2번

두 번째 에버랜드 제목

두 번째 본문입니다.`);

  assert.equal(result.method, "label");
  assert.equal(result.articles.length, 2);
  assert.deepEqual(
    result.articles.map((article) => article.title),
    ["첫 번째 에버랜드 제목", "두 번째 에버랜드 제목"],
  );
  assert.doesNotMatch(result.articles[0].bodySource, /에버랜드 1번|글별 최종 원고/);
  assert.doesNotMatch(result.articles[1].bodySource, /에버랜드 2번/);
  assert.match(result.articles[0].bodySource, /첫 번째 본문입니다/);
  assert.match(result.articles[1].bodySource, /두 번째 본문입니다/);
});

test("topic-number heading lookalikes do not split without a repeated matching topic", () => {
  const result = splitArticles(`# 에버랜드 안내

## 이용 순서 1번

첫 번째 설명입니다.

## 준비물 2번

두 번째 설명입니다.

\`\`\`md
## 이용 순서 2번
\`\`\``);

  assert.equal(result.method, "single");
  assert.equal(result.articles.length, 1);
  assert.match(result.articles[0].bodySource, /## 이용 순서 1번/);
  assert.match(result.articles[0].bodySource, /## 준비물 2번/);
});

test("repeated H1 article boundaries take precedence over topic-number subheadings", () => {
  const result = splitArticles(`# 첫 글

## 에버랜드 1번

첫 글 본문입니다.

# 둘째 글

## 에버랜드 2번

둘째 글 본문입니다.`);

  assert.equal(result.method, "heading");
  assert.equal(result.articles.length, 2);
  assert.deepEqual(result.articles.map((article) => article.title), ["첫 글", "둘째 글"]);
  assert.match(result.articles[0].bodySource, /## 에버랜드 1번/);
  assert.doesNotMatch(result.articles[0].bodySource, /둘째 글/);
  assert.match(result.articles[1].bodySource, /## 에버랜드 2번/);
});

test("large repeated topic-number heading candidates are rejected in bounded time", () => {
  const source = Array.from(
    { length: MAX_LINE_COUNT - 2 },
    (_, index) => `## 에버랜드 ${(index % 2) + 1}번`,
  ).join("\n");
  const startedAt = performance.now();

  assert.throws(() => splitArticles(source), { code: "TOO_MANY_ARTICLES" });
  const elapsed = performance.now() - startedAt;

  assert.ok(elapsed < 1_000, `topic-number heading scan took ${elapsed.toFixed(1)}ms`);
});

test("a divider between topic groups still splits every numbered article inside both groups", () => {
  const everland = Array.from({ length: 5 }, (_, index) => `## 에버랜드 ${index + 1}번

에버랜드 실제 제목 ${index + 1}

에버랜드 본문 ${index + 1}`).join("\n\n");
  const lotteWorld = Array.from({ length: 3 }, (_, index) => `## 롯데월드 ${index + 1}번

롯데월드 실제 제목 ${index + 1}

롯데월드 본문 ${index + 1}`).join("\n\n");
  const result = splitArticles(`먼저 에버랜드 5개, 그다음 롯데월드 3개 순서로 나눴습니다.

${everland}

---

${lotteWorld}`);

  assert.equal(result.method, "divider");
  assert.equal(result.articles.length, 8);
  assert.deepEqual(
    result.articles.map((article) => article.title),
    [
      "에버랜드 실제 제목 1",
      "에버랜드 실제 제목 2",
      "에버랜드 실제 제목 3",
      "에버랜드 실제 제목 4",
      "에버랜드 실제 제목 5",
      "롯데월드 실제 제목 1",
      "롯데월드 실제 제목 2",
      "롯데월드 실제 제목 3",
    ],
  );
  assert.doesNotMatch(result.articles[0].bodySource, /먼저 에버랜드 5개|에버랜드 1번/);
  assert.match(result.articles[7].bodySource, /롯데월드 본문 3/);
});

test("bracketed labels such as [1번글] and [2번 글] split pasted article bundles", () => {
  const result = splitArticles(`[1번글]
첫 번째 제목

첫 번째 본문입니다.

### [2번 글]: 두 번째 제목

두 번째 본문입니다.`);

  assert.equal(result.method, "label");
  assert.equal(result.articles.length, 2);
  assert.equal(result.articles[0].title, "첫 번째 제목");
  assert.equal(result.articles[1].title, "두 번째 제목");
  assert.doesNotMatch(result.articles[0].bodySource, /\[1번글\]/);
  assert.doesNotMatch(result.articles[1].bodySource, /\[2번 글\]/);
});

test("bracketed label lookalikes in prose, links, and code do not split articles", () => {
  const result = splitArticles(`# 대괄호 표기 설명

[1번글]은 예시 표현입니다.

[1번글](https://example.com)은 링크입니다.

[1번글]: https://example.com/one
[2번글]: <https://example.com/two>
[3번글]: guide.md
[4번글]: #section
[5번글]: ftp://example.com/file
[6번글]: <guide.md>
[7번글]: guide
[8번글]: docs/guide
[9번글]: assets/image
[10번글]: guide_(v2)

\`\`\`text
[2번글]
\`\`\``);

  assert.equal(result.method, "single");
  assert.equal(result.articles.length, 1);
  assert.match(result.articles[0].bodySource, /\[1번글\]은/);
  assert.match(result.articles[0].bodySource, /\[1번글\]: https:\/\/example\.com\/one/);
  assert.match(result.articles[0].bodySource, /\[2번글\]/);
  assert.match(result.articles[0].bodySource, /\[10번글\]: guide_\(v2\)/);
});

test("number-first label prefixes in prose, headings, and code do not split articles", () => {
  const result = splitArticles(`# 독서 기록

### 2번 글쓰기 — 팁

오늘은 2번 글을 읽고 3번 글도 비교했습니다.

2번 글자는 오타가 아닙니다.

\`\`\`md
### 2번 글
코드 예시입니다.
\`\`\`

마지막 본문입니다.`);

  assert.equal(result.method, "single");
  assert.equal(result.articles.length, 1);
  assert.match(result.articles[0].bodySource, /2번 글쓰기 — 팁/);
  assert.match(result.articles[0].bodySource, /2번 글을 읽고/);
  assert.match(result.articles[0].bodySource, /2번 글자는 오타가 아닙니다/);
  assert.match(result.articles[0].bodySource, /### 2번 글\n코드 예시입니다/);
});

test("Korean episode labels such as 1편 and 2편 split pasted article bundles", () => {
  const result = splitArticles(`1편: 봄 여행
제주로 갑니다.

2편 여름 여행
강릉으로 갑니다.

3편
# 가을 여행
설악산으로 갑니다.`);

  assert.equal(result.method, "label");
  assert.deepEqual(
    result.articles.map((article) => article.title),
    ["봄 여행", "여름 여행", "가을 여행"],
  );
  assert.match(result.articles[2].bodySource, /설악산으로 갑니다/);
});

test("episode words inside ordinary sentences do not split articles", () => {
  const result = splitArticles(`# 드라마 감상

1편을 보고 오늘 2편도 이어서 봤습니다.

\`\`\`txt
1편: 코드 예시
2편: 코드 예시
\`\`\``);

  assert.equal(result.method, "single");
  assert.equal(result.articles.length, 1);
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

test("consecutive pipe rows without a divider are repaired into a table", () => {
  const article = splitArticles(`# 국민연금 확인표

50~55세라면 이렇게 확인하면 됩니다.
확인할 항목 | 가입내역에서 볼 내용 | 확인 후 할 일
가입기간 | 현재 가입월수 | 120개월 충족 여부 확인
납부 공백 | 납부예외·미납 여부 | 공백의 종류 확인
예상연금 | 표시된 예상 월액 | 앞으로 납부한다는 가정 확인
수령나이 | 출생연도 | 정상 지급개시연령 확인
퇴직 이후 | 지역가입·납부예외 여부 | 퇴직 후 자격 확인`).articles[0];
  const rendered = renderArticle(article, { headerColor: DEFAULT_HEADER_COLOR });

  assert.equal(rendered.tableCount, 1);
  assert.equal((rendered.html.match(/<tr>/g) ?? []).length, 6);
  assert.match(rendered.html, /<th[^>]*>확인할 항목<\/th>/);
  assert.match(rendered.html, /<td[^>]*>120개월 충족 여부 확인<\/td>/);
  assert.match(rendered.plainText, /50~55세라면 이렇게 확인하면 됩니다\./);
  assert.match(rendered.plainText, /확인할 항목\t가입내역에서 볼 내용\t확인 후 할 일/);
});

test("one blank line between a dividerless header and its rows stays in one table", () => {
  const article = splitArticles(`# 국민연금 확인표

확인할 항목 | 가입내역에서 볼 내용 | 확인 후 할 일

가입기간 | 현재 가입월수 | 120개월 충족 여부 확인
납부 공백 | 납부예외·미납 여부 | 공백의 종류 확인
예상연금 | 표시된 예상 월액 | 앞으로 납부한다는 가정 확인
수령나이 | 출생연도 | 정상 지급개시연령 확인
퇴직 이후 | 지역가입·납부예외 여부 | 퇴직 후 자격 확인`).articles[0];
  const rendered = renderArticle(article, { headerColor: DEFAULT_HEADER_COLOR });

  assert.equal(rendered.tableCount, 1);
  assert.equal((rendered.html.match(/<tr>/g) ?? []).length, 6);
  assert.match(rendered.html, /<th[^>]*>확인할 항목<\/th>/);
  assert.doesNotMatch(rendered.html, /<th[^>]*>가입기간<\/th>/);
  assert.match(rendered.html, /<td[^>]*>가입기간<\/td>/);
  assert.match(rendered.plainText, /^확인할 항목\t가입내역에서 볼 내용\t확인 후 할 일\n가입기간/m);
});

test("pipe prose before a blank line stays separate from the following table", () => {
  const rendered = renderArticle(splitArticles(`# 비교 설명

이 결과는 A | B로 나뉩니다.

항목 | 값
기간 | 10년
금액 | 20만원`).articles[0]);

  assert.equal(rendered.tableCount, 1);
  assert.match(rendered.html, /<p[^>]*>이 결과는 A \| B로 나뉩니다\.<\/p>/);
  assert.match(rendered.html, /<th[^>]*>항목<\/th>/);
  assert.doesNotMatch(rendered.html, /<th[^>]*>이 결과는/);
});

test("Markdown-wrapped pipe prose stays separate from the following table", () => {
  const variants = [
    "이 결과는 A | **B로 나뉩니다.**",
    "이 결과는 A | [B로 나뉩니다.](https://example.com)",
  ];

  for (const sentence of variants) {
    const rendered = renderArticle(splitArticles(`# 비교 설명

${sentence}

항목 | 값
기간 | 10년
금액 | 20만원`).articles[0]);

    assert.equal(rendered.tableCount, 1);
    assert.match(rendered.html, /<th[^>]*>항목<\/th>/);
    assert.doesNotMatch(rendered.html, /<th[^>]*>이 결과는/);
  }
});

test("a blank gap does not bridge mismatched columns or a single data row", () => {
  const mismatched = renderArticle(splitArticles(`# 불일치 표

항목 | 내용 | 조치

기간 | 10년
금액 | 20만원
상태 | 정상`).articles[0]);
  const tooShort = renderArticle(splitArticles(`# 짧은 표

항목 | 내용

기간 | 10년`).articles[0]);

  assert.doesNotMatch(mismatched.html, /<th[^>]*>항목<\/th>/);
  assert.equal(tooShort.tableCount, 0);
  assert.doesNotMatch(tooShort.html, /<table/);
});

test("one or two pipe-like prose lines are not inferred as a table", () => {
  const oneLine = renderArticle(splitArticles(`# 기호 설명

A | B는 선택지를 뜻합니다.`).articles[0]);
  const twoLines = renderArticle(splitArticles(`# 비교 설명

장점 | 빠릅니다
단점 | 비용이 듭니다`).articles[0]);

  assert.equal(oneLine.tableCount, 0);
  assert.equal(twoLines.tableCount, 0);
  assert.doesNotMatch(oneLine.html, /<table/);
  assert.doesNotMatch(twoLines.html, /<table/);
});

test("sentence-like and inconsistent pipe rows are not inferred as tables", () => {
  const prose = renderArticle(splitArticles(`# 비교 설명

첫 번째 결과는 A | B 입니다.
두 번째 결과는 C | D 입니다.
마지막 결과는 E | F 입니다.`).articles[0]);
  const wrappedProse = renderArticle(splitArticles(`# 외곽 파이프 설명

| 첫 번째 결과는 A | B 입니다. |
| 두 번째 결과는 C | D 입니다. |
| 마지막 결과는 E | F 입니다. |`).articles[0]);
  const inconsistent = renderArticle(splitArticles(`# 불완전 데이터

항목 | 내용 | 조치
기간 | 10년
금액 | 20만원 | 확인`).articles[0]);

  assert.equal(prose.tableCount, 0);
  assert.equal(wrappedProse.tableCount, 0);
  assert.equal(inconsistent.tableCount, 0);
  assert.doesNotMatch(prose.html, /<table/);
  assert.doesNotMatch(wrappedProse.html, /<table/);
  assert.doesNotMatch(inconsistent.html, /<table/);
});

test("a large inconsistent pipe run is rejected in bounded time", () => {
  const rows = Array.from({ length: 5_997 }, () => "항목 | 내용");
  const input = `# 대형 입력\n\n${[...rows, "항목 | 내용 | 조치"].join("\n")}`;
  const startedAt = performance.now();
  const result = formatArticles(input);
  const elapsed = performance.now() - startedAt;

  assert.equal(result.articles[0].tableCount, 0);
  assert.ok(elapsed < 1_000, `inferred table scan took ${elapsed.toFixed(1)}ms`);
});

test("dividerless pipe rows inside fenced code remain code", () => {
  const rendered = renderArticle(splitArticles(`# 코드 예시

\`\`\`text
확인할 항목 | 내용
가입기간 | 120개월
예상연금 | 월 예상액
\`\`\``).articles[0]);

  assert.equal(rendered.tableCount, 0);
  assert.match(rendered.html, /<pre/);
  assert.match(rendered.plainText, /확인할 항목 \| 내용/);
});

test("escaped leading pipes and short alignment markers are repaired into a table", () => {
  const article = splitArticles(`# 파이널 랩 추천 순서

\\| 순서 | 추천 체험 |
\\| :-: | :----------: |
\\| 1 | 글로벌페어 F1 머신 |
\\| 2 | 타이어 롤링 챌린지 |
\\| 3 | 레이싱카·장비 전시 |
\\| 4 | 레이싱 게임·시뮬레이터 |
\\| 5 | 포디움 사진 |
\\| 6 | 슈퍼레이스 현장 미션 |
기존 파이널 랩을 이미 한 번 봤더라도 이번에는`).articles[0];
  const rendered = renderArticle(article, { headerColor: DEFAULT_HEADER_COLOR });

  assert.equal(rendered.tableCount, 1);
  assert.equal((rendered.html.match(/<tr>/g) ?? []).length, 7);
  assert.match(rendered.html, /<th[^>]*text-align:center;">순서<\/th>/);
  assert.match(rendered.html, /<td[^>]*text-align:center;">타이어 롤링 챌린지<\/td>/);
  assert.match(rendered.plainText, /순서\t추천 체험/);
  assert.match(rendered.plainText, /6\t슈퍼레이스 현장 미션/);
  assert.match(rendered.plainText, /기존 파이널 랩을 이미 한 번 봤더라도 이번에는/);
  assert.doesNotMatch(rendered.html, /\\\| 순서/);
});

test("escaped pipes inside a normal table cell remain literal cell content", () => {
  const article = splitArticles(`# 기호 보존

| 표현 | 설명 |
| --- | --- |
| A \\| B | 파이프 포함 |`).articles[0];
  const rendered = renderArticle(article, { headerColor: DEFAULT_HEADER_COLOR });

  assert.equal(rendered.tableCount, 1);
  assert.match(rendered.html, /<td[^>]*>A \| B<\/td>/);
  assert.match(rendered.plainText, /A \| B\t파이프 포함/);
});

test("escaped leading pipes stay text without a divider and inside fenced code", () => {
  const prose = renderArticle(splitArticles(`# 기호 설명

\\| 이것은 표가 아니라 입력 예시입니다 |

다음 문장도 일반 본문입니다.`).articles[0]);
  const code = renderArticle(splitArticles(`# 코드 예시

\`\`\`md
\\| 순서 | 추천 체험 |
\\| :-: | :-: |
\`\`\``).articles[0]);

  assert.equal(prose.tableCount, 0);
  assert.match(prose.plainText, /\\\| 이것은 표가 아니라 입력 예시입니다 \|/);
  assert.equal(code.tableCount, 0);
  assert.match(code.plainText, /\\\| 순서 \| 추천 체험 \|/);
  assert.match(code.html, /<pre/);
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
  assert.equal((result.articles[0].html.match(/<hr /g) ?? []).length, 3);
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
  assert.equal((result.articles[0].html.match(/<hr /g) ?? []).length, 2);
});

test("a standalone unicode visual divider becomes our divider while inline marks remain", () => {
  const result = formatArticles(`# 구분선 정리

첫 문단입니다.

────────────────────

문장 안의 ─ 표시는 유지합니다.`);

  assert.equal((result.articles[0].html.match(/<hr /g) ?? []).length, 2);
  assert.doesNotMatch(result.articles[0].html, /────────────────────/);
  assert.match(result.articles[0].plainText, /문장 안의 ─ 표시는 유지합니다\./);
});

test("a unicode visual divider inside fenced code remains code", () => {
  const result = formatArticles(`# 코드 예시

\`\`\`text
────────────────────
\`\`\``);

  assert.match(result.articles[0].html, /<code[^>]*>────────────────────<\/code>/);
  assert.equal((result.articles[0].html.match(/<hr /g) ?? []).length, 1);
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
  assert.equal((result.articles[0].html.match(/<hr /g) ?? []).length, 2);
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
  assert.equal((result.articles[0].html.match(/<hr /g) ?? []).length, 2);
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
  assert.doesNotMatch(result.articles[0].html, /실제 제목/);
  assert.equal((result.articles[0].html.match(/<hr /g) ?? []).length, 1);
  assert.match(result.articles[0].html, /본문입니다/);
});

test("high-confidence GPT preamble and editorial notes are removed before articles", () => {
  const result = formatArticles(`폰에서 바로 복붙할 수 있도록 **2개 글을 각각 따로 복사 가능한 블록**으로 나눴습니다.

1번 글은 세부 공연표가 공개되지 않은 상태라 그 부분은 억지로 만들지 않았습니다. ([삼성물산 뉴스룸][1])

[1]: https://news.samsungcnt.com/example

# 첫 번째 글

첫 글 본문입니다.

# 두 번째 글

둘째 글 본문입니다.`);

  assert.equal(result.method, "heading");
  assert.equal(result.articles.length, 2);
  const copied = result.articles.map(({ html, plainText }) => `${html}\n${plainText}`).join("\n");
  assert.doesNotMatch(copied, /바로 복붙|복사 가능한 블록|나눴습니다/);
  assert.doesNotMatch(copied, /억지로 만들지 않았습니다/);
  assert.doesNotMatch(copied, /삼성물산 뉴스룸|\[1\]|news\.samsungcnt/);
  assert.match(copied, /첫 글 본문입니다/);
  assert.match(copied, /둘째 글 본문입니다/);
});

test("reference citations are removed while substantive unpublished-status text remains", () => {
  const article = formatArticles(`# 행사 안내

세부 공연표는 아직 공개되지 않았습니다. ([삼성물산 뉴스룸][1])

공식 발표 뒤 다시 확인하세요.

[1]: https://news.samsungcnt.com/example`).articles[0];

  assert.match(article.plainText, /세부 공연표는 아직 공개되지 않았습니다\./);
  assert.match(article.plainText, /공식 발표 뒤 다시 확인하세요\./);
  assert.doesNotMatch(article.html, /삼성물산 뉴스룸|\[1\]|news\.samsungcnt/);
  assert.doesNotMatch(article.plainText, /삼성물산 뉴스룸|\[1\]|news\.samsungcnt/);
});

test("near-miss body text, normal links, brackets, and fenced references are preserved", () => {
  const article = formatArticles(`# 보존 점검

폰에서 바로 복붙하면 확인이 편리합니다.

1번 버스를 타면 행사장에 도착합니다.

[참고] 세부 일정은 변경될 수 있습니다.

[공식 안내](https://example.com)를 확인하세요.

\`\`\`md
[문서][1]
[1]: https://example.com/reference
\`\`\``).articles[0];

  assert.match(article.plainText, /폰에서 바로 복붙하면 확인이 편리합니다/);
  assert.match(article.plainText, /1번 버스를 타면/);
  assert.match(article.plainText, /\[참고\]/);
  assert.match(article.html, /href="https:\/\/example\.com"/);
  assert.match(article.plainText, /\[문서\]\[1\]/);
  assert.match(article.plainText, /\[1\]: https:\/\/example\.com\/reference/);
});

test("real topic introductions about copying files and numbered algorithms are preserved", () => {
  const copyGuide = formatArticles(`여러 개의 사진을 각각 다른 폴더로 복사하는 방법을 정리했습니다.

# 사진 백업 가이드

폴더별로 사진을 확인합니다.`).articles[0];
  const algorithmGuide = formatArticles(`1번 알고리즘은 누락값을 임의로 만들어 넣지 않았습니다.

# 데이터 처리 원칙

원본 값을 보존합니다.`).articles[0];

  assert.match(copyGuide.plainText, /여러 개의 사진을 각각 다른 폴더로 복사/);
  assert.match(algorithmGuide.plainText, /1번 알고리즘은 누락값을 임의로 만들어 넣지 않았습니다/);
});

test("tilde and long backtick fences preserve reference definitions", () => {
  const result = formatArticles(`# 코드 보존

~~~md
[코드 안 제목][1]
---
# 가짜 글 제목
~~~not-a-close
[틸드 문서][1]
[1]: https://example.com/tilde
~~~

\`\`\`\`md
\`\`\`
# 두 번째 가짜 글 제목
[긴 펜스 문서][2]
[2]: https://example.com/long
\`\`\`\`

일반 본문입니다.`);

  const article = result.articles[0];

  assert.equal(result.method, "single");
  assert.equal(result.articles.length, 1);
  assert.equal((article.html.match(/<pre /g) ?? []).length, 2);
  assert.match(article.plainText, /\[1\]: https:\/\/example\.com\/tilde/);
  assert.match(article.plainText, /\[2\]: https:\/\/example\.com\/long/);
  assert.match(article.plainText, /일반 본문입니다/);
});

test("space-separated reference citations are removed with their definitions", () => {
  const article = formatArticles(`# 다중 인용

필요한 본문입니다. ([자료 A][1] [자료 B][2])

[1]: https://example.com/a
[2]: https://example.com/b`).articles[0];

  assert.ok(article.plainText.startsWith("필요한 본문입니다.\n\n"));
  assert.doesNotMatch(article.html, /자료 A|자료 B|example\.com|\[[12]\]/);
});

test("a real introduction next to a meta line is preserved", () => {
  const article = formatArticles(`폰에서 바로 복붙할 수 있도록 2개 글을 각각 따로 복사 가능한 블록으로 나눴습니다.
오늘은 가족과 함께 갈 만한 공연을 소개합니다.

# 첫 번째 글

첫 본문입니다.

# 두 번째 글

둘째 본문입니다.`).articles[0];

  assert.doesNotMatch(article.plainText, /복사 가능한 블록|나눴습니다/);
  assert.match(article.plainText, /오늘은 가족과 함께 갈 만한 공연을 소개합니다/);
});

test("bare reference-style citation tokens are removed with their definitions", () => {
  const article = formatArticles(`# 출처 정리

필요한 본문입니다. [삼성물산 뉴스룸][1]

[1]: https://example.com/source`).articles[0];

  assert.ok(article.plainText.startsWith("필요한 본문입니다.\n\n"));
  assert.doesNotMatch(article.html, /삼성물산|\[1\]|example\.com/);
});

test("headings and article labels inside fences never become the article title", () => {
  const article = formatArticles(`~~~md
# 가짜 제목
글 2: 가짜 글 라벨
~~~

실제 첫 문장입니다.`).articles[0];

  assert.equal(article.title, "실제 첫 문장입니다.");
  assert.match(article.plainText, /# 가짜 제목/);
  assert.match(article.plainText, /글 2: 가짜 글 라벨/);
});

test("reference syntax inside inline code and normal Markdown links is preserved", () => {
  const article = formatArticles(`# 인라인 보존

참조 문법은 \`[문서][1]\`처럼 작성합니다.

[정상 링크](https://example.com/path/[문서][1])를 확인합니다.`).articles[0];

  assert.match(article.plainText, /\[문서\]\[1\]/);
  assert.match(article.html, /<code[^>]*>\[문서\]\[1\]<\/code>/);
  assert.match(article.html, /href="https:\/\/example\.com\/path\/\[문서\]\[1\]"/);
});

test("inline code nested in a Markdown link never leaks placeholder tokens", () => {
  const article = formatArticles(`# 중첩 인라인 보존

[\`[문서][1]\` 설명](https://example.com)을 확인합니다.`).articles[0];

  assert.doesNotMatch(article.html, /\u0000|literal-/);
  assert.doesNotMatch(article.plainText, /\u0000|literal-/);
  assert.match(article.html, /href="https:\/\/example\.com"/);
  assert.match(article.html, /\[문서\]\[1\]/);
});

test("spaces around adjacent inline literals remain intact", () => {
  const article = formatArticles(`# 공백 보존

문법은 \`a\` \`b\` 입니다.

본문 [정상 링크](https://example.com) 앞 공백도 유지합니다.`).articles[0];

  assert.match(article.plainText, /문법은 a b 입니다\./);
  assert.match(article.plainText, /본문 정상 링크 \(https:\/\/example\.com\) 앞 공백/);
  assert.match(article.html, /문법은 <code[^>]*>a<\/code> <code[^>]*>b<\/code> 입니다\./);
  assert.match(article.html, /본문 <a href=/);
});

test("malformed repeated Markdown links render within a bounded time", () => {
  const source = `# 링크 성능\n\n${"[a](".repeat(24_990)}`;
  const article = splitArticles(source).articles[0];
  const startedAt = performance.now();
  const rendered = renderArticle(article);
  const elapsed = performance.now() - startedAt;

  assert.ok(elapsed < 1_000, `rendering took ${elapsed.toFixed(1)}ms`);
  assert.match(rendered.plainText, /\[a\]\(/);
});

test("images use the same upload placeholder in rich and plain copy", () => {
  const article = formatArticles(`# 이미지 안내

![행사 포스터](https://example.com/poster.jpg)`).articles[0];

  assert.match(article.html, /\[이미지: 행사 포스터\]/);
  assert.doesNotMatch(article.html, /<a href=/);
  assert.match(article.plainText, /\[이미지: 행사 포스터\]/);
});

test("nested-parenthesis links preserve reference-like text inside their URL", () => {
  const article = formatArticles(`# 링크 보존

[정상 링크](https://example.com/a(b(c))[문서][1])를 확인합니다.`).articles[0];

  assert.match(article.html, /href="https:\/\/example\.com\/a\(b\(c\)\)\[문서\]\[1\]"/);
  assert.match(article.plainText, /https:\/\/example\.com\/a\(b\(c\)\)\[문서\]\[1\]/);
});

test("links with inline-code labels and link syntax inside code remain intact", () => {
  const article = formatArticles(`# 혼합 리터럴 보존

[\`코드\` 링크](https://example.com/a(b(c))[문서][1])

\`[코드 링크](https://example.com/[자료][2])\``).articles[0];

  assert.match(article.html, /href="https:\/\/example\.com\/a\(b\(c\)\)\[문서\]\[1\]"/);
  assert.match(article.html, /<code[^>]*>\[코드 링크\]\(https:\/\/example\.com\/\[자료\]\[2\]\)<\/code>/);
  assert.match(article.plainText, /https:\/\/example\.com\/\[자료\]\[2\]/);
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
  assert.equal((rendered.html.match(/<hr /g) ?? []).length, 4);
  assert.doesNotMatch(rendered.html, /<h2[^>]*>1\. 첫 번째 질문/);
});

test("an A summary uses one paragraph gap before its detail body", () => {
  const article = formatArticles(`# 답변 간격

## 1. 무엇을 확인해야 하나요?

A: 가입기간을 먼저 확인합니다.


  가입내역에서 시작일과 종료일을 확인하세요.`).articles[0];
  const payload = createCopyPayload(article);
  const answerWithSingleGap = /<p style="margin:0;[^"]*"><strong>A: 가입기간을 먼저 확인합니다\.<\/strong><\/p><p style="margin:0;font-size:16px;line-height:1\.8;color:#666666;"><br><\/p><p[^>]*>가입내역에서 시작일과 종료일을 확인하세요\.<\/p>/;
  const blankParagraph = /<p[^>]*>\s*<br\s*\/?>(?:\s*)<\/p>/g;

  assert.match(article.html, answerWithSingleGap);
  assert.match(payload.html, answerWithSingleGap);
  assert.equal((article.html.match(blankParagraph) ?? []).length, 1);
  assert.equal((payload.html.match(blankParagraph) ?? []).length, 1);
  assert.match(article.plainText, /A: 가입기간을 먼저 확인합니다\.\n\n가입내역에서 시작일과 종료일을 확인하세요\./);
  assert.equal(payload.plainText, article.plainText);
});

test("a bold-wrapped A summary keeps one visible blank line before its detail body", () => {
  const article = formatArticles(`# 연금 답변

## 1. 연금소득금액은 얼마인가요?

**A: 과세대상 연금이 연 500만원이라면 연금소득금액은 90만원입니다.**

그다음 종합소득 과세 여부를 확인합니다.`).articles[0];
  const payload = createCopyPayload(article);
  const answerWithSingleGap = /<p style="margin:0;[^"]*"><strong>A: 과세대상 연금이 연 500만원이라면 연금소득금액은 90만원입니다\.<\/strong><\/p><p style="margin:0;font-size:16px;line-height:1\.8;color:#666666;"><br><\/p><p[^>]*>그다음 종합소득 과세 여부를 확인합니다\.<\/p>/;
  const blankParagraph = /<p[^>]*>\s*<br\s*\/?>(?:\s*)<\/p>/g;

  assert.match(article.html, answerWithSingleGap);
  assert.match(payload.html, answerWithSingleGap);
  assert.equal((article.html.match(blankParagraph) ?? []).length, 1);
  assert.equal((payload.html.match(blankParagraph) ?? []).length, 1);
  assert.doesNotMatch(payload.html, /<strong>\s*<strong>/);
  assert.match(payload.plainText, /A: 과세대상 연금이 연 500만원이라면 연금소득금액은 90만원입니다\.\n\n그다음 종합소득 과세 여부를 확인합니다\./);
  assert.doesNotMatch(payload.plainText, /\*\*/);
});

test("an A summary does not add a trailing or next-question spacer", () => {
  const ending = formatArticles(`# 끝 답변

## 1. 확인할까요?

A: 여기서 답변이 끝납니다.`).articles[0];
  const nextQuestion = formatArticles(`# 연속 질문

## 1. 첫 번째 질문인가요?

A: 첫 답변입니다.

## 2. 두 번째 질문인가요?

A: 둘째 답변입니다.`).articles[0];

  assert.doesNotMatch(ending.html, /A: 여기서 답변이 끝납니다\.<\/strong><\/p><p[^>]*>\s*<br/);
  assert.doesNotMatch(nextQuestion.html, /A: 첫 답변입니다\.<\/strong><\/p><p[^>]*>\s*<br/);
  assert.match(nextQuestion.html, /A: 첫 답변입니다\.<\/strong><\/p><hr/);
});

test("an A summary does not add a spacer before a plain question or outline", () => {
  const plainQuestion = formatArticles(`# 일반 질문 경계

## 1. 첫 번째 질문인가요?

A: 첫 답변입니다.

2. 다음 질문인가요?

다음 질문의 설명입니다.`).articles[0];
  const outline = formatArticles(`# 목차 경계

## 1. 첫 번째 질문인가요?

A: 첫 답변입니다.

**이 글에서 볼 내용**

1. 다음 항목`).articles[0];
  const blankParagraph = /<p[^>]*>\s*<br\s*\/?>(?:\s*)<\/p>/g;

  assert.doesNotMatch(plainQuestion.html, /A: 첫 답변입니다\.<\/strong><\/p><p[^>]*>\s*<br/);
  assert.equal((outline.html.match(blankParagraph) ?? []).length, 1);
  assert.doesNotMatch(outline.html, /A: 첫 답변입니다\.<\/strong><\/p><p[^>]*>\s*<br[^>]*><\/p><p[^>]*>\s*<br/);
});

test("the outline heading keeps exactly one explicit blank paragraph above it", () => {
  const article = formatArticles(`# 목차 간격

목차 전에 나오는 마지막 문장입니다.



## 이 글에서 볼 내용

1. 첫 번째 질문은 무엇인가요?`).articles[0];
  const payload = createCopyPayload(article);
  const outlineWithSpacer = /<p[^>]*>\s*<br\s*\/?>(?:\s*)<\/p><p[^>]*><strong>이 글에서 볼 내용<\/strong><\/p>/;
  const blankParagraph = /<p[^>]*>\s*<br\s*\/?>(?:\s*)<\/p>/g;

  assert.match(article.html, outlineWithSpacer);
  assert.match(payload.html, outlineWithSpacer);
  assert.equal((article.html.match(blankParagraph) ?? []).length, 1);
  assert.equal((payload.html.match(blankParagraph) ?? []).length, 1);
  assert.equal(payload.plainText, article.plainText);
});

test("an ordinary sentence mentioning the outline phrase does not receive a blank spacer", () => {
  const article = formatArticles(`# 일반 문장

이 글에서 볼 내용은 다음 문단에서 설명합니다.`).articles[0];

  assert.equal((article.html.match(/<p[^>]*>\s*<br\s*\/?>(?:\s*)<\/p>/g) ?? []).length, 0);
});

test("only the opening question line is italicized", () => {
  const article = formatArticles(`# 첫 질문 기울임

“처음부터 가볍게 시작할 수 있을까요?”
바로 다음 줄은 일반 문장입니다.

두 번째 질문도 가능한가요?`).articles[0];

  assert.match(article.html, /<em[^>]*>“처음부터 가볍게 시작할 수 있을까요\?”<\/em><br>바로 다음 줄은 일반 문장입니다\./);
  assert.equal((article.html.match(/<em\b/g) ?? []).length, 1);

  const statementFirst = formatArticles(`# 평서문 시작

처음에는 일반 문장으로 시작합니다.

뒤에서 질문해도 될까요?`).articles[0];
  assert.doesNotMatch(statementFirst.html, /<em\b/);
});

test("a numbered bundle drops its preamble, label, and plain title before styling the opening question at 16px", () => {
  const result = formatArticles(`최신 공개자료를 다시 확인했습니다. 아래는 각각 폰에서 따로 복사할 수 있게 나눴습니다.

1번 글

에버랜드 파이널 랩 타이어 굴리기 미션, 성공하면 선물? 위치·참여방법·기념품 정리

“에버랜드에서 실제 자동차 타이어를 굴리는 게임을 한다고요?”

맞습니다.

2번 글

두 번째 글 제목

“두 번째 체험도 바로 참여할 수 있나요?”

가능합니다.`);

  assert.equal(result.method, "label");
  assert.equal(result.articles.length, 2);
  assert.equal(
    result.articles[0].title,
    "에버랜드 파이널 랩 타이어 굴리기 미션, 성공하면 선물? 위치·참여방법·기념품 정리",
  );
  assert.doesNotMatch(result.articles[0].plainText, /최신 공개자료|1번 글|기념품 정리/);
  assert.match(
    result.articles[0].html,
    /^<p[^>]*><em style="font-style:italic;font-size:16px;">“에버랜드에서 실제 자동차 타이어를 굴리는 게임을 한다고요\?”<\/em><\/p>/,
  );
  assert.match(result.articles[0].plainText, /^“에버랜드에서 실제 자동차 타이어를 굴리는 게임을 한다고요\?”/);
  assert.doesNotMatch(result.articles[1].plainText, /2번 글|두 번째 글 제목/);
});

test("a single numbered article starts after its wrapper and plain title", () => {
  const result = formatArticles(`최신 공개자료를 다시 확인했습니다. 타이어 롤링 챌린지는 글로벌페어 광장에서 운영됩니다.

아래는 각각 폰에서 따로 복사할 수 있게 나눴습니다.

1번 글

에버랜드 파이널 랩 타이어 굴리기 미션, 성공하면 선물? 위치·참여방법·기념품 정리

“에버랜드에서 실제 자동차 타이어를 굴리는 게임을 한다고요?”

맞습니다.

파이널 랩에 새로운 체험이 하나 더 붙었습니다.

이름은 ‘타이어 롤링 챌린지’입니다.

방법도 단순합니다.`);
  const article = result.articles[0];

  assert.equal(result.method, "label");
  assert.equal(result.articles.length, 1);
  assert.equal(
    article.title,
    "에버랜드 파이널 랩 타이어 굴리기 미션, 성공하면 선물? 위치·참여방법·기념품 정리",
  );
  assert.ok(article.plainText.startsWith(
    `“에버랜드에서 실제 자동차 타이어를 굴리는 게임을 한다고요?”

맞습니다.

파이널 랩에 새로운 체험이 하나 더 붙었습니다.

이름은 ‘타이어 롤링 챌린지’입니다.

방법도 단순합니다.\n\n`,
  ));
  assert.match(article.plainText, /가장 헷갈렸던 조건이나 더 궁금한 내용이 더 있으신가요\?/);
  assert.match(
    article.plainText,
    /에버랜드 우리아이 놀이기구 찾기↓↓ 아래 링크 클릭\nhttps:\/\/onecalc\.kr\/calc\/everland-ride-passport\/\n\n---\n\n가장 헷갈렸던 조건이나/,
  );
  assert.doesNotMatch(article.html, /최신 공개자료|따로 복사|1번 글|기념품 정리/);
  assert.match(
    article.html,
    /^<p[^>]*><em style="font-style:italic;font-size:16px;">“에버랜드에서 실제 자동차 타이어를 굴리는 게임을 한다고요\?”<\/em><\/p>/,
  );
});

test("a lone numbered-label example inside an already titled article keeps the preceding body", () => {
  const article = formatArticles(`# 독서 기록

먼저 전체 글을 소개하는 실제 본문입니다.

1번 글

이 표현은 글 번호를 설명하는 본문 예시입니다.`).articles[0];

  assert.equal(article.title, "독서 기록");
  assert.match(article.plainText, /먼저 전체 글을 소개하는 실제 본문입니다/);
  assert.match(article.plainText, /1번 글/);
  assert.match(article.plainText, /글 번호를 설명하는 본문 예시입니다/);
});

test("a lone numbered-label example in an untitled article keeps substantive prefix paragraphs", () => {
  const article = formatArticles(`전체 맥락을 설명하는 실제 첫 문단입니다.

다음 예시를 살펴봅니다.

1번 글

“이 문구가 번호 예시로 보이나요?”

네, 본문 안 예시입니다.`).articles[0];

  assert.match(article.plainText, /전체 맥락을 설명하는 실제 첫 문단입니다/);
  assert.match(article.plainText, /다음 예시를 살펴봅니다/);
  assert.match(article.plainText, /1번 글/);
  assert.match(article.plainText, /이 문구가 번호 예시로 보이나요/);
});

test("a file-copy article with a lone numbered example is not mistaken for a GPT wrapper", () => {
  const article = formatArticles(`다음은 파일을 각각 따로 복사하는 방법을 정리했습니다.

이 과정은 백업 작업의 핵심입니다.

1번 글

“첫 번째 파일은 어디로 복사하나요?”

백업 폴더로 복사합니다.`).articles[0];

  assert.match(article.plainText, /파일을 각각 따로 복사하는 방법/);
  assert.match(article.plainText, /이 과정은 백업 작업의 핵심입니다/);
  assert.match(article.plainText, /1번 글/);
  assert.match(article.plainText, /첫 번째 파일은 어디로 복사하나요/);
});

test("wrapper-like text inside fenced code cannot discard a substantive prefix", () => {
  const article = formatArticles(`실제 본문 도입입니다.

\`\`\`txt
아래는 각각 폰에서 따로 복사할 수 있게 나눴습니다.
\`\`\`

1번 글

“이 번호 예시를 설명할까요?”

본문 예시입니다.`).articles[0];

  assert.match(article.plainText, /실제 본문 도입입니다/);
  assert.match(article.plainText, /아래는 각각 폰에서 따로 복사할 수 있게 나눴습니다/);
  assert.match(article.plainText, /1번 글/);
  assert.match(article.plainText, /이 번호 예시를 설명할까요/);
});

test("wrapper-like multi-backtick and unmatched inline code cannot trigger article trimming", () => {
  const wrapperText = "아래는 각각 폰에서 따로 복사할 수 있게 나눴습니다.";
  const inlineVariants = [`\`\`${wrapperText}\`\``, `\`${wrapperText}`];

  for (const inlineCode of inlineVariants) {
    const article = formatArticles(`실제 본문 도입입니다.

코드 예시는 ${inlineCode} 입니다.

1번 글

“이 번호 예시를 설명할까요?”

본문 예시입니다.`).articles[0];

    assert.match(article.plainText, /실제 본문 도입입니다/);
    assert.match(article.plainText, /1번 글/);
    assert.match(article.plainText, /이 번호 예시를 설명할까요/);
  }
});

test("a wrapper-like line inside a multiline code span cannot trigger article trimming", () => {
  const article = formatArticles(`실제 본문 도입입니다.

\`코드가 시작됩니다
아래는 각각 폰에서 따로 복사할 수 있게 나눴습니다.\`

1번 글

“이 번호 예시를 설명할까요?”

본문 예시입니다.`).articles[0];

  assert.match(article.plainText, /실제 본문 도입입니다/);
  assert.match(article.plainText, /1번 글/);
  assert.match(article.plainText, /이 번호 예시를 설명할까요/);
});

test("a question immediately after a bare article label remains as 16px italic body content", () => {
  const article = formatArticles(`### 1번 글

“제목 없이 바로 질문으로 시작해도 될까요?”

네. 이 질문은 본문이므로 반드시 남아야 합니다.`).articles[0];
  const payload = createCopyPayload(article);

  assert.match(article.bodySource, /^“제목 없이 바로 질문으로 시작해도 될까요\?”/);
  assert.match(
    payload.html,
    /<em style="font-style:italic;font-size:16px;">“제목 없이 바로 질문으로 시작해도 될까요\?”<\/em>/,
  );
  assert.match(payload.plainText, /^“제목 없이 바로 질문으로 시작해도 될까요\?”/);
});

test("consecutive opening statement and question lines remain one body paragraph after a bare label", () => {
  const result = formatArticles(`1번 글
오늘은 입장 전에 필요한 준비물을 정리합니다.
무엇을 먼저 챙겨야 할까요?
신분증을 챙기세요.

2번 글

두 번째 글 제목

“두 번째 질문인가요?”

네.`);
  const first = result.articles[0];

  assert.match(first.bodySource, /^오늘은 입장 전에 필요한 준비물을 정리합니다\./);
  assert.match(first.plainText, /^오늘은 입장 전에 필요한 준비물을 정리합니다\./);
  assert.match(first.plainText, /무엇을 먼저 챙겨야 할까요\?/);
  assert.doesNotMatch(first.html, /<em\b/);
});

test("image generation sections are removed from the body and copied separately", () => {
  const article = formatArticles(`# 이미지 분리

본문 첫 문장입니다.

## 이미지 생성 프롬프트

따뜻한 햇살이 드는 거실, 인물 없음
세로형 4:5, 자연스러운 사진 스타일

## 마무리

본문 마지막 문장입니다.`).articles[0];

  assert.equal(
    article.imagePrompt,
    "따뜻한 햇살이 드는 거실, 인물 없음\n세로형 4:5, 자연스러운 사진 스타일",
  );
  assert.doesNotMatch(article.plainText, /이미지 생성 프롬프트|따뜻한 햇살/);
  assert.match(article.plainText, /본문 첫 문장입니다/);
  assert.match(article.plainText, /마무리\n\n본문 마지막 문장입니다/);

  const payload = createImagePromptPayload(article);
  assert.equal(
    payload.plainText,
    "아래 이미지를 생성해주세요\n\n따뜻한 햇살이 드는 거실, 인물 없음\n세로형 4:5, 자연스러운 사진 스타일",
  );
  assert.match(payload.html, /아래 이미지를 생성해주세요/);
});

test("inline image prompts are separated without deleting ordinary text or fenced code", () => {
  const article = formatArticles(`# 이미지 경계

이미지를 생성하는 방법을 본문에서 설명합니다.

\`\`\`md
## 이미지 생성 프롬프트
코드 안 문구는 남습니다.
\`\`\`

이미지 생성 프롬프트: 푸른 하늘 아래 작은 흰색 집, 가로형 16:9

본문은 계속 남습니다.`).articles[0];

  assert.equal(article.imagePrompt, "푸른 하늘 아래 작은 흰색 집, 가로형 16:9");
  assert.match(article.plainText, /이미지를 생성하는 방법/);
  assert.match(article.plainText, /## 이미지 생성 프롬프트/);
  assert.match(article.plainText, /코드 안 문구는 남습니다/);
  assert.match(article.plainText, /본문은 계속 남습니다/);
  assert.doesNotMatch(article.plainText, /푸른 하늘 아래 작은 흰색 집/);
});

test("Everland articles keep the ride finder before hashtags and the final closing", () => {
  const article = formatArticles(`# 에버랜드 놀이기구 키 제한

아이와 탈 수 있는 시설을 정리합니다.

#에버랜드 #놀이기구`).articles[0];
  const footer = `에버랜드 우리아이 놀이기구 찾기↓↓ 아래 링크 클릭
https://onecalc.kr/calc/everland-ride-passport/`;

  const footerIndex = article.plainText.indexOf(footer);
  const hashtagIndex = article.plainText.indexOf("#에버랜드 #놀이기구");
  const dividerIndex = article.plainText.indexOf("---", hashtagIndex);
  const closingIndex = article.plainText.indexOf("가장 헷갈렸던 조건이나", dividerIndex);

  assert.ok(footerIndex >= 0);
  assert.ok(hashtagIndex > footerIndex);
  assert.ok(dividerIndex > hashtagIndex);
  assert.ok(closingIndex > dividerIndex);
  assert.ok(article.plainText.endsWith("마지막으로 글이 도움이 되셨다면 공감으로 알려주시면 감사하겠습니다.^^"));
  assert.match(
    article.html,
    /에버랜드 우리아이 놀이기구 찾기↓↓ 아래 링크 클릭.*<a href="https:\/\/onecalc\.kr\/calc\/everland-ride-passport\/"/s,
  );
});

test("a canonical Everland tail remains idempotent when formatted again", () => {
  const first = formatArticles(`# 에버랜드 준비물

본문입니다.

#에버랜드 #준비물`).articles[0];
  const second = formatArticles(`# ${first.title}\n\n${first.plainText}`).articles[0];
  const third = formatArticles(`# ${second.title}\n\n${second.plainText}`).articles[0];

  for (const article of [second, third]) {
    assert.equal((article.plainText.match(/에버랜드 우리아이 놀이기구 찾기/g) ?? []).length, 1);
    assert.equal((article.plainText.match(/everland-ride-passport/g) ?? []).length, 1);
    assert.equal((article.plainText.match(/^---$/gm) ?? []).length, 1);
    assert.equal((article.plainText.match(/더 궁금한 내용이 더 있으신가요\?/g) ?? []).length, 1);
  }
  assert.equal(second.plainText, first.plainText);
  assert.equal(third.plainText, first.plainText);
});

test("every article receives the same fixed engagement closing automatically", () => {
  const sources = [
    `# 생활 정보 정리\n\n오늘 알아둘 내용을 간단히 정리합니다.`,
    `# 가족 여행 체험 추천\n\n아이와 다녀온 장소를 소개합니다.`,
    `# 국민연금 가입기간 확인\n\n가입월수와 납부 공백을 확인합니다.`,
    `# 두 상품 비교와 추천\n\n장단점을 비교해 선택 기준을 정리합니다.`,
    `# 모바일 신청 방법\n\n화면에서 신청하는 순서를 설명합니다.`,
    `# 사고 피해자 지원 안내\n\n신청 절차와 상담 창구를 정리합니다.`,
  ];

  for (const source of sources) {
    const article = formatArticles(source).articles[0];
    assert.match(article.plainText, /가장 헷갈렸던 조건이나 더 궁금한 내용이 더 있으신가요\?/);
    assert.match(article.plainText, /댓글로 남겨주시면 다음 글에서 쉽게 정리해 보겠습니다\./);
    assert.match(article.plainText, /마지막으로 글이 도움이 되셨다면 공감으로 알려주시면 감사하겠습니다\.\^\^$/);
    assert.match(article.html, /<strong>가장 헷갈렸던 조건이나 더 궁금한 내용이 더 있으신가요\?<\/strong>/);
    assert.match(article.plainText, /---\n\n가장 헷갈렸던 조건이나/);
    assert.equal((article.html.match(/<hr /g) ?? []).length, 1);
    assert.equal(article.engagementCtaTopic, "universal");
  }
});

test("a different custom closing does not replace the required fixed closing", () => {
  const article = formatArticles(`# 직접 작성한 마무리

본문입니다.

여러분은 어떤 선택을 하시겠어요?

경험을 댓글로 남겨주세요.

도움이 되셨다면 공감 부탁드립니다.`).articles[0];

  assert.match(article.plainText, /가장 헷갈렸던 조건이나 더 궁금한 내용이 더 있으신가요\?/);
  assert.match(article.plainText, /댓글로 남겨주시면 다음 글에서 쉽게 정리해 보겠습니다/);
  assert.match(article.plainText, /마지막으로 글이 도움이 되셨다면 공감으로 알려주시면 감사하겠습니다\.\^\^/);
});

test("partial alternative closings still receive every required fixed sentence", () => {
  const questionOnly = formatArticles(`# 생활 안내

본문입니다.

여러분은 어떤 부분이 가장 궁금하신가요?`).articles[0];
  assert.equal((questionOnly.plainText.match(/여러분은 어떤 부분이 가장 궁금하신가요\?/g) ?? []).length, 1);
  assert.match(questionOnly.plainText, /가장 헷갈렸던 조건이나 더 궁금한 내용이 더 있으신가요/);
  assert.match(questionOnly.plainText, /댓글로 남겨주시면 다음 글에서 쉽게 정리해 보겠습니다/);
  assert.match(questionOnly.plainText, /공감으로 알려주시면 감사하겠습니다/);

  const commentOnly = formatArticles(`# 생활 안내

본문입니다.

궁금한 점은 댓글로 남겨주세요.`).articles[0];
  assert.match(commentOnly.plainText, /가장 헷갈렸던 조건이나 더 궁금한 내용이 더 있으신가요/);
  assert.match(commentOnly.plainText, /댓글로 남겨주시면 다음 글에서 쉽게 정리해 보겠습니다/);
  assert.match(commentOnly.plainText, /공감으로 알려주시면 감사하겠습니다/);
});

test("an existing generated finance question is not added twice", () => {
  const article = formatArticles(`# 국민연금 가입 조건

본문입니다.

가장 헷갈렸던 조건이나 더 궁금한 내용이 더 있으신가요?`).articles[0];

  assert.equal(
    (article.plainText.match(/가장 헷갈렸던 조건이나 더 궁금한 내용이 더 있으신가요\?/g) ?? []).length,
    1,
  );
  assert.equal(
    (article.html.match(/<strong>가장 헷갈렸던 조건이나 더 궁금한 내용이 더 있으신가요\?<\/strong>/g) ?? []).length,
    1,
  );
  assert.match(article.plainText, /댓글로 남겨주시면 다음 글에서 쉽게 정리해 보겠습니다/);
  assert.match(article.plainText, /공감으로 알려주시면 감사하겠습니다/);
});

test("an existing fixed comment is moved into the canonical closing order", () => {
  const article = formatArticles(`# 생활 안내

본문입니다.

댓글로 남겨주시면 다음 글에서 쉽게 정리해 보겠습니다.`).articles[0];
  const questionIndex = article.plainText.indexOf("가장 헷갈렸던 조건이나");
  const commentIndex = article.plainText.indexOf("댓글로 남겨주시면");
  const empathyIndex = article.plainText.indexOf("글이 도움이 되셨다면");

  assert.ok(questionIndex >= 0);
  assert.ok(commentIndex > questionIndex);
  assert.ok(empathyIndex > commentIndex);
  assert.equal((article.plainText.match(/댓글로 남겨주시면/g) ?? []).length, 1);
});

test("the previous fixed closing is replaced by the revised wording", () => {
  const article = formatArticles(`# 생활 안내

본문입니다.

가장 헷갈렸던 조건이나 더 궁금한 내용은 무엇인가요?

댓글로 남겨주시면 다음 글에서 쉽게 정리해 보겠습니다.

글이 도움이 되셨다면 공감으로 알려주시면 감사하겠습니다.`).articles[0];

  assert.doesNotMatch(article.plainText, /더 궁금한 내용은 무엇인가요/);
  assert.doesNotMatch(article.plainText, /^글이 도움이 되셨다면 공감/m);
  assert.match(article.plainText, /가장 헷갈렸던 조건이나 더 궁금한 내용이 더 있으신가요\?/);
  assert.match(article.plainText, /마지막으로 글이 도움이 되셨다면 공감으로 알려주시면 감사하겠습니다\.\^\^$/);
});

test("an already formatted hashtag-divider-closing tail remains one canonical article", () => {
  const formatted = formatArticles(`# 퇴직금 계산

본문입니다.

#퇴직금, #퇴직금1억원, #퇴직금IRP, #IRP

---

**가장 헷갈렸던 조건이나 더 궁금한 내용이 더 있으신가요?**

댓글로 남겨주시면 다음 글에서 쉽게 정리해 보겠습니다.

마지막으로 글이 도움이 되셨다면 공감으로 알려주시면 감사하겠습니다.^^`);
  const article = formatted.articles[0];
  const hashtagIndex = article.plainText.indexOf("#퇴직금, #퇴직금1억원");
  const dividerIndex = article.plainText.indexOf("---", hashtagIndex);
  const closingIndex = article.plainText.indexOf("가장 헷갈렸던 조건이나", dividerIndex);

  assert.equal(formatted.articles.length, 1);
  assert.equal((article.plainText.match(/^---$/gm) ?? []).length, 1);
  assert.equal((article.plainText.match(/더 궁금한 내용이 더 있으신가요\?/g) ?? []).length, 1);
  assert.ok(hashtagIndex >= 0 && dividerIndex > hashtagIndex && closingIndex > dividerIndex);
  assert.ok(article.plainText.endsWith("마지막으로 글이 도움이 되셨다면 공감으로 알려주시면 감사하겠습니다.^^"));
});

test("a long terminal hashtag block cannot hide an existing engagement closing", () => {
  const hashtags = Array.from({ length: 120 }, (_, index) => `#긴해시태그${index}`).join(" ");
  const article = formatArticles(`# 국민연금 가입 조건

본문입니다.

가장 헷갈렸던 조건이나 더 궁금한 내용이 더 있으신가요?

댓글로 남겨주시면 다음 글에서 쉽게 정리해 보겠습니다.

마지막으로 글이 도움이 되셨다면 공감으로 알려주시면 감사하겠습니다.^^

${hashtags}`).articles[0];

  assert.equal((article.plainText.match(/더 궁금한 내용이 더 있으신가요\?/g) ?? []).length, 1);
  assert.equal((article.plainText.match(/댓글로 남겨주시면/g) ?? []).length, 1);
  assert.equal((article.plainText.match(/공감으로 알려주시면/g) ?? []).length, 1);
  assert.match(article.plainText, new RegExp(`${hashtags}\n\n---\n\n가장 헷갈렸던 조건이나`));
  assert.ok(article.plainText.endsWith("마지막으로 글이 도움이 되셨다면 공감으로 알려주시면 감사하겠습니다.^^"));
});

test("engagement words inside code do not suppress the automatic closing", () => {
  const article = formatArticles(`# 코드 예시

본문입니다.

\`\`\`txt
가장 헷갈렸던 조건이나 더 궁금한 내용이 더 있으신가요?
댓글로 남겨주시면 다음 글에서 쉽게 정리해 보겠습니다.
마지막으로 글이 도움이 되셨다면 공감으로 알려주시면 감사하겠습니다.^^
\`\`\``).articles[0];

  assert.equal((article.plainText.match(/가장 헷갈렸던 조건이나 더 궁금한 내용이 더 있으신가요\?/g) ?? []).length, 2);
  assert.equal((article.plainText.match(/댓글/g) ?? []).length, 2);
});

test("the required Everland ride footer stays before the final divider and engagement closing", () => {
  const article = formatArticles(`# 에버랜드 가족 나들이

아이와 즐길 체험을 정리합니다.`).articles[0];
  const rideFooterIndex = article.plainText.indexOf("에버랜드 우리아이 놀이기구 찾기");
  const dividerIndex = article.plainText.indexOf("---", rideFooterIndex);
  const closingIndex = article.plainText.indexOf("가장 헷갈렸던 조건이나", dividerIndex);

  assert.ok(rideFooterIndex >= 0);
  assert.ok(dividerIndex > rideFooterIndex);
  assert.ok(closingIndex > dividerIndex);
  assert.ok(article.plainText.endsWith("마지막으로 글이 도움이 되셨다면 공감으로 알려주시면 감사하겠습니다.^^"));
});

test("terminal hashtags stay before the divider and engagement closing and outside image prompts", () => {
  const article = formatArticles(`# 에버랜드 준비물

아이와 방문할 때 필요한 내용을 정리합니다.

#에버랜드 #가족여행

## 이미지 생성 프롬프트

에버랜드 성을 배경으로 한 가족 실루엣`).articles[0];
  const rideFooterIndex = article.plainText.indexOf("에버랜드 우리아이 놀이기구 찾기");
  const hashtagsIndex = article.plainText.indexOf("#에버랜드 #가족여행");
  const dividerIndex = article.plainText.indexOf("---", hashtagsIndex);
  const closingIndex = article.plainText.indexOf("가장 헷갈렸던 조건이나", dividerIndex);

  assert.ok(rideFooterIndex >= 0);
  assert.ok(hashtagsIndex > rideFooterIndex);
  assert.ok(dividerIndex > hashtagsIndex);
  assert.ok(closingIndex > dividerIndex);
  assert.doesNotMatch(article.plainText, /가족 실루엣/);

  const imagePayload = createImagePromptPayload(article);
  assert.match(imagePayload.plainText, /가족 실루엣/);
  assert.doesNotMatch(imagePayload.plainText, /댓글|공감|가장 헷갈렸던 조건이나/);
});

test("sensitive posts also receive the required fixed closing", () => {
  const article = formatArticles(`# 사고 피해자 지원 안내

신청 절차와 상담 창구를 정리합니다.`).articles[0];

  assert.equal(article.engagementCtaAdded, true);
  assert.match(article.plainText, /가장 헷갈렸던 조건이나 더 궁금한 내용이 더 있으신가요\?/);
  assert.match(article.plainText, /댓글로 남겨주시면 다음 글에서 쉽게 정리해 보겠습니다/);
  assert.match(article.plainText, /공감으로 알려주시면 감사하겠습니다/);
});

test("hashtag-looking lines inside an unclosed fence stay in the code block", () => {
  const article = formatArticles(`# 코드 예시

본문입니다.

\`\`\`txt
#피해자 #추모`).articles[0];

  assert.match(article.html, /<pre[^>]*><code>#피해자 #추모<\/code><\/pre>/);
  assert.ok(article.plainText.indexOf("#피해자 #추모") < article.plainText.indexOf("가장 헷갈렸던 조건이나"));
});

test("fixed closing text inside multiline inline code is preserved", () => {
  for (const delimiter of ["`", "``"]) {
    const article = formatArticles(`# 코드 예시

코드는 ${delimiter}여기서 시작합니다
가장 헷갈렸던 조건이나 더 궁금한 내용이 더 있으신가요?
여기서 끝납니다${delimiter}`).articles[0];

    assert.equal(
      (article.plainText.match(/가장 헷갈렸던 조건이나 더 궁금한 내용이 더 있으신가요\?/g) ?? []).length,
      2,
      delimiter,
    );
  }
});

test("editing a title keeps the universal engagement closing", () => {
  const article = formatArticles(`# 생활 기록

본문입니다.`).articles[0];
  const rerendered = renderArticle({ ...article, title: "국민연금 수령 조건" });

  assert.match(rerendered.plainText, /가장 헷갈렸던 조건이나 더 궁금한 내용이 더 있으신가요\?/);
  assert.equal(rerendered.engagementCtaTopic, "universal");
});

test("Everland ride finder footer is not added to non-Everland posts or duplicated", () => {
  const ordinary = formatArticles(`# 아침 식사

간단한 메뉴를 소개합니다.`).articles[0];
  assert.doesNotMatch(ordinary.plainText, /everland-ride-passport/);

  const otherRide = formatArticles(`# 어린이 놀이기구 안내

지역 축제에서 아이가 탈 놀이기구를 소개합니다.`).articles[0];
  assert.doesNotMatch(otherRide.plainText, /everland-ride-passport/);

  const existing = formatArticles(`# 에버랜드 놀이 기구 안내

본문입니다.

에버랜드 우리아이 놀이기구 찾기↓↓ 아래 링크 클릭
https://onecalc.kr/calc/everland-ride-passport/`).articles[0];
  assert.equal((existing.plainText.match(/everland-ride-passport/g) ?? []).length, 1);
  assert.equal((existing.html.match(/href="https:\/\/onecalc\.kr\/calc\/everland-ride-passport\/"/g) ?? []).length, 1);
  assert.match(
    existing.plainText,
    /https:\/\/onecalc\.kr\/calc\/everland-ride-passport\/\n\n---\n\n가장 헷갈렸던 조건이나/,
  );

  const staleFooter = formatArticles(`# 일반 나들이 글

공원 준비물을 확인합니다.

에버랜드 우리아이 놀이기구 찾기↓↓ 아래 링크 클릭
https://onecalc.kr/calc/everland-ride-passport/`).articles[0];
  assert.doesNotMatch(staleFooter.plainText, /everland-ride-passport/);
});

test("Everland detection works in visible body text but ignores code-only mentions", () => {
  const visible = formatArticles(`# 가족 나들이

에버랜드에서 아이와 보낼 하루를 정리합니다.`).articles[0];
  assert.match(visible.plainText, /everland-ride-passport/);

  const codeOnly = formatArticles(`# 교육 활동

일반적인 예시를 설명합니다.

\`\`\`txt
에버랜드
\`\`\``).articles[0];
  assert.doesNotMatch(codeOnly.plainText, /everland-ride-passport/);

  const inlineCodeOnly = formatArticles(`# 일반 글

인라인 코드 예시는 \`에버랜드\`입니다.

## 이미지 생성 프롬프트

에버랜드 놀이공원의 야경`).articles[0];
  assert.doesNotMatch(inlineCodeOnly.plainText, /everland-ride-passport/);
  assert.equal(inlineCodeOnly.imagePrompt, "에버랜드 놀이공원의 야경");

  const multilineCodeOnly = formatArticles(`# 일반 글

여러 줄 코드 예시는 \`코드 시작
에버랜드
코드 끝\`입니다.`).articles[0];
  assert.doesNotMatch(multilineCodeOnly.plainText, /everland-ride-passport/);
});

test("ride footer follows a title edited after formatting", () => {
  const original = formatArticles(`# 가족 나들이

준비물을 정리합니다.`).articles[0];
  assert.doesNotMatch(original.plainText, /everland-ride-passport/);

  const added = renderArticle({ ...original, title: "에버랜드 방문 안내" });
  assert.match(added.plainText, /everland-ride-passport/);

  const titleOnlyEverland = formatArticles(`# 에버랜드 방문 안내

본문에는 관련 단어가 없습니다.`).articles[0];
  const removed = renderArticle({ ...titleOnlyEverland, title: "가족 나들이 안내" });
  assert.doesNotMatch(removed.plainText, /everland-ride-passport/);
});

test("body copy starts without a divider, excludes the title, and preserves the opening-question style", () => {
  const article = formatArticles(`# 복사 점검

“실제 타이어를 굴리는 게임을 한다고요?”

맞습니다.

**이름은 ‘타이어 롤링 챌린지’입니다.**`).articles[0];
  const payload = createCopyPayload(article);

  assert.match(payload.html, /^<p /);
  assert.equal((payload.html.match(/<hr /g) ?? []).length, 1);
  assert.doesNotMatch(payload.html, /<h1|복사 점검/);
  assert.match(payload.html, /<em[^>]*>“실제 타이어를 굴리는 게임을 한다고요\?”<\/em>/);
  assert.match(payload.html, /<strong>이름은 ‘타이어 롤링 챌린지’입니다\.<\/strong>/);
  assert.equal(payload.plainText, article.plainText);

  const titled = createCopyPayload(article, true);

  assert.match(titled.html, /^<h1[^>]*>복사 점검<\/h1>/);
  assert.equal(titled.plainText, `복사 점검\n\n${article.plainText}`);
  assert.deepEqual(createImagePromptPayload(article), { html: "", plainText: "" });
});

test("body copy removes an existing leading divider", () => {
  const article = formatArticles(`# 구분선 점검

## 1. 첫 번째 질문인가요?

A: 첫 번째 답변입니다.`).articles[0];
  const payload = createCopyPayload(article);

  assert.equal((payload.html.match(/<hr /g) ?? []).length, 1);
  assert.doesNotMatch(payload.html, /^<hr /);
});

test("body copy keeps later section dividers without adding one at the top", () => {
  const article = formatArticles(`# 중간 구분선 보존

“무엇을 먼저 확인할까요?”

기본 정보를 확인합니다.

## 1. 이용 조건은 무엇인가요?

A: 키와 연령을 확인합니다.

## 2. 준비물은 무엇인가요?

A: 편한 복장을 준비합니다.`).articles[0];
  const articleDividerCount = (article.html.match(/<hr /g) ?? []).length;
  const payload = createCopyPayload(article);

  assert.equal(articleDividerCount, 3);
  assert.equal((payload.html.match(/<hr /g) ?? []).length, articleDividerCount);
  assert.doesNotMatch(payload.html, /^<hr /);
});

test("numbered question lists remain lists unless followed by an A summary", () => {
  const listArticle = splitArticles(`# 질문 목록

1. 첫 번째 질문인가요?
2. 두 번째 질문인가요?`).articles[0];
  const listRendered = renderArticle(listArticle);

  assert.match(listRendered.html, /<ol/);
  assert.equal((listRendered.html.match(/<hr /g) ?? []).length, 1);

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

test("explicit calculation steps keep the requested mobile reading order", () => {
  const article = formatArticles(`# 퇴직소득 계산

1) 먼저 퇴직금 1억원에서 근속연수공제를 적용합니다.

20년 근속자의 근속연수공제는

1,500만원 + (20년 - 10년) × 250만원 = **4,000만원**입니다.

퇴직금 1억원에서 4,000만원을 빼면 6,000만원이 남습니다.

2) 여기에 다시 근속기간을 반영해 환산급여를 계산합니다.

6,000만원 × 12 ÷ 20년 = **3,600만원&#x20;**&#xC785;니다.`).articles[0];
  const payload = createCopyPayload(article);
  const blank = '<p style="margin:0;font-size:16px;line-height:1.8;color:#666666;"><br></p>';

  assert.doesNotMatch(payload.html, /<ol/);
  assert.match(payload.html, />1\) 먼저 퇴직금 1억원에서 근속연수공제를 적용합니다\.<\/p>/);
  assert.match(payload.html, />2\) 여기에 다시 근속기간을 반영해 환산급여를 계산합니다\.<\/p>/);
  assert.match(
    payload.html,
    new RegExp(`1,500만원 \\+ \\(20년 - 10년\\) × 250만원 = <strong>4,000만원</strong>입니다\\.</p>${blank}<p[^>]*>퇴직금 1억원에서`),
  );
  assert.match(payload.html, /6,000만원 × 12 ÷ 20년 = <strong>3,600만원<\/strong>입니다\./);
  assert.match(
    payload.plainText,
    /1\) 먼저 퇴직금 1억원에서 근속연수공제를 적용합니다\.\n\n20년 근속자의 근속연수공제는\n\n1,500만원 \+ \(20년 - 10년\) × 250만원 = 4,000만원입니다\.\n\n퇴직금 1억원에서 4,000만원을 빼면 6,000만원이 남습니다\.\n\n2\) 여기에 다시 근속기간을 반영해 환산급여를 계산합니다\.\n\n6,000만원 × 12 ÷ 20년 = 3,600만원입니다\./,
  );
});

test("a result sentence attached to a formula becomes one formula and one explanation", () => {
  const article = formatArticles(`# 연금소득공제

800만원 + (3,600만원 - 800만원) × 60%

\\= **2,480만원**을 공제합니다.`).articles[0];
  const payload = createCopyPayload(article);
  const blank = '<p style="margin:0;font-size:16px;line-height:1.8;color:#666666;"><br></p>';

  assert.match(
    payload.html,
    new RegExp(`800만원 \\+ \\(3,600만원 - 800만원\\) × 60% = <strong>2,480만원</strong></p>${blank}<p[^>]*>따라서 2,480만원을 공제합니다\\.</p>`),
  );
  assert.match(
    payload.plainText,
    /800만원 \+ \(3,600만원 - 800만원\) × 60% = 2,480만원\n\n따라서 2,480만원을 공제합니다\./,
  );
  assert.doesNotMatch(payload.plainText, /\\=/);
});

test("ordinary numbered instructions stay a list even when an equation follows", () => {
  const article = formatArticles(`# 계산기 사용법

1) 계산기를 엽니다.
2) 금액을 입력합니다.

참고 계산은 10 × 2 = 20입니다.`).articles[0];

  assert.match(article.html, /<ol[^>]*>.*계산기를 엽니다.*금액을 입력합니다/s);
  assert.doesNotMatch(article.html, />1\) 계산기를 엽니다\.<\/p>/);
  assert.match(article.plainText, /1\. 계산기를 엽니다\.\n2\. 금액을 입력합니다\./);
});

test("numbered formula examples and a next-screen instruction stay ordered lists", () => {
  const formulaItems = formatArticles(`# 계산 예시 목록

1. 예시 값은 10 + 2 = 12입니다.
2. 예시 값은 20 + 3 = 23입니다.`).articles[0];
  assert.match(formulaItems.html, /<ol[^>]*>.*10 \+ 2 = 12.*20 \+ 3 = 23.*<\/ol>/s);

  const nextInstruction = formatArticles(`# 화면 안내

1) 다음 화면으로 이동합니다.
2) 금액을 입력합니다.

참고 계산은 10 × 2 = 20입니다.`).articles[0];
  assert.match(nextInstruction.html, /<ol[^>]*>.*다음 화면으로 이동합니다.*금액을 입력합니다.*<\/ol>/s);
  assert.doesNotMatch(nextInstruction.html, />1\) 다음 화면으로 이동합니다\.<\/p>/);
});

test("same-line explicit calculation steps keep their parenthesized numbers", () => {
  const article = formatArticles(`# 같은 줄 계산 단계

1) 먼저 10만원 × 12개월 = 120만원을 계산합니다.
2) 여기에 20만원을 더해 120만원 + 20만원 = 140만원을 계산합니다.`).articles[0];

  assert.doesNotMatch(article.html, /<ol/);
  assert.match(article.html, />1\) 먼저 10만원 × 12개월 = 120만원을 계산합니다\.<\/p>/);
  assert.match(article.html, />2\) 여기에 20만원을 더해 120만원 \+ 20만원 = 140만원을 계산합니다\.<\/p>/);
  assert.match(article.plainText, /1\) 먼저 10만원 × 12개월 = 120만원을 계산합니다\.\n\n2\) 여기에/);
});

test("inline code formulas never promote nearby instructions into calculation steps", () => {
  for (const codeLine of [
    "예시는 `10 * 2 = 20`입니다.",
    "예시는 ``10 * 2 = 20``입니다.",
  ]) {
    const article = formatArticles(`# 코드 안내

1) 먼저 설정값을 확인합니다.

${codeLine}`).articles[0];
    assert.match(article.html, /<ol[^>]*>.*먼저 설정값을 확인합니다.*<\/ol>/s, codeLine);
    assert.doesNotMatch(article.html, />1\) 먼저 설정값을 확인합니다\.<\/p>/, codeLine);
  }

  const multiline = formatArticles(`# 여러 줄 코드 안내

1) 먼저 설정값을 확인합니다.

예시는 \`10 *
2 = 20\`입니다.`).articles[0];
  assert.match(multiline.html, /<ol[^>]*>.*먼저 설정값을 확인합니다.*<\/ol>/s);
  assert.doesNotMatch(multiline.html, />1\) 먼저 설정값을 확인합니다\.<\/p>/);
});

test("two-line calculations preserve inline code on the result line", () => {
  const article = formatArticles(`# 계산 주석 보존

800만원 + 200만원

\\= **1,000만원**을 공제합니다. \`원문 주석\``).articles[0];

  assert.match(article.html, /800만원 \+ 200만원 = <strong>1,000만원<\/strong>/);
  assert.match(article.html, /따라서 1,000만원을 공제합니다\. <code[^>]*>원문 주석<\/code>/);
  assert.match(article.plainText, /따라서 1,000만원을 공제합니다\. 원문 주석/);
});

test("equations inside quotes, code, and tables keep their original block type", () => {
  const article = formatArticles(`# 계산식 예외

> 인용 계산은 10 × 2 = 20입니다.

\`10 * 2 = 20\`

| 구분 | 계산식 |
| --- | --- |
| 예시 | 10 × 2 = 20 |`).articles[0];

  assert.match(article.html, /<blockquote[^>]*>인용 계산은 10 × 2 = 20입니다\.<\/blockquote>/);
  assert.match(article.html, /<code[^>]*>10 \* 2 = 20<\/code>/);
  assert.equal(article.tableCount, 1);
  assert.match(article.html, /<td[^>]*>10 × 2 = 20<\/td>/);
});

test("decoded numeric entities are escaped before rendering", () => {
  const article = formatArticles(`# 엔티티 안전성

&#x3C;img src=x onerror=alert(1)&#x3E;

10 × 2 = **20&#x20;**입니다.`).articles[0];

  assert.doesNotMatch(article.html, /<img\b/i);
  assert.match(article.html, /&lt;img src=x onerror&#61;alert\(1\)&gt;/);
  assert.match(article.html, /10 × 2 = <strong>20<\/strong>입니다\./);
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
