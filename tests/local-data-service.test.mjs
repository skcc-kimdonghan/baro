import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyLocalDataSnapshot } from "../lib/local-data-model.mjs";
import { createLocalDataService } from "../lib/local-data-service.mjs";

const now = "2026-10-02T00:00:00.000Z";

function shortcut(id = "one") {
  return {
    schemaVersion: 1,
    id,
    name: `바로가기 ${id}`,
    url: `https://${id}.example.com/`,
    createdAt: now,
    updatedAt: now,
  };
}

function createRepository() {
  let snapshot = createEmptyLocalDataSnapshot();
  let revisions = { articleBundles: 0, publicationHistory: 0, shortcuts: 0 };
  const imports = new Map();
  return {
    async readAll() { return { snapshot, revisions: { ...revisions } }; },
    async readCollection(collection) {
      return { collection, entries: snapshot[collection], revision: revisions[collection] };
    },
    async replaceCollection(collection, entries, expectedRevision) {
      if (revisions[collection] !== expectedRevision) {
        throw Object.assign(new Error("conflict"), { code: "REVISION_CONFLICT" });
      }
      snapshot = Object.freeze({ ...snapshot, [collection]: entries });
      revisions = { ...revisions, [collection]: revisions[collection] + 1 };
      return { collection, entries: snapshot[collection], revision: revisions[collection] };
    },
    async findImport(migrationId) { return imports.get(migrationId) ?? null; },
    async replaceAllWithImport(input) {
      snapshot = input.snapshot;
      revisions = {
        articleBundles: revisions.articleBundles + 1,
        publicationHistory: revisions.publicationHistory + 1,
        shortcuts: revisions.shortcuts + 1,
      };
      imports.set(input.migration.migrationId, input.migration);
      return { snapshot, revisions: { ...revisions } };
    },
  };
}

test("service validates and persists one collection with optimistic revision", async () => {
  const service = createLocalDataService({ repository: createRepository() });

  const saved = await service.replace("shortcuts", [shortcut()], 0);
  const loaded = await service.read("shortcuts");

  assert.equal(saved.revision, 1);
  assert.deepEqual(loaded.entries.map((entry) => entry.id), ["one"]);
  await assert.rejects(
    () => service.replace("shortcuts", [], 0),
    (error) => error instanceof Error && error.code === "REVISION_CONFLICT",
  );
});

test("legacy import is atomic, merge-aware, and idempotent by id and hash", async () => {
  const repository = createRepository();
  const service = createLocalDataService({ repository });
  await service.replace("shortcuts", [shortcut("db")], 0);
  const input = {
    migrationId: "migration-12345678",
    payloadHash: "fnv1a64-1234567890abcdef",
    snapshot: {
      articleBundles: [],
      publicationHistory: [],
      shortcuts: [shortcut("legacy")],
    },
  };

  const first = await service.importLegacy(input);
  const second = await service.importLegacy(input);

  assert.equal(first.alreadyApplied, false);
  assert.equal(second.alreadyApplied, true);
  assert.deepEqual(second.snapshot.shortcuts.map((entry) => entry.id), ["db", "legacy"]);
  await assert.rejects(
    () => service.importLegacy({ ...input, payloadHash: "fnv1a64-fedcba0987654321" }),
    (error) => error instanceof Error && error.code === "MIGRATION_CONFLICT",
  );
});

test("invalid migration ids, hashes, snapshots, and revisions fail before repository writes", async () => {
  const service = createLocalDataService({ repository: createRepository() });

  await assert.rejects(
    () => service.importLegacy({ migrationId: "x", payloadHash: "bad", snapshot: {} }),
    (error) => error instanceof Error && error.code === "INVALID_LOCAL_DATA_MIGRATION",
  );
  await assert.rejects(
    () => service.replace("shortcuts", [], -1),
    (error) => error instanceof Error && error.code === "INVALID_LOCAL_DATA_REVISION",
  );
});

test("concurrent writes are serialized so only one stale revision can succeed", async () => {
  const service = createLocalDataService({ repository: createRepository() });
  const results = await Promise.allSettled([
    service.replace("shortcuts", [shortcut("first")], 0),
    service.replace("shortcuts", [shortcut("second")], 0),
  ]);

  assert.deepEqual(results.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
  const loaded = await service.read("shortcuts");
  assert.equal(loaded.entries.length, 1);
});
