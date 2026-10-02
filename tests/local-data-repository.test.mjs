import assert from "node:assert/strict";
import test from "node:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

import {
  applyLocalDataSchema,
  createD1LocalDataRepository,
} from "../db/local-data-repository.mjs";
import { createEmptyLocalDataSnapshot } from "../lib/local-data-model.mjs";

const now = "2026-10-02T00:00:00.000Z";

function bundle(id = "bundle-1") {
  return {
    schemaVersion: 1,
    id,
    displayTitle: id,
    sourceText: `# ${id}\n\n본문`,
    headerColor: "#F7F7F7",
    articleTitles: [id],
    createdAt: now,
    updatedAt: now,
  };
}

function shortcut(id = "shortcut-1") {
  return {
    schemaVersion: 1,
    id,
    name: id,
    url: `https://${id}.example.com/`,
    createdAt: now,
    updatedAt: now,
  };
}

async function withDatabase(run) {
  const miniflare = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    compatibilityDate: "2026-05-22",
    d1Databases: ["DB"],
  }));
  try {
    const database = await miniflare.getD1Database("DB");
    await applyLocalDataSchema(database);
    await run(database);
  } finally {
    await miniflare.dispose();
  }
}

test("D1 repository replaces and reads individual rows with durable revisions", async () => {
  await withDatabase(async (database) => {
    const repository = createD1LocalDataRepository({ database, now: () => now });
    const empty = await repository.readAll();
    assert.deepEqual(empty.revisions, { articleBundles: 0, publicationHistory: 0, shortcuts: 0 });

    const saved = await repository.replaceCollection("shortcuts", [shortcut()], 0);
    const reopened = createD1LocalDataRepository({ database, now: () => now });
    const loaded = await reopened.readCollection("shortcuts");

    assert.equal(saved.revision, 1);
    assert.deepEqual(loaded.entries.map((entry) => entry.id), ["shortcut-1"]);
    await assert.rejects(
      () => repository.replaceCollection("shortcuts", [], 0),
      (error) => error instanceof Error && error.code === "REVISION_CONFLICT",
    );
  });
});

test("two repository instances cannot both commit the same expected revision", async () => {
  await withDatabase(async (database) => {
    const first = createD1LocalDataRepository({ database, now: () => now });
    const second = createD1LocalDataRepository({ database, now: () => now });

    const results = await Promise.allSettled([
      first.replaceCollection("shortcuts", [shortcut("first")], 0),
      second.replaceCollection("shortcuts", [shortcut("second")], 0),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.code, "REVISION_CONFLICT");
    const loaded = await first.readCollection("shortcuts");
    assert.equal(loaded.revision, 1);
    assert.equal(loaded.entries.length, 1);
  });
});

test("three collections and the migration record commit in one D1 batch", async () => {
  await withDatabase(async (database) => {
    const repository = createD1LocalDataRepository({ database, now: () => now });
    const snapshot = {
      ...createEmptyLocalDataSnapshot(),
      articleBundles: [bundle()],
      shortcuts: [shortcut()],
    };
    const saved = await repository.replaceAllWithImport({
      snapshot,
      expectedRevisions: { articleBundles: 0, publicationHistory: 0, shortcuts: 0 },
      migration: {
        migrationId: "migration-12345678",
        payloadHash: "fnv1a64-1234567890abcdef",
        imported: { articleBundles: 1, publicationHistory: 0, shortcuts: 1 },
        skipped: { articleBundles: 0, publicationHistory: 0, shortcuts: 0 },
      },
    });

    assert.deepEqual(saved.revisions, { articleBundles: 1, publicationHistory: 1, shortcuts: 1 });
    assert.deepEqual(saved.snapshot.articleBundles.map((entry) => entry.id), ["bundle-1"]);
    assert.equal((await repository.findImport("migration-12345678")).payloadHash, "fnv1a64-1234567890abcdef");
  });
});

test("a stale replace-all request changes neither data nor migration records", async () => {
  await withDatabase(async (database) => {
    const repository = createD1LocalDataRepository({ database, now: () => now });
    await repository.replaceCollection("shortcuts", [shortcut("existing")], 0);

    await assert.rejects(
      () => repository.replaceAllWithImport({
        snapshot: createEmptyLocalDataSnapshot(),
        expectedRevisions: { articleBundles: 0, publicationHistory: 0, shortcuts: 0 },
        migration: {
          migrationId: "migration-stale-1",
          payloadHash: "fnv1a64-fedcba0987654321",
          imported: {},
          skipped: {},
        },
      }),
      (error) => error instanceof Error && error.code === "REVISION_CONFLICT",
    );

    assert.deepEqual((await repository.readCollection("shortcuts")).entries.map((entry) => entry.id), ["existing"]);
    assert.equal(await repository.findImport("migration-stale-1"), null);
  });
});

test("corrupt JSON rows fail explicitly instead of becoming normal data", async () => {
  await withDatabase(async (database) => {
    const repository = createD1LocalDataRepository({ database, now: () => now });
    await repository.replaceCollection("articleBundles", [bundle()], 0);
    await database.prepare("UPDATE article_bundles SET article_titles_json = ? WHERE id = ?")
      .bind("{broken", "bundle-1")
      .run();

    await assert.rejects(
      () => repository.readCollection("articleBundles"),
      (error) => error instanceof Error && error.code === "LOCAL_DATA_CORRUPT",
    );
  });
});
