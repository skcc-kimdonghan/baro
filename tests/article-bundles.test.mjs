import test from "node:test";
import assert from "node:assert/strict";

import {
  ARTICLE_BUNDLE_STORAGE_KEY,
  MAX_ARTICLE_BUNDLE_CHARACTERS,
  MAX_ARTICLE_BUNDLE_ENTRIES,
  clearArticleBundles,
  createArticleBundle,
  createArticleBundleId,
  hasArticleBundleWorkspaceChanges,
  loadArticleBundles,
  removeArticleBundle,
  saveArticleBundles,
  upsertArticleBundle,
} from "../lib/article-bundles.mjs";

class FakeStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
    this.failRead = false;
    this.failWrite = false;
  }

  getItem(key) {
    if (this.failRead) throw new Error("read blocked");
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    if (this.failWrite) throw new Error("quota exceeded");
    this.values.set(key, value);
  }

  removeItem(key) {
    if (this.failWrite) throw new Error("remove blocked");
    this.values.delete(key);
  }
}

function bundle(overrides = {}) {
  return createArticleBundle({
    id: "bundle-1",
    sourceText: "1편: 첫 글\n본문\n\n2편: 둘째 글\n본문",
    headerColor: "#F7F7F7",
    articleTitles: ["첫 글", "둘째 글"],
    createdAt: "2026-09-23T01:00:00.000Z",
    updatedAt: "2026-09-23T01:00:00.000Z",
    ...overrides,
  });
}

test("article bundles save, load, and list newest updates first", () => {
  const storage = new FakeStorage();
  const older = bundle();
  const newer = bundle({
    id: "bundle-2",
    sourceText: "새 글",
    articleTitles: ["새 글"],
    createdAt: "2026-09-23T02:00:00.000Z",
    updatedAt: "2026-09-23T02:00:00.000Z",
  });

  const saved = saveArticleBundles(storage, [older, newer]);
  const loaded = loadArticleBundles(storage);

  assert.deepEqual(saved.map((entry) => entry.id), ["bundle-2", "bundle-1"]);
  assert.deepEqual(loaded.entries, saved);
  assert.equal(loaded.warning, "");
  assert.equal(saved[1].displayTitle, "첫 글 외 1편");
  assert.ok(Object.isFrozen(saved));
  assert.ok(Object.isFrozen(saved[0]));
});

test("the same pasted bundle receives a stable content id", () => {
  assert.equal(createArticleBundleId("같은 원고"), createArticleBundleId("같은 원고"));
  assert.equal(createArticleBundleId("첫 줄\r\n둘째 줄"), createArticleBundleId("첫 줄\n둘째 줄"));
  assert.notEqual(createArticleBundleId("같은 원고"), createArticleBundleId("다른 원고"));
});

test("upsert updates an existing bundle without duplicating it or changing its creation time", () => {
  const original = Object.freeze([bundle()]);
  const updated = upsertArticleBundle(original, bundle({
    articleTitles: ["수정된 제목", "둘째 글"],
    updatedAt: "2026-09-23T03:00:00.000Z",
  }));

  assert.equal(original[0].articleTitles[0], "첫 글");
  assert.equal(updated.length, 1);
  assert.equal(updated[0].articleTitles[0], "수정된 제목");
  assert.equal(updated[0].createdAt, original[0].createdAt);
});

test("upsert keeps timestamps monotonic when a future-clock bundle is updated later", () => {
  const future = bundle({
    createdAt: "2036-01-01T00:00:00.000Z",
    updatedAt: "2036-01-01T00:00:00.000Z",
  });
  const updated = upsertArticleBundle([future], {
    ...future,
    articleTitles: ["정상 시계에서 수정한 제목", "둘째 글"],
    updatedAt: "2026-09-23T03:00:00.000Z",
  });

  assert.equal(updated[0].articleTitles[0], "정상 시계에서 수정한 제목");
  assert.equal(updated[0].createdAt, future.createdAt);
  assert.equal(updated[0].updatedAt, future.updatedAt);
});

