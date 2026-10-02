import {
  MAX_ARTICLE_BUNDLE_ENTRIES,
  createArticleBundle,
  upsertArticleBundle,
} from "./article-bundles.mjs";
import {
  MAX_GPT_SHORTCUTS,
  addGptShortcut,
  createGptShortcut,
} from "./gpt-shortcuts.mjs";
import {
  MAX_HISTORY_ENTRIES,
  createHistoryEntry,
  upsertHistoryEntry,
} from "./publication-history.mjs";

export const LOCAL_DATA_COLLECTIONS = Object.freeze([
  "articleBundles",
  "publicationHistory",
  "shortcuts",
]);

function localDataError(code, message, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code });
}

function assertCollection(collection) {
  if (!LOCAL_DATA_COLLECTIONS.includes(collection)) {
    throw localDataError("INVALID_LOCAL_DATA_COLLECTION", "로컬 데이터 컬렉션이 올바르지 않습니다.");
  }
}

function assertArray(entries) {
  if (!Array.isArray(entries)) {
    throw localDataError("INVALID_LOCAL_DATA", "저장할 로컬 데이터 형식이 올바르지 않습니다.");
  }
}

function assertUniqueIds(entries) {
  const ids = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id)) {
      throw localDataError("DUPLICATE_LOCAL_DATA_ID", "같은 식별자의 로컬 데이터가 중복되었습니다.");
    }
    ids.add(entry.id);
  }
}

function normalizeArticleBundles(entries) {
  const validated = entries.map((entry) => createArticleBundle(entry));
  assertUniqueIds(validated);
  const normalized = validated.reduce(
    (current, entry) => upsertArticleBundle(current, entry),
    Object.freeze([]),
  );
  if (validated.length > MAX_ARTICLE_BUNDLE_ENTRIES || normalized.length !== validated.length) {
    throw localDataError("LOCAL_DATA_LIMIT_EXCEEDED", "글뭉치 저장 한도를 초과했습니다.");
  }
  return normalized;
}

function normalizePublicationHistory(entries) {
  const validated = entries.map((entry) => createHistoryEntry(entry));
  assertUniqueIds(validated);
  const normalized = validated.reduce(
    (current, entry) => upsertHistoryEntry(current, entry),
    Object.freeze([]),
  );
  if (validated.length > MAX_HISTORY_ENTRIES || normalized.length !== validated.length) {
    throw localDataError("LOCAL_DATA_LIMIT_EXCEEDED", "발행 히스토리 저장 한도를 초과했습니다.");
  }
  return normalized;
}

function normalizeShortcuts(entries) {
  if (entries.length > MAX_GPT_SHORTCUTS) {
    throw localDataError("LOCAL_DATA_LIMIT_EXCEEDED", "바로가기 저장 한도를 초과했습니다.");
  }
  return entries.reduce(
    (current, entry) => addGptShortcut(current, createGptShortcut(entry)),
    Object.freeze([]),
  );
}

export function normalizeLocalDataCollection(collection, entries) {
  assertCollection(collection);
  assertArray(entries);
  if (collection === "articleBundles") return normalizeArticleBundles(entries);
  if (collection === "publicationHistory") return normalizePublicationHistory(entries);
  return normalizeShortcuts(entries);
}

export function createEmptyLocalDataSnapshot() {
  return Object.freeze({
    articleBundles: Object.freeze([]),
    publicationHistory: Object.freeze([]),
    shortcuts: Object.freeze([]),
  });
}

export function normalizeLocalDataSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw localDataError("INVALID_LOCAL_DATA", "로컬 데이터 묶음 형식이 올바르지 않습니다.");
  }
  return Object.freeze({
    articleBundles: normalizeLocalDataCollection("articleBundles", value.articleBundles),
    publicationHistory: normalizeLocalDataCollection("publicationHistory", value.publicationHistory),
    shortcuts: normalizeLocalDataCollection("shortcuts", value.shortcuts),
  });
}

export function replaceLocalDataCollection(snapshot, collection, entries) {
  const normalized = normalizeLocalDataSnapshot(snapshot);
  const current = Object.isFrozen(snapshot) && LOCAL_DATA_COLLECTIONS.every(
    (name) => Object.isFrozen(snapshot[name]),
  ) ? snapshot : normalized;
  const nextEntries = normalizeLocalDataCollection(collection, entries);
  return Object.freeze({ ...current, [collection]: nextEntries });
}

function mergeTimestampedCollection(collection, databaseEntries, legacyEntries) {
  let nextEntries = databaseEntries;
  let imported = 0;
  let skipped = 0;
  for (const legacyEntry of legacyEntries) {
    const current = nextEntries.find((entry) => entry.id === legacyEntry.id);
    if (current && Date.parse(current.updatedAt) >= Date.parse(legacyEntry.updatedAt)) {
      skipped += 1;
      continue;
    }
    const candidate = collection === "articleBundles" && current
      ? { ...legacyEntry, createdAt: current.createdAt }
      : collection === "publicationHistory" && current
        ? { ...legacyEntry, completedAt: current.completedAt }
        : legacyEntry;
    const candidateEntries = collection === "articleBundles"
      ? upsertArticleBundle(nextEntries, candidate)
      : upsertHistoryEntry(nextEntries, candidate);
    const existingIdsPreserved = nextEntries.every((entry) => (
      candidateEntries.some((candidateEntry) => candidateEntry.id === entry.id)
    ));
    if (!candidateEntries.some((entry) => entry.id === candidate.id) || !existingIdsPreserved) {
      skipped += 1;
    } else {
      nextEntries = candidateEntries;
      imported += 1;
    }
  }
  return Object.freeze({ entries: nextEntries, imported, skipped });
}

function mergeShortcuts(databaseEntries, legacyEntries) {
  let nextEntries = databaseEntries;
  let imported = 0;
  let skipped = 0;
  for (const legacyEntry of legacyEntries) {
    try {
      nextEntries = addGptShortcut(nextEntries, legacyEntry);
      imported += 1;
    } catch {
      skipped += 1;
    }
  }
  return Object.freeze({ entries: nextEntries, imported, skipped });
}

export function mergeLegacyLocalData(databaseSnapshot, legacySnapshot) {
  const database = normalizeLocalDataSnapshot(databaseSnapshot);
  const legacy = normalizeLocalDataSnapshot(legacySnapshot);
  const bundles = mergeTimestampedCollection(
    "articleBundles",
    database.articleBundles,
    legacy.articleBundles,
  );
  const history = mergeTimestampedCollection(
    "publicationHistory",
    database.publicationHistory,
    legacy.publicationHistory,
  );
  const shortcuts = mergeShortcuts(database.shortcuts, legacy.shortcuts);
  return Object.freeze({
    snapshot: Object.freeze({
      articleBundles: bundles.entries,
      publicationHistory: history.entries,
      shortcuts: shortcuts.entries,
    }),
    imported: Object.freeze({
      articleBundles: bundles.imported,
      publicationHistory: history.imported,
      shortcuts: shortcuts.imported,
    }),
    skipped: Object.freeze({
      articleBundles: bundles.skipped,
      publicationHistory: history.skipped,
      shortcuts: shortcuts.skipped,
    }),
  });
}
