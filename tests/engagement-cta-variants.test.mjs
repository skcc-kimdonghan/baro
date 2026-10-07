import test from "node:test";
import assert from "node:assert/strict";

import {
  ARTICLE_BUNDLE_STORAGE_KEY,
  createArticleBundle,
  hasArticleBundleWorkspaceChanges,
  loadArticleBundles,
  saveArticleBundles,
} from "../lib/article-bundles.mjs";
import { createCopyPayload, formatArticles } from "../lib/formatter.mjs";

const INFORMATION_CLOSING = Object.freeze([
  "가장 헷갈렸던 조건이나 더 궁금한 내용이 더 있으신가요?",
  "댓글로 남겨주시면 다음 글에서 쉽게 정리해 보겠습니다.",
  "마지막으로 글이 도움이 되셨다면 공감으로 알려주시면 감사하겠습니다.^^",
]);

const ADVERTISEMENT_CLOSING = Object.freeze([
  "준비물은 많이 챙기는 것보다 내 일정에 필요한 것만 고르는 게 더 중요합니다.",
  "직접 써보니 유용했던 물건이나 굳이 필요 없었던 준비물이 있다면 댓글로 알려주세요.",
  "다른 분들이 준비할 때 참고할 수 있도록 다음 글에서도 함께 정리해 보겠습니다.",
  "글이 도움이 되셨다면 공감으로 알려주시면 감사하겠습니다.^^",
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("information articles keep the existing closing when no article type is selected", () => {
  const article = formatArticles(`# 국민연금 가입기간 확인

가입월수와 납부 공백을 확인합니다.`).articles[0];

  for (const paragraph of INFORMATION_CLOSING) assert.match(article.plainText, new RegExp(escapeRegExp(paragraph)));
  for (const paragraph of ADVERTISEMENT_CLOSING.slice(0, 3)) assert.doesNotMatch(article.plainText, new RegExp(escapeRegExp(paragraph)));
  assert.equal(article.engagementCtaTopic, "universal");
});

test("advertisement article bundles receive the advertising closing on every article", () => {
  const result = formatArticles(`# 여행 준비물 추천

여행할 때 필요한 준비물을 정리합니다.

---

# 캠핑 준비물 추천

캠핑 일정에 맞는 준비물을 소개합니다.`, { articleType: "advertisement" });

  assert.equal(result.articles.length, 2);
  for (const article of result.articles) {
    const expectedClosing = ADVERTISEMENT_CLOSING.map(escapeRegExp).join("\\n\\n");
    assert.match(article.plainText, new RegExp(`---\\n\\n${expectedClosing}$`));
    assert.doesNotMatch(article.plainText, /가장 헷갈렸던 조건이나/);
    assert.doesNotMatch(article.plainText, /댓글로 남겨주시면 다음 글에서 쉽게 정리해 보겠습니다/);
    assert.equal(article.engagementCtaAdded, true);
    assert.equal(article.engagementCtaTopic, "advertisement");
  }
});

test("the advertising closing uses 15px paragraphs and only the requested 19px emphasis", () => {
  const article = formatArticles(`# 여행 준비물 추천

일정에 맞춰 필요한 물건을 고릅니다.`, { articleType: "advertisement" }).articles[0];
  const copyPayload = createCopyPayload(article);

  for (const html of [article.html, copyPayload.html]) {
    assert.match(
      html,
      /<p style="[^"]*font-size:15px;[^"]*">준비물은 많이 챙기는 것보다 <strong style="font-size:19px;">내 일정에 필요한 것만 고르는 게 더 중요<\/strong>합니다\.<\/p>/,
    );
    assert.match(
      html,
      /<p style="[^"]*font-size:15px;[^"]*">직접 써보니 유용했던 물건이나 굳이 필요 없었던 준비물이 있다면 댓글로 알려주세요\.<\/p>/,
    );
    assert.match(
      html,
      /<p style="[^"]*font-size:15px;[^"]*">다른 분들이 준비할 때 참고할 수 있도록 다음 글에서도 함께 정리해 보겠습니다\.<\/p>/,
    );
    assert.match(
      html,
      /<p style="[^"]*font-size:15px;[^"]*">글이 도움이 되셨다면 <strong style="font-size:19px;">공감으로 알려주시면 감사<\/strong>하겠습니다\.\^\^<\/p>/,
    );
    assert.equal((html.match(/<strong style="font-size:19px;">/g) ?? []).length, 2);
    assert.doesNotMatch(html, /<strong style="font-size:19px;">(?:준비물은|직접 써보니|다른 분들이)/);
  }
  assert.equal(copyPayload.plainText, article.plainText);
  assert.doesNotMatch(copyPayload.plainText, /\*\*|__/);
});

test("reformatting an advertising article replaces old closing variants without duplication", () => {
  const sourceWithInformationClosing = `# 여행 준비물 추천

본문입니다.

---

${INFORMATION_CLOSING.join("\n\n")}`;
  const first = formatArticles(sourceWithInformationClosing, { articleType: "advertisement" }).articles[0];
  const second = formatArticles(`# ${first.title}\n\n${first.plainText}`, { articleType: "advertisement" }).articles[0];

  for (const article of [first, second]) {
    for (const paragraph of ADVERTISEMENT_CLOSING) {
      assert.equal(article.plainText.split(paragraph).length - 1, 1);
    }
    for (const paragraph of INFORMATION_CLOSING.slice(0, 2)) {
      assert.equal(article.plainText.split(paragraph).length - 1, 0);
    }
    assert.equal((article.plainText.match(/^---$/gm) ?? []).length, 1);
  }
  assert.equal(second.plainText, first.plainText);
});

test("switching an advertising article back to information removes the advertising closing", () => {
  const sourceWithAdvertisementClosing = `# 여행 준비물 추천

본문입니다.

---

${ADVERTISEMENT_CLOSING.join("\n\n")}`;
  const first = formatArticles(sourceWithAdvertisementClosing, { articleType: "information" }).articles[0];
  const second = formatArticles(`# ${first.title}\n\n${first.plainText}`, { articleType: "information" }).articles[0];

  for (const article of [first, second]) {
    for (const paragraph of INFORMATION_CLOSING) {
      assert.equal(article.plainText.split(paragraph).length - 1, 1);
    }
    for (const paragraph of ADVERTISEMENT_CLOSING.slice(0, 3)) {
      assert.equal(article.plainText.split(paragraph).length - 1, 0);
    }
    assert.equal((article.plainText.match(/^---$/gm) ?? []).length, 1);
  }
  assert.equal(second.plainText, first.plainText);
});

test("Markdown hard breaks and partial emphasis do not duplicate an existing advertising closing", () => {
  const source = `# 여행 준비물 추천

본문입니다.

---

준비물은 많이 챙기는 것보다 **내 일정에 필요한 것만 고르는 게 더 중요합니다.**\\
직접 써보니 유용했던 물건이나 굳이 필요 없었던 준비물이 있다면 댓글로 알려주세요.\\
다른 분들이 준비할 때 참고할 수 있도록 다음 글에서도 함께 정리해 보겠습니다.\\
글이 도움이 되셨다면 **공감으로 알려주시면 감사하겠습니다.^^**`;
  const article = formatArticles(source, { articleType: "advertisement" }).articles[0];

  for (const paragraph of ADVERTISEMENT_CLOSING) {
    assert.equal(article.plainText.split(paragraph).length - 1, 1);
  }
  assert.equal((article.plainText.match(/^---$/gm) ?? []).length, 1);
  assert.doesNotMatch(article.plainText, /\\$|\*\*|__/m);
});

test("saved article bundles preserve their selected article type and legacy bundles default to information", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const common = {
    id: "bundle-advertisement",
    sourceText: "# 여행 준비물 추천\n\n본문입니다.",
    headerColor: "#F7F7F7",
    articleTitles: ["여행 준비물 추천"],
    createdAt: "2026-10-07T01:00:00.000Z",
    updatedAt: "2026-10-07T01:00:00.000Z",
  };
  const advertisement = createArticleBundle({ ...common, articleType: "advertisement" });
  const information = createArticleBundle({ ...common, id: "bundle-legacy" });

  const saved = saveArticleBundles(storage, [advertisement, information]);
  const loaded = loadArticleBundles(storage).entries;

  assert.equal(advertisement.articleType, "advertisement");
  assert.equal(information.articleType, "information");
  assert.equal(saved.find((entry) => entry.id === advertisement.id)?.articleType, "advertisement");
  assert.equal(loaded.find((entry) => entry.id === advertisement.id)?.articleType, "advertisement");
  assert.equal(loaded.find((entry) => entry.id === information.id)?.articleType, "information");
  assert.ok(values.has(ARTICLE_BUNDLE_STORAGE_KEY));
  assert.equal(
    hasArticleBundleWorkspaceChanges(advertisement, {
      sourceText: advertisement.sourceText,
      headerColor: advertisement.headerColor,
      articleTitles: advertisement.articleTitles,
      articleType: "information",
      hasPublicationWork: false,
    }),
    true,
  );
  assert.throws(
    () => createArticleBundle({ ...common, id: "bundle-invalid", articleType: "promotion" }),
    (error) => error instanceof Error && error.code === "INVALID_ARTICLE_BUNDLE",
  );
});
