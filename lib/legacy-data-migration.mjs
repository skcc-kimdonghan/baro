import { loadArticleBundles } from "./article-bundles.mjs";
import { loadGptShortcuts } from "./gpt-shortcuts.mjs";
import { normalizeLocalDataSnapshot } from "./local-data-model.mjs";
import { loadPublicationHistory } from "./publication-history.mjs";

export const LEGACY_MIGRATION_MARKER_KEY = "naver-blog-finalizer.database-migration.v1";

const FNV64_OFFSET = 14_695_981_039_346_656_037n;
const FNV64_PRIME = 1_099_511_628_211n;
const FNV64_MASK = 0xffff_ffff_ffff_ffffn;

function hashSnapshot(snapshot) {
  const source = JSON.stringify(snapshot);
  let hash = FNV64_OFFSET;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= BigInt(source.charCodeAt(index));
    hash = (hash * FNV64_PRIME) & FNV64_MASK;
  }
  return `fnv1a64-${hash.toString(16).padStart(16, "0")}`;
}

function readMarker(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(LEGACY_MIGRATION_MARKER_KEY) ?? "null");
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.migrationId === "string" &&
      typeof parsed.payloadHash === "string"
    ) return parsed;
  } catch {
    // A corrupt marker is replaced without touching the original legacy data.
  }
  return null;
}

function writeMarker(storage, marker) {
  storage.setItem(LEGACY_MIGRATION_MARKER_KEY, JSON.stringify(marker));
}

function loadLegacySnapshot(storage) {
  const bundles = loadArticleBundles(storage);
  const history = loadPublicationHistory(storage);
  const shortcuts = loadGptShortcuts(storage);
  const warnings = [
    bundles.warning ? `글뭉치: ${bundles.warning}` : "",
    history.warning ? `발행 히스토리: ${history.warning}` : "",
    shortcuts.warning ? `바로가기: ${shortcuts.warning}` : "",
  ].filter(Boolean);
  return Object.freeze({
    snapshot: normalizeLocalDataSnapshot({
      articleBundles: bundles.entries,
      publicationHistory: history.entries,
      shortcuts: shortcuts.entries,
    }),
    warning: warnings.join(" "),
  });
}

export async function migrateLegacyLocalData({ storage, client, idFactory }) {
  const loaded = loadLegacySnapshot(storage);
  const snapshot = loaded.snapshot;
  const totalEntries = snapshot.articleBundles.length + snapshot.publicationHistory.length + snapshot.shortcuts.length;
  if (totalEntries === 0) {
    return Object.freeze({ status: "empty", warning: loaded.warning });
  }

  const payloadHash = hashSnapshot(snapshot);
  const existingMarker = readMarker(storage);
  const migrationId = existingMarker?.payloadHash === payloadHash
    ? existingMarker.migrationId
    : idFactory();
  const pendingMarker = Object.freeze({ migrationId, payloadHash, status: "pending" });
  writeMarker(storage, pendingMarker);

  const result = await client.importLegacy({ migrationId, payloadHash, snapshot });
  writeMarker(storage, { ...pendingMarker, status: "complete" });
  return Object.freeze({
    status: result.alreadyApplied ? "already-applied" : "migrated",
    warning: loaded.warning,
  });
}
