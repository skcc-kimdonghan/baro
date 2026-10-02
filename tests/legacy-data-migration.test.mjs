import assert from "node:assert/strict";
import test from "node:test";

import { ARTICLE_BUNDLE_STORAGE_KEY } from "../lib/article-bundles.mjs";
import { GPT_SHORTCUT_STORAGE_KEY } from "../lib/gpt-shortcuts.mjs";
import {
  LEGACY_MIGRATION_MARKER_KEY,
  migrateLegacyLocalData,
} from "../lib/legacy-data-migration.mjs";
import { HISTORY_STORAGE_KEY } from "../lib/publication-history.mjs";

const now = "2026-10-02T00:00:00.000Z";

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    value(key) { return values.get(key); },
  };
}

function bundle() {
  return {
    schemaVersion: 1,
    id: "bundle-1",
    sourceText: "# 저장 원고\n\n본문",
    headerColor: "#F7F7F7",
    articleTitles: ["저장 원고"],
    createdAt: now,
    updatedAt: now,
  };
}

function shortcut() {
  return {
    schemaVersion: 1,
    id: "shortcut-1",
    name: "OneCalc",
    url: "https://onecalc.kr/",
    createdAt: now,
    updatedAt: now,
  };
}

test("empty legacy storage does not send a migration request", async () => {
  let calls = 0;
  const result = await migrateLegacyLocalData({
    storage: createStorage(),
    client: { async importLegacy() { calls += 1; } },
    idFactory: () => "migration-empty",
  });

  assert.equal(result.status, "empty");
  assert.equal(calls, 0);
});

test("valid legacy collections migrate together and the original browser data remains", async () => {
  const storage = createStorage({
    [ARTICLE_BUNDLE_STORAGE_KEY]: JSON.stringify([bundle()]),
    [HISTORY_STORAGE_KEY]: "[]",
    [GPT_SHORTCUT_STORAGE_KEY]: JSON.stringify([shortcut()]),
  });
  let payload;
  const result = await migrateLegacyLocalData({
    storage,
    client: { async importLegacy(input) { payload = input; return { alreadyApplied: false }; } },
    idFactory: () => "migration-1",
  });

  assert.equal(result.status, "migrated");
  assert.equal(payload.migrationId, "migration-1");
  assert.equal(payload.snapshot.articleBundles.length, 1);
  assert.equal(payload.snapshot.shortcuts.length, 1);
  assert.equal(storage.value(ARTICLE_BUNDLE_STORAGE_KEY), JSON.stringify([bundle()]));
  assert.equal(JSON.parse(storage.value(LEGACY_MIGRATION_MARKER_KEY)).status, "complete");
});

test("the same payload reuses its pending migration id after a failed request", async () => {
  const storage = createStorage({ [ARTICLE_BUNDLE_STORAGE_KEY]: JSON.stringify([bundle()]) });
  let attemptedId = "";
  await assert.rejects(() => migrateLegacyLocalData({
    storage,
    client: { async importLegacy(input) { attemptedId = input.migrationId; throw new Error("offline"); } },
    idFactory: () => "stable-migration",
  }));
  assert.equal(JSON.parse(storage.value(LEGACY_MIGRATION_MARKER_KEY)).status, "pending");

  let retriedId = "";
  const result = await migrateLegacyLocalData({
    storage,
    client: { async importLegacy(input) { retriedId = input.migrationId; return { alreadyApplied: true }; } },
    idFactory: () => "must-not-be-used",
  });

  assert.equal(result.status, "already-applied");
  assert.equal(retriedId, attemptedId);
  assert.equal(storage.value(ARTICLE_BUNDLE_STORAGE_KEY), JSON.stringify([bundle()]));
});

test("corrupt legacy JSON is preserved and does not hide valid collections", async () => {
  const storage = createStorage({
    [ARTICLE_BUNDLE_STORAGE_KEY]: "{broken",
    [GPT_SHORTCUT_STORAGE_KEY]: JSON.stringify([shortcut()]),
  });
  let payload;
  const result = await migrateLegacyLocalData({
    storage,
    client: { async importLegacy(input) { payload = input; return { alreadyApplied: false }; } },
    idFactory: () => "migration-partial",
  });

  assert.equal(result.status, "migrated");
  assert.equal(payload.snapshot.articleBundles.length, 0);
  assert.equal(payload.snapshot.shortcuts.length, 1);
  assert.match(result.warning, /글뭉치/);
  assert.equal(storage.value(ARTICLE_BUNDLE_STORAGE_KEY), "{broken");
});
