import {
  LOCAL_DATA_COLLECTIONS,
  mergeLegacyLocalData,
  normalizeLocalDataCollection,
  normalizeLocalDataSnapshot,
} from "./local-data-model.mjs";

function serviceError(code, message) {
  return Object.assign(new Error(message), { code });
}

function normalizeRevisions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw serviceError("LOCAL_DATA_CORRUPT", "로컬 DB revision 형식이 올바르지 않습니다.");
  }
  const revisions = {};
  for (const collection of LOCAL_DATA_COLLECTIONS) {
    const revision = value[collection];
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw serviceError("LOCAL_DATA_CORRUPT", "로컬 DB revision 값이 올바르지 않습니다.");
    }
    revisions[collection] = revision;
  }
  return Object.freeze(revisions);
}

function normalizeReadAll(value) {
  return Object.freeze({
    snapshot: normalizeLocalDataSnapshot(value?.snapshot),
    revisions: normalizeRevisions(value?.revisions),
  });
}
function normalizeReadCollection(value, collection) {
  if (value?.collection !== collection || !Number.isSafeInteger(value?.revision) || value.revision < 0) {
    throw serviceError("LOCAL_DATA_CORRUPT", "로컬 DB 컬렉션 응답이 올바르지 않습니다.");
  }
  return Object.freeze({
    collection,
    entries: normalizeLocalDataCollection(collection, value.entries),
    revision: value.revision,
  });
}

function validateMigrationInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw serviceError("INVALID_LOCAL_DATA_MIGRATION", "이전할 로컬 데이터 형식이 올바르지 않습니다.");
  }
  if (
    typeof input.migrationId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{7,159}$/.test(input.migrationId) ||
    typeof input.payloadHash !== "string" ||
    !/^fnv1a64-[0-9a-f]{16}$/.test(input.payloadHash)
  ) {
    throw serviceError("INVALID_LOCAL_DATA_MIGRATION", "로컬 데이터 이전 식별자가 올바르지 않습니다.");
  }
  return Object.freeze({
    migrationId: input.migrationId,
    payloadHash: input.payloadHash,
    snapshot: normalizeLocalDataSnapshot(input.snapshot),
  });
}

function createExclusiveRunner() {
  let queue = Promise.resolve();
  return (operation) => {
    const result = queue.then(operation, operation);
    queue = result.catch(() => undefined);
    return result;
  };
}

export function createLocalDataService({ repository }) {
  if (!repository) throw serviceError("LOCAL_DATA_UNAVAILABLE", "로컬 DB 저장소가 준비되지 않았습니다.");
  const exclusive = createExclusiveRunner();

  const readAll = async () => normalizeReadAll(await repository.readAll());
  const read = async (collection) => {
    if (!LOCAL_DATA_COLLECTIONS.includes(collection)) {
      throw serviceError("INVALID_LOCAL_DATA_COLLECTION", "로컬 데이터 컬렉션이 올바르지 않습니다.");
    }
    return normalizeReadCollection(await repository.readCollection(collection), collection);
  };

  return Object.freeze({
    read,
    readAll,
    async replace(collection, entries, expectedRevision) {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        throw serviceError("INVALID_LOCAL_DATA_REVISION", "로컬 데이터 revision이 올바르지 않습니다.");
      }
      const normalizedEntries = normalizeLocalDataCollection(collection, entries);
      return exclusive(async () => normalizeReadCollection(
        await repository.replaceCollection(collection, normalizedEntries, expectedRevision),
        collection,
      ));
    },
    async importLegacy(input) {
      const migration = validateMigrationInput(input);
      return exclusive(async () => {
        const previousImport = await repository.findImport(migration.migrationId);
        if (previousImport) {
          if (previousImport.payloadHash !== migration.payloadHash) {
            throw serviceError("MIGRATION_CONFLICT", "같은 이전 작업의 데이터가 서로 다릅니다.");
          }
          const current = await readAll();
          return Object.freeze({
            alreadyApplied: true,
            snapshot: current.snapshot,
            revisions: current.revisions,
          });
        }

        const current = await readAll();
        const merged = mergeLegacyLocalData(current.snapshot, migration.snapshot);
        const saved = normalizeReadAll(await repository.replaceAllWithImport({
          snapshot: merged.snapshot,
          expectedRevisions: current.revisions,
          migration: {
            migrationId: migration.migrationId,
            payloadHash: migration.payloadHash,
            imported: merged.imported,
            skipped: merged.skipped,
          },
        }));
        return Object.freeze({
          alreadyApplied: false,
          snapshot: saved.snapshot,
          revisions: saved.revisions,
          imported: merged.imported,
          skipped: merged.skipped,
        });
      });
    },
  });
}
