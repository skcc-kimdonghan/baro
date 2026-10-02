import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCAL_DATA_COLLECTIONS,
  createEmptyLocalDataSnapshot,
  mergeLegacyLocalData,
  normalizeLocalDataCollection,
  replaceLocalDataCollection,
} from "../lib/local-data-model.mjs";

const now = "2026-10-02T00:00:00.000Z";

function bundle(id, updatedAt = now) {
  return {
    schemaVersion: 1,
    id,
    sourceText: `# ${id}\n\n본문`,
    headerColor: "#F7F7F7",
    articleTitles: [id],
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt,
  };
}

function history(id, updatedAt = now) {
  return {
    schemaVersion: 1,
    id,
    title: id,
    preparedText: "준비 본문",
    publishedText: "발행 본문",
    comparison: null,
    completedAt: "2026-10-01T01:00:00.000Z",
    updatedAt,
  };
}

function shortcut(id, name, url) {
  return {
    schemaVersion: 1,
    id,
    name,
    url,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: now,
  };
}

test("an empty local database snapshot is deeply immutable", () => {
  const snapshot = createEmptyLocalDataSnapshot();

  assert.deepEqual(snapshot, {
    articleBundles: [],
    publicationHistory: [],
    shortcuts: [],
  });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.articleBundles), true);
});

test("every database collection reuses the existing domain validation and ordering", () => {
  const bundles = normalizeLocalDataCollection("articleBundles", [
    bundle("old", "2026-10-01T02:00:00.000Z"),
    bundle("new", "2026-10-02T02:00:00.000Z"),
  ]);
  const histories = normalizeLocalDataCollection("publicationHistory", [history("history")]);
  const shortcuts = normalizeLocalDataCollection("shortcuts", [
    shortcut("one", "OneCalc", "https://onecalc.kr/"),
  ]);

  assert.deepEqual(bundles.map((entry) => entry.id), ["new", "old"]);
  assert.equal(histories[0].title, "history");
  assert.equal(shortcuts[0].url, "https://onecalc.kr/");
  assert.equal(Object.isFrozen(bundles[0]), true);
  assert.deepEqual(LOCAL_DATA_COLLECTIONS, ["articleBundles", "publicationHistory", "shortcuts"]);
});

test("unknown collections, invalid entries, duplicates, and collection limits are rejected", () => {
  assert.throws(() => normalizeLocalDataCollection("unknown", []), /컬렉션/);
  assert.throws(() => normalizeLocalDataCollection("articleBundles", [{ bad: true }]), /글뭉치/);
  assert.throws(
    () => normalizeLocalDataCollection("shortcuts", [
      shortcut("one", "같은 이름", "https://onecalc.kr/"),
      shortcut("two", "같은 이름", "https://naver.com/"),
    ]),
    (error) => error instanceof Error && error.code === "DUPLICATE_GPT_SHORTCUT_NAME",
  );
  assert.throws(
    () => normalizeLocalDataCollection(
      "articleBundles",
      Array.from({ length: 21 }, (_, index) => bundle(`bundle-${index}`)),
    ),
    (error) => error instanceof Error && error.code === "LOCAL_DATA_LIMIT_EXCEEDED",
  );
});

test("replacing one collection never mutates or replaces the other collections", () => {
  const initial = replaceLocalDataCollection(
    createEmptyLocalDataSnapshot(),
    "publicationHistory",
    [history("saved")],
  );
  const next = replaceLocalDataCollection(initial, "articleBundles", [bundle("draft")]);

  assert.notEqual(next, initial);
  assert.deepEqual(next.articleBundles.map((entry) => entry.id), ["draft"]);
  assert.equal(next.publicationHistory, initial.publicationHistory);
  assert.deepEqual(next.publicationHistory.map((entry) => entry.id), ["saved"]);
});

test("legacy merge keeps newer database rows and reports shortcut conflicts", () => {
  const database = Object.freeze({
    articleBundles: Object.freeze([bundle("same", "2026-10-03T00:00:00.000Z")]),
    publicationHistory: Object.freeze([history("same", "2026-10-03T00:00:00.000Z")]),
    shortcuts: Object.freeze([shortcut("db", "OneCalc", "https://onecalc.kr/")]),
  });
  const legacy = {
    articleBundles: [bundle("same", "2026-10-02T00:00:00.000Z"), bundle("legacy")],
    publicationHistory: [history("same", "2026-10-02T00:00:00.000Z"), history("legacy")],
    shortcuts: [
      shortcut("legacy-duplicate", "OneCalc", "https://naver.com/"),
      shortcut("legacy-new", "네이버 블로그", "https://blog.naver.com/"),
    ],
  };

  const result = mergeLegacyLocalData(database, legacy);

  assert.deepEqual(result.snapshot.articleBundles.map((entry) => entry.id), ["same", "legacy"]);
  assert.equal(result.snapshot.articleBundles[0].updatedAt, "2026-10-03T00:00:00.000Z");
  assert.deepEqual(result.snapshot.publicationHistory.map((entry) => entry.id), ["same", "legacy"]);
  assert.deepEqual(result.snapshot.shortcuts.map((entry) => entry.id), ["db", "legacy-new"]);
  assert.deepEqual(result.imported, { articleBundles: 1, publicationHistory: 1, shortcuts: 1 });
  assert.deepEqual(result.skipped, { articleBundles: 1, publicationHistory: 1, shortcuts: 1 });
});

test("legacy merge never evicts an existing database row at collection capacity", () => {
  const databaseBundles = Object.freeze(Array.from({ length: 20 }, (_, index) => (
    bundle(`db-${index}`, `2026-10-03T00:00:${String(index).padStart(2, "0")}.000Z`)
  )));
  const database = Object.freeze({
    articleBundles: databaseBundles,
    publicationHistory: Object.freeze([]),
    shortcuts: Object.freeze([]),
  });
  const legacy = {
    articleBundles: [bundle("legacy-old", "2026-10-01T00:00:00.000Z")],
    publicationHistory: [],
    shortcuts: [],
  };

  const result = mergeLegacyLocalData(database, legacy);

  assert.deepEqual(
    result.snapshot.articleBundles.map((entry) => entry.id).sort(),
    databaseBundles.map((entry) => entry.id).sort(),
  );
  assert.equal(result.imported.articleBundles, 0);
  assert.equal(result.skipped.articleBundles, 1);
});
