import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ArticleImagePromptPanel } from "../components/article-image-prompt-panel.mjs";
import { createImagePromptPayload, formatArticles } from "../lib/formatter.mjs";

test("every formatted article has a usable image request payload even without a prompt", () => {
  const input = Array.from({ length: 5 }, (_, index) => [
    `# 테스트 글 ${index + 1}`,
    "",
    `${index + 1}번째 본문입니다.`,
  ].join("\n")).join("\n\n---\n\n");
  const result = formatArticles(input);
  const payloads = result.articles.map((article) => createImagePromptPayload(article));

  assert.equal(result.articles.length, 5);
  assert.equal(payloads.length, 5);
  for (const payload of payloads) {
    assert.equal(payload.plainText, "아래 이미지를 생성해주세요");
    assert.match(payload.html, /<strong>아래 이미지를 생성해주세요<\/strong>/);
  }
});

test("five article cards render five identifiable image prompt panels", () => {
  const articles = Array.from({ length: 5 }, (_, index) => ({
    id: `article-${index + 1}`,
    title: `테스트 글 ${index + 1}`,
    imagePrompt: index === 0 ? "첫 번째 글 대표 이미지" : "",
  }));
  const markup = renderToStaticMarkup(createElement(
    "section",
    null,
    ...articles.map((article, index) => createElement(ArticleImagePromptPanel, {
      article,
      index,
      key: article.id,
      onCopy() {},
    })),
  ));

  assert.equal((markup.match(/data-image-prompt-panel=/g) ?? []).length, 5);
  assert.equal((markup.match(/아래 이미지를 생성해주세요/g) ?? []).length, 5);
  assert.equal((markup.match(/이미지 요청 복사/g) ?? []).length, 10);
  assert.equal((markup.match(/이미지 설명 없음 · 위 문구만 복사됩니다\./g) ?? []).length, 4);
  assert.match(markup, /첫 번째 글 대표 이미지/);
  for (let index = 1; index <= 5; index += 1) {
    assert.match(markup, new RegExp(`${index}번째 글 테스트 글 ${index} 이미지 요청 복사`));
  }
});

test("a thumbnail generation section is rendered inside the separate image request panel", () => {
  const article = formatArticles(`# 여행 글

여행 준비 본문입니다.

### 썸네일 생성 프롬프트

노을 진 바다와 여행 가방을 함께 보여주는 이미지.`).articles[0];
  const markup = renderToStaticMarkup(createElement(ArticleImagePromptPanel, {
    article,
    index: 0,
    onCopy() {},
  }));

  assert.match(markup, /아래 이미지를 생성해주세요/);
  assert.match(markup, /노을 진 바다와 여행 가방을 함께 보여주는 이미지/);
  assert.doesNotMatch(markup, /이미지 설명 없음/);
  assert.doesNotMatch(article.plainText, /썸네일 생성 프롬프트|노을 진 바다/);
});
