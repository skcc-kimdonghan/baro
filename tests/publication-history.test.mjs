import test from "node:test";
import assert from "node:assert/strict";

import {
  HISTORY_STORAGE_KEY,
  MAX_HISTORY_CHARACTERS,
  MAX_HISTORY_ENTRIES,
  clearPublicationHistory,
  createHistoryEntry,
  createHistoryIdFromContent,
  loadPublicationHistory,
  removeHistoryEntry,
  savePublicationHistory,
  upsertHistoryEntry,
} from "../lib/publication-history.mjs";
import { savePublicationComparison } from "../lib/publication-history-save.mjs";

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

function entry(overrides = {}) {
  return createHistoryEntry({
    id: "history-1",
    title: "첫 글",
    preparedText: "제공 원고",
    publishedText: "실제 발행본",
    comparison: {
      status: "match",
      score: 100,
      summary: "일치합니다.",
      issues: [],
      expectedCharacters: 5,
      actualCharacters: 6,
    },
    completedAt: "2026-09-22T01:00:00.000Z",
    updatedAt: "2026-09-22T01:00:00.000Z",
    ...overrides,
  });
}

test("history saves, loads, and sorts newest entries first", () => {
  const storage = new FakeStorage();
  const older = entry();
  const newer = entry({ id: "history-2", title: "둘째 글", completedAt: "2026-09-22T02:00:00.000Z", updatedAt: "2026-09-22T02:00:00.000Z" });

  const saved = savePublicationHistory(storage, [older, newer]);
  const loaded = loadPublicationHistory(storage);

  assert.deepEqual(saved.map((item) => item.id), ["history-2", "history-1"]);
  assert.deepEqual(loaded.entries.map((item) => item.id), ["history-2", "history-1"]);
  assert.equal(loaded.warning, "");
});

test("history preserves bounded formatting comparison summaries without raw HTML", () => {
  const storage = new FakeStorage();
  const formatted = entry({
    comparison: {
      ...entry().comparison,
      status: "formatting-only",
      formatting: {
        status: "different",
        score: 77,
        summary: "글자 크기와 주요 서식 3개 항목이 다릅니다.",
        checks: [
          { key: "font-size", label: "글자 크기", expected: "15px×2", actual: "19px×2", matched: false },
          { key: "bold", label: "굵게", expected: "2곳", actual: "2곳", matched: true },
        ],
      },
    },
  });

  savePublicationHistory(storage, [formatted]);
  const loaded = loadPublicationHistory(storage).entries[0];

  assert.equal(loaded.comparison.formatting.status, "different");
  assert.equal(loaded.comparison.formatting.score, 77);
  assert.equal(loaded.comparison.formatting.checks[0].key, "font-size");
  assert.doesNotMatch(storage.getItem(HISTORY_STORAGE_KEY), /<p|<script|publishedHtml/i);
});

test("upsert replaces the same id without mutating the previous array", () => {
  const original = Object.freeze([entry()]);
  const updated = upsertHistoryEntry(original, entry({ title: "수정된 제목", updatedAt: "2026-09-22T03:00:00.000Z" }));

  assert.equal(original[0].title, "첫 글");
  assert.equal(updated.length, 1);
  assert.equal(updated[0].title, "수정된 제목");
});

test("the same prepared article receives a stable history id across sessions", () => {
  const first = createHistoryIdFromContent("같은 제목", "같은 제공 원고");
  const second = createHistoryIdFromContent("같은 제목", "같은 제공 원고");

  assert.equal(first, second);
  assert.notEqual(first, createHistoryIdFromContent("다른 제목", "같은 제공 원고"));
});

test("individual removal and clear-all update storage safely", () => {
  const storage = new FakeStorage();
  const entries = [entry(), entry({ id: "history-2" })];
  const remaining = removeHistoryEntry(entries, "history-1");
  savePublicationHistory(storage, remaining);

  assert.deepEqual(loadPublicationHistory(storage).entries.map((item) => item.id), ["history-2"]);
  clearPublicationHistory(storage);
  assert.equal(storage.getItem(HISTORY_STORAGE_KEY), null);
});

test("corrupt JSON and invalid entries return a recoverable warning", () => {
  const corruptStorage = new FakeStorage({ [HISTORY_STORAGE_KEY]: "{broken" });
  const oversizedStorage = new FakeStorage({
    [HISTORY_STORAGE_KEY]: "x".repeat(MAX_HISTORY_CHARACTERS + 500_001),
  });
  const invalidStorage = new FakeStorage({
    [HISTORY_STORAGE_KEY]: JSON.stringify([
      entry(),
      { id: "bad", title: 7 },
      { ...entry({ id: "future" }), schemaVersion: 2 },
    ]),
  });

  assert.deepEqual(loadPublicationHistory(corruptStorage).entries, []);
  assert.match(loadPublicationHistory(corruptStorage).warning, /읽지 못/);
  assert.deepEqual(loadPublicationHistory(oversizedStorage).entries, []);
  assert.match(loadPublicationHistory(oversizedStorage).warning, /허용 크기/);
  assert.equal(loadPublicationHistory(invalidStorage).entries.length, 1);
  assert.match(loadPublicationHistory(invalidStorage).warning, /제외/);
});

