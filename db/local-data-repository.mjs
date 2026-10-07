const COLLECTIONS = Object.freeze(["articleBundles", "publicationHistory", "shortcuts"]);

const SCHEMA_STATEMENTS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS article_bundles (
    id TEXT PRIMARY KEY NOT NULL,
    schema_version INTEGER NOT NULL,
    source_text TEXT NOT NULL,
    header_color TEXT NOT NULL,
    article_titles_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    article_type TEXT DEFAULT 'information' NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS article_bundles_updated_at_idx
    ON article_bundles (updated_at, id)`,
  `CREATE TABLE IF NOT EXISTS publication_history (
    id TEXT PRIMARY KEY NOT NULL,
    schema_version INTEGER NOT NULL,
    title TEXT NOT NULL,
    prepared_text TEXT NOT NULL,
    published_text TEXT NOT NULL,
    comparison_json TEXT,
    completed_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS publication_history_completed_at_idx
    ON publication_history (completed_at, id)`,
  `CREATE TABLE IF NOT EXISTS gpt_shortcuts (
    id TEXT PRIMARY KEY NOT NULL,
    schema_version INTEGER NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS gpt_shortcuts_name_idx
    ON gpt_shortcuts (name)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS gpt_shortcuts_url_idx
    ON gpt_shortcuts (url)`,
  `CREATE TABLE IF NOT EXISTS collection_revisions (
    collection TEXT PRIMARY KEY NOT NULL,
    revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS local_data_imports (
    migration_id TEXT PRIMARY KEY NOT NULL,
    payload_hash TEXT NOT NULL,
    result_json TEXT NOT NULL,
    completed_at TEXT NOT NULL
  )`,
  ...COLLECTIONS.map((collection) => `INSERT OR IGNORE INTO collection_revisions
    (collection, revision, updated_at) VALUES ('${collection}', 0, '1970-01-01T00:00:00.000Z')`),
]);

function repositoryError(code, message, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code });
}

function parseJson(value, label) {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch (cause) {
    throw repositoryError("LOCAL_DATA_CORRUPT", `${label}의 DB 데이터가 손상되었습니다.`, cause);
  }
}

function mapArticleBundle(row) {
  return {
    schemaVersion: row.schema_version,
    id: row.id,
    sourceText: row.source_text,
    headerColor: row.header_color,
    articleType: row.article_type,
    articleTitles: parseJson(row.article_titles_json, "글뭉치"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapHistory(row) {
  return {
    schemaVersion: row.schema_version,
    id: row.id,
    title: row.title,
    preparedText: row.prepared_text,
    publishedText: row.published_text,
    comparison: row.comparison_json === null ? null : parseJson(row.comparison_json, "발행 히스토리"),
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

function mapShortcut(row) {
  return {
    schemaVersion: row.schema_version,
    id: row.id,
    name: row.name,
    url: row.url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const COLLECTION_CONFIG = Object.freeze({
  articleBundles: Object.freeze({
    table: "article_bundles",
    select: `SELECT schema_version, id, source_text, header_color, article_type, article_titles_json,
      created_at, updated_at FROM article_bundles ORDER BY updated_at DESC, id ASC`,
    map: mapArticleBundle,
    insert(database, entry) {
      return database.prepare(`INSERT INTO article_bundles
        (id, schema_version, source_text, header_color, article_type, article_titles_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          entry.id,
          entry.schemaVersion,
          entry.sourceText,
          entry.headerColor,
          entry.articleType,
          JSON.stringify(entry.articleTitles),
          entry.createdAt,
          entry.updatedAt,
        );
    },
  }),
  publicationHistory: Object.freeze({
    table: "publication_history",
    select: `SELECT schema_version, id, title, prepared_text, published_text, comparison_json,
      completed_at, updated_at FROM publication_history ORDER BY completed_at DESC, id ASC`,
    map: mapHistory,
    insert(database, entry) {
      return database.prepare(`INSERT INTO publication_history
        (id, schema_version, title, prepared_text, published_text, comparison_json, completed_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          entry.id,
          entry.schemaVersion,
          entry.title,
          entry.preparedText,
          entry.publishedText,
          entry.comparison === null || entry.comparison === undefined
            ? null
            : JSON.stringify(entry.comparison),
          entry.completedAt,
          entry.updatedAt,
        );
    },
  }),
  shortcuts: Object.freeze({
    table: "gpt_shortcuts",
    select: `SELECT schema_version, id, name, url, sort_order, created_at, updated_at
      FROM gpt_shortcuts ORDER BY sort_order ASC, id ASC`,
    map: mapShortcut,
    insert(database, entry, index) {
      return database.prepare(`INSERT INTO gpt_shortcuts
        (id, schema_version, name, url, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(entry.id, entry.schemaVersion, entry.name, entry.url, index, entry.createdAt, entry.updatedAt);
    },
  }),
});

function collectionConfig(collection) {
  const config = COLLECTION_CONFIG[collection];
  if (!config) throw repositoryError("INVALID_LOCAL_DATA_COLLECTION", "로컬 데이터 컬렉션이 올바르지 않습니다.");
  return config;
}

async function currentRevision(database, collection) {
  const row = await database.prepare(
    "SELECT revision FROM collection_revisions WHERE collection = ?",
  ).bind(collection).first();
  if (!row || !Number.isSafeInteger(row.revision) || row.revision < 0) {
    throw repositoryError("LOCAL_DATA_CORRUPT", "로컬 DB revision을 읽지 못했습니다.");
  }
  return row.revision;
}

function revisionStatement(database, collection, revision, timestamp) {
  return database.prepare(`INSERT INTO collection_revisions (collection, revision, updated_at)
    VALUES (?, ?, ?) ON CONFLICT(collection) DO UPDATE SET
    revision = excluded.revision, updated_at = excluded.updated_at`)
    .bind(collection, revision, timestamp);
}

function revisionAssertionStatement(database, collection, expectedRevision) {
  return database.prepare(`INSERT INTO collection_revisions (collection, revision, updated_at)
    SELECT collection, revision, updated_at FROM collection_revisions
    WHERE collection = ? AND revision <> ?`)
    .bind(collection, expectedRevision);
}

function replaceStatements(database, collection, entries, expectedRevision, timestamp) {
  const config = collectionConfig(collection);
  return [
    revisionAssertionStatement(database, collection, expectedRevision),
    database.prepare(`DELETE FROM ${config.table}`),
    ...entries.map((entry, index) => config.insert(database, entry, index)),
    revisionStatement(database, collection, expectedRevision + 1, timestamp),
  ];
}

async function throwWriteError(database, expectedRevisions, cause) {
  const collections = Object.keys(expectedRevisions);
  const revisions = await Promise.all(collections.map((collection) => currentRevision(database, collection)));
  if (collections.some((collection, index) => revisions[index] !== expectedRevisions[collection])) {
    throw repositoryError("REVISION_CONFLICT", "로컬 DB revision이 변경되었습니다.", cause);
  }
  throw repositoryError("LOCAL_DATA_WRITE_FAILED", "로컬 DB에 데이터를 저장하지 못했습니다.", cause);
}

export async function applyLocalDataSchema(database) {
  await database.batch(SCHEMA_STATEMENTS.map((statement) => database.prepare(statement)));
}

export function createD1LocalDataRepository({ database, now = () => new Date().toISOString() }) {
  if (!database?.prepare || !database?.batch) {
    throw repositoryError("LOCAL_DATA_UNAVAILABLE", "로컬 D1 데이터베이스를 사용할 수 없습니다.");
  }

  const readCollection = async (collection) => {
    const config = collectionConfig(collection);
    const [query, revisionQuery] = await database.batch([
      database.prepare(config.select),
      database.prepare("SELECT revision FROM collection_revisions WHERE collection = ?").bind(collection),
    ]);
    const revision = revisionQuery.results?.[0]?.revision;
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw repositoryError("LOCAL_DATA_CORRUPT", "로컬 DB revision을 읽지 못했습니다.");
    }
    return {
      collection,
      entries: (query.results ?? []).map(config.map),
      revision,
    };
  };

  const readAll = async () => {
    const statements = COLLECTIONS.flatMap((collection) => {
      const config = collectionConfig(collection);
      return [
        database.prepare(config.select),
        database.prepare("SELECT revision FROM collection_revisions WHERE collection = ?").bind(collection),
      ];
    });
    const results = await database.batch(statements);
    const collections = COLLECTIONS.map((collection, index) => {
      const config = collectionConfig(collection);
      const query = results[index * 2];
      const revision = results[index * 2 + 1].results?.[0]?.revision;
      if (!Number.isSafeInteger(revision) || revision < 0) {
        throw repositoryError("LOCAL_DATA_CORRUPT", "로컬 DB revision을 읽지 못했습니다.");
      }
      return {
        collection,
        entries: (query.results ?? []).map(config.map),
        revision,
      };
    });
    return {
      snapshot: Object.fromEntries(collections.map((item) => [item.collection, item.entries])),
      revisions: Object.fromEntries(collections.map((item) => [item.collection, item.revision])),
    };
  };

  return Object.freeze({
    readCollection,
    readAll,
    async replaceCollection(collection, entries, expectedRevision) {
      collectionConfig(collection);
      try {
        await database.batch(replaceStatements(database, collection, entries, expectedRevision, now()));
      } catch (cause) {
        await throwWriteError(database, { [collection]: expectedRevision }, cause);
      }
      return readCollection(collection);
    },
    async findImport(migrationId) {
      const row = await database.prepare(
        "SELECT migration_id, payload_hash, result_json, completed_at FROM local_data_imports WHERE migration_id = ?",
      ).bind(migrationId).first();
      if (!row) return null;
      return {
        migrationId: row.migration_id,
        payloadHash: row.payload_hash,
        result: parseJson(row.result_json, "데이터 이전 기록"),
        completedAt: row.completed_at,
      };
    },
    async replaceAllWithImport({ snapshot, expectedRevisions, migration }) {
      const timestamp = now();
      const statements = COLLECTIONS.flatMap((collection) => replaceStatements(
        database,
        collection,
        snapshot[collection],
        expectedRevisions[collection],
        timestamp,
      ));
      statements.push(database.prepare(`INSERT INTO local_data_imports
        (migration_id, payload_hash, result_json, completed_at) VALUES (?, ?, ?, ?)`)
        .bind(
          migration.migrationId,
          migration.payloadHash,
          JSON.stringify({ imported: migration.imported, skipped: migration.skipped }),
          timestamp,
        ));
      try {
        await database.batch(statements);
      } catch (cause) {
        await throwWriteError(database, expectedRevisions, cause);
      }
      return readAll();
    },
  });
}