test("a newly saved bundle survives pruning even when existing timestamps are in the future", () => {
  const storage = new FakeStorage();
  const futureEntries = Array.from({ length: MAX_ARTICLE_BUNDLE_ENTRIES }, (_, index) => bundle({
    id: `future-${index}`,
    sourceText: `미래 글 ${index}`,
    articleTitles: [`미래 글 ${index}`],
    createdAt: new Date(Date.UTC(2036, 0, 1, 0, index)).toISOString(),
    updatedAt: new Date(Date.UTC(2036, 0, 1, 0, index)).toISOString(),
  }));
  const target = bundle({
    id: "current-save",
    sourceText: "지금 저장한 글",
    articleTitles: ["지금 저장한 글"],
  });

  const nextEntries = upsertArticleBundle(futureEntries, target);
  const saved = saveArticleBundles(storage, nextEntries, target.id);

  assert.equal(saved.length, MAX_ARTICLE_BUNDLE_ENTRIES);
  assert.ok(saved.some((entry) => entry.id === target.id));
  assert.ok(loadArticleBundles(storage).entries.some((entry) => entry.id === target.id));
});

test("reopening confirms when the same source has edited output or publication work", () => {
  const saved = bundle();
  const pristineWorkspace = {
    sourceText: saved.sourceText,
    headerColor: saved.headerColor,
    articleTitles: saved.articleTitles,
    hasPublicationWork: false,
  };

  assert.equal(hasArticleBundleWorkspaceChanges(saved, pristineWorkspace), false);
  assert.equal(hasArticleBundleWorkspaceChanges(saved, { ...pristineWorkspace, headerColor: "#DFF7E8" }), true);
  assert.equal(hasArticleBundleWorkspaceChanges(saved, {
    ...pristineWorkspace,
    articleTitles: ["수정한 제목", "둘째 글"],
  }), true);
  assert.equal(hasArticleBundleWorkspaceChanges(saved, { ...pristineWorkspace, hasPublicationWork: true }), true);
  assert.equal(hasArticleBundleWorkspaceChanges(saved, { ...pristineWorkspace, sourceText: "다른 원고" }), true);
});

test("invalid and corrupt saved bundles are ignored with recoverable warnings", () => {
  const corrupt = new FakeStorage({ [ARTICLE_BUNDLE_STORAGE_KEY]: "{broken" });
  const wrongRoot = new FakeStorage({ [ARTICLE_BUNDLE_STORAGE_KEY]: JSON.stringify({ entries: [] }) });
  const oversized = new FakeStorage({ [ARTICLE_BUNDLE_STORAGE_KEY]: "x".repeat(1_250_001) });
  const mixed = new FakeStorage({
    [ARTICLE_BUNDLE_STORAGE_KEY]: JSON.stringify([
      bundle(),
      { id: "bad", sourceText: 7 },
      { ...bundle({ id: "future" }), schemaVersion: 2 },
    ]),
  });

  assert.deepEqual(loadArticleBundles(corrupt).entries, []);
  assert.match(loadArticleBundles(corrupt).warning, /읽지 못/);
  assert.match(loadArticleBundles(wrongRoot).warning, /형식/);
  assert.match(loadArticleBundles(oversized).warning, /허용 크기/);
  assert.equal(loadArticleBundles(mixed).entries.length, 1);
  assert.match(loadArticleBundles(mixed).warning, /제외/);
});

test("invalid colors and backwards timestamps are rejected", () => {
  assert.throws(
    () => bundle({ headerColor: "red" }),
    (error) => error instanceof Error && error.code === "INVALID_ARTICLE_BUNDLE",
  );
  assert.throws(
    () => bundle({ updatedAt: "2026-09-22T23:59:59.000Z" }),
    (error) => error instanceof Error && error.code === "INVALID_ARTICLE_BUNDLE",
  );
});