test("entry count and total text size are bounded while keeping newest entries", () => {
  const manyEntries = Array.from({ length: MAX_HISTORY_ENTRIES + 5 }, (_, index) =>
    entry({
      id: `history-${index}`,
      preparedText: "가".repeat(Math.floor(MAX_HISTORY_CHARACTERS / MAX_HISTORY_ENTRIES)),
      publishedText: "",
      completedAt: new Date(Date.UTC(2026, 8, 22, 0, index)).toISOString(),
      updatedAt: new Date(Date.UTC(2026, 8, 22, 0, index)).toISOString(),
    }),
  );
  const storage = new FakeStorage();
  const saved = savePublicationHistory(storage, manyEntries);
  const totalCharacters = saved.reduce(
    (sum, item) => sum + item.preparedText.length + item.publishedText.length,
    0,
  );

  assert.ok(saved.length <= MAX_HISTORY_ENTRIES);
  assert.ok(totalCharacters <= MAX_HISTORY_CHARACTERS);
  assert.equal(saved[0].id, `history-${MAX_HISTORY_ENTRIES + 4}`);
});

test("escaped text is pruned until the serialized history remains readable", () => {
  const storage = new FakeStorage();
  const newlineHeavyEntries = Array.from({ length: 7 }, (_, index) =>
    entry({
      id: `newline-heavy-${index}`,
      title: `줄바꿈 글 ${index}`,
      preparedText: "\n".repeat(100_000),
      publishedText: "\n".repeat(100_000),
      completedAt: new Date(Date.UTC(2026, 8, 22, 0, index)).toISOString(),
      updatedAt: new Date(Date.UTC(2026, 8, 22, 0, index)).toISOString(),
    }),
  );

  const saved = savePublicationHistory(storage, newlineHeavyEntries);
  const serialized = storage.getItem(HISTORY_STORAGE_KEY);
  const loaded = loadPublicationHistory(storage);

  assert.ok(serialized.length <= 2_500_000);
  assert.ok(saved.length < newlineHeavyEntries.length);
  assert.deepEqual(loaded.entries, saved);
  assert.equal(loaded.warning, "");
});

test("serialized pruning keeps the most recently updated entry", () => {
  const storage = new FakeStorage();
  const recentlyUpdatedOldArticle = entry({
    id: "old-but-updated",
    preparedText: "\n".repeat(100_000),
    publishedText: "\n".repeat(100_000),
    completedAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-22T12:00:00.000Z",
  });
  const newerArticles = Array.from({ length: 6 }, (_, index) =>
    entry({
      id: `newer-${index}`,
      preparedText: "\n".repeat(100_000),
      publishedText: "\n".repeat(100_000),
      completedAt: new Date(Date.UTC(2026, 8, 10 + index)).toISOString(),
      updatedAt: new Date(Date.UTC(2026, 8, 10 + index)).toISOString(),
    }),
  );

  const saved = savePublicationHistory(storage, [recentlyUpdatedOldArticle, ...newerArticles]);

  assert.ok(saved.some((item) => item.id === recentlyUpdatedOldArticle.id));
});

test("raw character pruning keeps an older article that was just updated", () => {
  const storage = new FakeStorage();
  const recentlyUpdatedOldArticle = entry({
    id: "old-but-expanded",
    preparedText: "가".repeat(100_000),
    publishedText: "나".repeat(100_000),
    completedAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-22T12:00:00.000Z",
  });
  const newerArticles = Array.from({ length: 10 }, (_, index) =>
    entry({
      id: `large-newer-${index}`,
      preparedText: "다".repeat(97_500),
      publishedText: "라".repeat(97_500),
      completedAt: new Date(Date.UTC(2026, 8, 10 + index)).toISOString(),
      updatedAt: new Date(Date.UTC(2026, 8, 10 + index)).toISOString(),
    }),
  );

  const saved = savePublicationHistory(storage, [recentlyUpdatedOldArticle, ...newerArticles]);

  assert.ok(saved.some((item) => item.id === recentlyUpdatedOldArticle.id));
  assert.ok(saved.length < newerArticles.length + 1);
});

test("stale comparisons cancel while waiting for the history lock", async () => {
  const storage = new FakeStorage();
  let current = true;
  let releaseLock;
  const lockBarrier = new Promise((resolve) => {
    releaseLock = resolve;
  });
  const pending = savePublicationComparison({
    storage,
    withLock: async (operation) => {
      await lockBarrier;
      return operation();
    },
    title: "대기 중인 글",
    preparedText: "제공 원고",
    publishedText: "발행 원고",
    comparison: entry().comparison,
    isCurrent: () => current,
  });

  current = false;
  releaseLock();
  const result = await pending;

  assert.equal(result.status, "stale");
  assert.equal(storage.getItem(HISTORY_STORAGE_KEY), null);
});

test("history storage failures are distinct from a stale comparison", async () => {
  const storage = new FakeStorage();
  storage.failWrite = true;

  const result = await savePublicationComparison({
    storage,
    withLock: (operation) => operation(),
    title: "저장 실패 글",
    preparedText: "제공 원고",
    publishedText: "발행 원고",
    comparison: entry().comparison,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.historyId, null);
  assert.ok(result.error instanceof Error);
});

test("storage read and write errors receive stable error codes", () => {
  const storage = new FakeStorage();
  storage.failRead = true;
  assert.throws(
    () => loadPublicationHistory(storage),
    (error) => error instanceof Error && error.code === "HISTORY_READ_FAILED",
  );

  storage.failRead = false;
  storage.failWrite = true;
  assert.throws(
    () => savePublicationHistory(storage, [entry()]),
    (error) => error instanceof Error && error.code === "HISTORY_WRITE_FAILED",
  );
  assert.throws(
    () => clearPublicationHistory(storage),
    (error) => error instanceof Error && error.code === "HISTORY_CLEAR_FAILED",
  );
});

test("untrusted markup stays plain history data", () => {
  const storage = new FakeStorage();
  savePublicationHistory(storage, [entry({ publishedText: "<img src=x onerror=alert(1)>" })]);

  assert.equal(loadPublicationHistory(storage).entries[0].publishedText, "<img src=x onerror=alert(1)>");
});
