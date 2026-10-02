import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_COMPARISON_LENGTH,
  MAX_DIFFERENCE_SAMPLES,
  compareArticleFormatting,
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

test("word-spacing-only changes do not create false rich formatting differences", () => {
  const result = comparePublishedArticle("이렇게 할 수 있습니다.", "이렇게 할수 있습니다.", {
    expectedHtml: '<p style="font-size:15px;">이렇게 할 수 있습니다.</p>',
    actualHtml: '<p style="font-size:15px;">이렇게 할수 있습니다.</p>',
  });

  assert.equal(result.status, "formatting-only");
  assert.equal(result.formatting.status, "match");
  assert.equal(result.formatting.score, 100);
});

test("rich clipboard HTML compares font size and every supported format signal", () => {
  const expectedHtml = `<p style="font-size:15px;line-height:1.8;text-align:left;"><em style="font-size:16px;font-style:italic;">질문</em></p>
    <p style="font-size:15px;"><strong>답변</strong></p>
    <ol><li>항목</li></ol><hr>
    <table><thead><tr><th style="background-color:#f7f7f7;text-align:center;">제목</th></tr></thead><tbody><tr><td>내용</td></tr></tbody></table>
    <a href="https://example.com">링크</a>`;
  const result = compareArticleFormatting(expectedHtml, expectedHtml);

  assert.equal(result.status, "match");
  assert.equal(result.score, 100);
  assert.ok(result.checks.length >= 10);
  assert.ok(result.checks.every((check) => check.matched));
  assert.ok(result.checks.some((check) => check.key === "font-size" && check.expected.includes("15px")));
});

test("rich clipboard HTML reports font, emphasis, table, divider, and link differences", () => {
  const expectedHtml = `<p style="font-size:15px;line-height:1.8;"><em>질문</em></p><p><strong>답변</strong></p><hr><table><tr><th style="background-color:#f7f7f7;">제목</th></tr><tr><td>내용</td></tr></table><a href="https://example.com">링크</a>`;
  const actualHtml = `<p style="font-size:19px;line-height:2;">질문</p><p>답변</p>`;
  const result = compareArticleFormatting(expectedHtml, actualHtml);
  const mismatches = result.checks.filter((check) => !check.matched).map((check) => check.key);

  assert.equal(result.status, "different");
  assert.ok(result.score < 100);
  assert.ok(mismatches.includes("font-size"));
  assert.ok(mismatches.includes("italic"));
  assert.ok(mismatches.includes("bold"));
  assert.ok(mismatches.includes("table"));
  assert.ok(mismatches.includes("divider"));
  assert.ok(mismatches.includes("link"));
});

test("equivalent emphasis tags and normalized CSS units compare equally", () => {
  const expectedHtml = '<p style="font-size:16px;color:#fff;"><strong>굵게</strong><em>기울임</em></p>';
  const actualHtml = '<p style="font-size:12pt;color:rgb(255,255,255);"><b>굵게</b><i>기울임</i></p>';
  const result = compareArticleFormatting(expectedHtml, actualHtml);

  assert.equal(result.status, "match");
  assert.equal(result.score, 100);
});

test("formatting moved to different words is reported even when global counts match", () => {
  const result = compareArticleFormatting(
    "<p><strong>첫째</strong> 둘째</p>",
    "<p>첫째 <strong>둘째</strong></p>",
  );
  const boldCheck = result.checks.find((check) => check.key === "bold");

  assert.equal(result.status, "different");
  assert.equal(boldCheck.expected, boldCheck.actual);
  assert.equal(boldCheck.matched, false);
});

test("equivalent formatting split across wrappers does not create a false difference", () => {
  const result = compareArticleFormatting(
    "<p><strong>첫째 둘째</strong></p>",
    "<p><strong>첫째</strong> <strong>둘째</strong></p>",
  );
  const boldCheck = result.checks.find((check) => check.key === "bold");

  assert.equal(result.status, "match");
  assert.equal(boldCheck.matched, true);
  assert.equal(boldCheck.expected, "적용 결과 같음");
  assert.equal(boldCheck.actual, "적용 결과 같음");
});

test("a link moved to different text is reported even when the href and count match", () => {
  const result = compareArticleFormatting(
    '<p><a href="https://example.com">첫째</a> 둘째</p>',
    '<p>첫째 <a href="https://example.com">둘째</a></p>',
  );
  const linkCheck = result.checks.find((check) => check.key === "link");

  assert.equal(linkCheck.expected, linkCheck.actual);
  assert.equal(linkCheck.matched, false);
});

