import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

import {
  applyLocalDataSchema,
  createD1LocalDataRepository,
} from "../db/local-data-repository.mjs";
import { createEmptyLocalDataSnapshot } from "../lib/local-data-model.mjs";

const now = "2026-10-02T00:00:00.000Z";
const drizzleMigrationUrls = [
  new URL("../drizzle/0000_powerful_karma.sql", import.meta.url),
  new URL("../drizzle/0001_handy_the_santerians.sql", import.meta.url),
  new URL("../drizzle/0002_fancy_skaar.sql", import.meta.url),
];

function bundle(id = "bundle-1") {
  return {
    schemaVersion: 1,
    id,
    displayTitle: id,
    sourceText: `# ${id}\n\n본문`,
    headerColor: "#F7F7F7",
    articleType: "information",
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

async function withRawDatabase(run) {
  const miniflare = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    compatibilityDate: "2026-05-22",
    d1Databases: ["DB"],
  }));
  try {
    const database = await miniflare.getD1Database("DB");
    await run(database);
  } finally {
    await miniflare.dispose();
  }
}

async function withDatabase(run) {
  await withRawDatabase(async (database) => {
    await applyLocalDataSchema(database);
    await run(database);
  });
}

async function applyDrizzleMigrations(database, migrationUrls = drizzleMigrationUrls) {
  for (const migrationUrl of migrationUrls) {
    const migration = await readFile(migrationUrl, "utf8");
    const statements = migration
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) => database.prepare(statement));
    await database.batch(statements);
  }
}

function normalizeSchemaSql(sql) {
  return String(sql ?? "")
    .toLowerCase()
    .replace(/[`"]/g, "")
    .replace(/if not exists\s+/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([(),])\s*/g, "$1")
    .trim();
}

async function databaseSchemaSnapshot(database) {
  const schema = await database.prepare(`SELECT type, name, tbl_name, sql
    FROM sqlite_master
    WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'
    ORDER BY type, name`).all();
  const revisions = await database.prepare(`SELECT collection, revision, updated_at
    FROM collection_revisions ORDER BY collection`).all();
  return {
    schema: (schema.results ?? []).map((entry) => ({
      type: entry.type,
      name: entry.name,
      table: entry.tbl_name,
      sql: normalizeSchemaSql(entry.sql),
    })),
    revisions: revisions.results ?? [],
  };
}

test("repository bootstrap schema stays identical to the checked-in Drizzle migrations", async () => {
  let bootstrapSnapshot;
  let migrationSnapshot;

  await withRawDatabase(async (database) => {
    await applyLocalDataSchema(database);
    bootstrapSnapshot = await databaseSchemaSnapshot(database);
  });
  await withRawDatabase(async (database) => {
    await applyDrizzleMigrations(database);
    migrationSnapshot = await databaseSchemaSnapshot(database);
  });

  assert.deepEqual(bootstrapSnapshot, migrationSnapshot);
});

test("the article type migration keeps legacy rows as information articles", async () => {
  await withRawDatabase(async (database) => {
    await applyDrizzleMigrations(database, drizzleMigrationUrls.slice(0, 2));
    await database.prepare(`INSERT INTO article_bundles
      (id, schema_version, source_text, header_color, article_titles_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "legacy-bundle",
        1,
        "# 예전 정보글\n\n본문",
        "#F7F7F7",
        JSON.stringify(["예전 정보글"]),
        now,
        now,
      )
      .run();

    await applyDrizzleMigrations(database, drizzleMigrationUrls.slice(2));
    const migrated = await database.prepare(
      "SELECT article_type FROM article_bundles WHERE id = ?",
    ).bind("legacy-bundle").first();

    assert.equal(migrated?.article_type, "information");
  });
});

test("article bundle type survives a database reopen", async () => {
  await withDatabase(async (database) => {
    const repository = createD1LocalDataRepository({ database, now: () => now });
    await repository.replaceCollection(
      "articleBundles",
      [{ ...bundle("advertisement-bundle"), articleType: "advertisement" }],
      0,
    );
    const reopened = createD1LocalDataRepository({ database, now: () => now });
    const loaded = await reopened.readCollection("articleBundles");

    assert.equal(loaded.entries[0].articleType, "advertisement");
  });
});

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

test("reordered shortcuts keep their exact order after reopening the repository", async () => {
  await withDatabase(async (database) => {
    const repository = createD1LocalDataRepository({ database, now: () => now });
    await repository.replaceCollection(
      "shortcuts",
      [shortcut("first"), shortcut("second"), shortcut("third")],
      0,
    );
    const reordered = await repository.replaceCollection(
      "shortcuts",
      [shortcut("third"), shortcut("first"), shortcut("second")],
      1,
    );
    const reopened = createD1LocalDataRepository({ database, now: () => now });
    const loaded = await reopened.readCollection("shortcuts");

    assert.equal(reordered.revision, 2);
    assert.equal(loaded.revision, 2);
    assert.deepEqual(loaded.entries.map((entry) => entry.id), ["third", "first", "second"]);
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