test("bundle limits keep the most recently updated groups", () => {
  const entries = Array.from({ length: MAX_ARTICLE_BUNDLE_ENTRIES + 5 }, (_, index) =>
    bundle({
      id: `bundle-${index}`,
      sourceText: "가".repeat(Math.floor(MAX_ARTICLE_BUNDLE_CHARACTERS / MAX_ARTICLE_BUNDLE_ENTRIES)),
      articleTitles: [`글 ${index}`],
      createdAt: new Date(Date.UTC(2026, 8, 23, 0, index)).toISOString(),
      updatedAt: new Date(Date.UTC(2026, 8, 23, 0, index)).toISOString(),
    }),
  );

  const saved = saveArticleBundles(new FakeStorage(), entries);
  const totalCharacters = saved.reduce((sum, entry) => sum + entry.sourceText.length, 0);

  assert.ok(saved.length <= MAX_ARTICLE_BUNDLE_ENTRIES);
  assert.ok(totalCharacters <= MAX_ARTICLE_BUNDLE_CHARACTERS);
  assert.equal(saved[0].id, `bundle-${MAX_ARTICLE_BUNDLE_ENTRIES + 4}`);
});

test("JSON escaping prunes the oldest groups until the saved value is readable", () => {
  const storage = new FakeStorage();
  const newlineHeavy = Array.from({ length: 8 }, (_, index) => bundle({
    id: `newline-${index}`,
    sourceText: `${"\n".repeat(99_999)}글`,
    articleTitles: [`줄바꿈 글 ${index}`],
    createdAt: new Date(Date.UTC(2026, 8, 23, 0, index)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 8, 23, 0, index)).toISOString(),
  }));

  const saved = saveArticleBundles(storage, newlineHeavy);

  assert.ok(saved.length < newlineHeavy.length);
  assert.ok(storage.getItem(ARTICLE_BUNDLE_STORAGE_KEY).length <= 1_250_000);
  assert.deepEqual(loadArticleBundles(storage).entries, saved);
});

test("individual deletion and clear-all remove only the requested local data", () => {
  const storage = new FakeStorage();
  const remaining = removeArticleBundle([bundle(), bundle({ id: "bundle-2" })], "bundle-1");
  saveArticleBundles(storage, remaining);

  assert.deepEqual(loadArticleBundles(storage).entries.map((entry) => entry.id), ["bundle-2"]);
  clearArticleBundles(storage);
  assert.equal(storage.getItem(ARTICLE_BUNDLE_STORAGE_KEY), null);
});

test("storage failures use stable article-bundle error codes", () => {
  const storage = new FakeStorage();
  storage.failRead = true;
  assert.throws(
    () => loadArticleBundles(storage),
    (error) => error instanceof Error && error.code === "ARTICLE_BUNDLE_READ_FAILED",
  );

  storage.failRead = false;
  storage.failWrite = true;
  assert.throws(
    () => saveArticleBundles(storage, [bundle()]),
    (error) => error instanceof Error && error.code === "ARTICLE_BUNDLE_WRITE_FAILED",
  );
  assert.throws(
    () => clearArticleBundles(storage),
    (error) => error instanceof Error && error.code === "ARTICLE_BUNDLE_CLEAR_FAILED",
  );

  const quotaStorage = new FakeStorage();
  quotaStorage.setItem = () => {
    const error = new Error("full");
    error.name = "QuotaExceededError";
    throw error;
  };
  assert.throws(
    () => saveArticleBundles(quotaStorage, [bundle()]),
    (error) => error instanceof Error && error.code === "ARTICLE_BUNDLE_QUOTA_EXCEEDED",
  );
});

test("untrusted markup remains inert plain text in a saved group", () => {
  const storage = new FakeStorage();
  saveArticleBundles(storage, [bundle({
    sourceText: "<img src=x onerror=alert(1)>",
    articleTitles: ["<script>alert(1)</script>"],
  })]);

  const saved = loadArticleBundles(storage).entries[0];
  assert.equal(saved.sourceText, "<img src=x onerror=alert(1)>");
  assert.equal(saved.articleTitles[0], "<script>alert(1)</script>");
});