test("clipboard scripts and style blocks are ignored rather than interpreted as article formatting", () => {
  const clean = '<p style="font-size:15px;">안전한 본문</p>';
  const untrusted = `${clean}<style>p{font-size:99px}</style><script>document.body.innerHTML="위험"</script>`;
  const result = compareArticleFormatting(clean, untrusted);

  assert.equal(result.status, "match");
  assert.equal(result.score, 100);
});

test("large unclosed ignored HTML blocks are stripped in bounded time", () => {
  const attack = "<!--".repeat(100_000);
  const startedAt = performance.now();
  const result = compareArticleFormatting("<p>안전한 본문</p>", attack);
  const elapsed = performance.now() - startedAt;

  assert.equal(result.status, "unavailable");
  assert.ok(elapsed < 1_500, `ignored HTML stripping took ${elapsed.toFixed(0)}ms`);
});

test("mismatched closing tags are handled in linear time", () => {
  const attack = `${"<a>".repeat(16_000)}${"</z>".repeat(16_000)}`;
  const startedAt = performance.now();
  compareArticleFormatting("<p>안전한 본문</p>", attack);
  const elapsed = performance.now() - startedAt;

  assert.ok(elapsed < 1_500, `mismatched tags took ${elapsed.toFixed(0)}ms`);
});

test("excessive visible HTML complexity is rejected in bounded time", () => {
  const attack = "!".repeat(500_000);
  const startedAt = performance.now();
  const result = compareArticleFormatting("<p>안전한 본문</p>", attack);
  const elapsed = performance.now() - startedAt;

  assert.equal(result.status, "unavailable");
  assert.match(result.summary, /너무 복잡/);
  assert.ok(elapsed < 1_500, `complex HTML took ${elapsed.toFixed(0)}ms`);
});

test("text can match while missing rich clipboard data is clearly marked as not checked", () => {
  const text = "같은 본문입니다.";
  const result = comparePublishedArticle(text, text, {
    expectedHtml: `<p style="font-size:15px;">${text}</p>`,
    actualHtml: "",
  });

  assert.equal(result.status, "match");
  assert.equal(result.score, 100);
  assert.equal(result.formatting.status, "unavailable");
  assert.equal(result.formatting.score, null);
  assert.deepEqual(result.issues, []);
});

test("matching text and rich formatting report separate perfect scores", () => {
  const text = "같은 본문입니다.";
  const html = `<p style="font-size:15px;line-height:1.8;">${text}</p>`;
  const result = comparePublishedArticle(text, text, { expectedHtml: html, actualHtml: html });

  assert.equal(result.status, "match");
  assert.equal(result.score, 100);
  assert.equal(result.formatting.status, "match");
  assert.equal(result.formatting.score, 100);
});

test("an optional copied title is removed from text and HTML before comparison", () => {
  const title = "복사된 제목";
  const text = "같은 본문입니다.";
  const result = comparePublishedArticle(text, `${title}\n\n${text}`, {
    title,
    expectedHtml: `<p style="font-size:15px;">${text}</p>`,
    actualHtml: `<h1 style="font-size:32px;">${title}</h1><p style="font-size:15px;">${text}</p>`,
  });

  assert.equal(result.status, "match");
  assert.equal(result.score, 100);
  assert.equal(result.formatting.status, "match");
  assert.equal(result.formatting.score, 100);
});

test("matching text with changed rich formatting reports formatting-only", () => {
  const text = "같은 본문입니다.";
  const result = comparePublishedArticle(text, text, {
    expectedHtml: `<p style="font-size:15px;"><strong>${text}</strong></p>`,
    actualHtml: `<p style="font-size:19px;">${text}</p>`,
  });

  assert.equal(result.status, "formatting-only");
  assert.equal(result.score, 100);
  assert.equal(result.formatting.status, "different");
  assert.ok(result.formatting.checks.some((check) => check.key === "font-size" && !check.matched));
  assert.ok(result.formatting.checks.some((check) => check.key === "bold" && !check.matched));
});

test("content differences do not turn identical global formatting into false format differences", () => {
  const result = comparePublishedArticle("첫째 둘째", "완전히 다른 본문", {
    expectedHtml: '<p style="font-size:15px;">첫째 둘째</p>',
    actualHtml: '<p style="font-size:15px;">완전히 다른 본문</p>',
  });

  assert.equal(result.status, "different");
  assert.equal(result.formatting.status, "match");
  assert.equal(result.formatting.score, 100);
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
