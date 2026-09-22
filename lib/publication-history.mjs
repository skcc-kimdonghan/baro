export const HISTORY_STORAGE_KEY = "naver-blog-finalizer.publication-history.v1";
export const MAX_HISTORY_ENTRIES = 50;
export const MAX_HISTORY_CHARACTERS = 2_000_000;

const MAX_HISTORY_TEXT_LENGTH = 100_000;
const MAX_HISTORY_TITLE_LENGTH = 200;
const MAX_HISTORY_SERIALIZED_LENGTH = 2_500_000;
const VALID_COMPARISON_STATUSES = new Set(["match", "formatting-only", "different"]);
const VALID_ISSUE_TYPES = new Set(["missing", "added", "formatting", "order", "ride-footer"]);
const FNV64_OFFSET = 14_695_981_039_346_656_037n;
const FNV64_PRIME = 1_099_511_628_211n;
const FNV64_MASK = 0xffff_ffff_ffff_ffffn;

function historyError(message, code, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value) {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function sanitizeIssue(value) {
  if (!isRecord(value) || !VALID_ISSUE_TYPES.has(value.type)) return null;
  if (typeof value.title !== "string" || typeof value.detail !== "string") return null;
  const samples = Array.isArray(value.samples)
    ? value.samples.filter((sample) => typeof sample === "string").slice(0, 3)
    : [];
  return Object.freeze({
    type: value.type,
    title: value.title.slice(0, 200),
    detail: value.detail.slice(0, 500),
    samples: Object.freeze(samples.map((sample) => sample.slice(0, 140))),
  });
}

function sanitizeComparison(value) {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || !VALID_COMPARISON_STATUSES.has(value.status)) return null;
  if (!Number.isFinite(value.score) || value.score < 0 || value.score > 100) return null;
  if (typeof value.summary !== "string" || !Array.isArray(value.issues)) return null;
  const issues = value.issues.slice(0, 20).map(sanitizeIssue);
  if (issues.some((issue) => issue === null)) return null;
  return Object.freeze({
    status: value.status,
    score: Math.round(value.score),
    summary: value.summary.slice(0, 500),
    issues: Object.freeze(issues),
    expectedCharacters: Number.isFinite(value.expectedCharacters) ? Math.max(0, Math.round(value.expectedCharacters)) : 0,
    actualCharacters: Number.isFinite(value.actualCharacters) ? Math.max(0, Math.round(value.actualCharacters)) : 0,
  });
}

function sanitizeEntry(value) {
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== 1) return null;
  if (typeof value.id !== "string" || !value.id.trim() || value.id.length > 200) return null;
  if (typeof value.title !== "string" || !value.title.trim() || value.title.length > MAX_HISTORY_TITLE_LENGTH) return null;
  if (typeof value.preparedText !== "string" || value.preparedText.length > MAX_HISTORY_TEXT_LENGTH) return null;
  if (typeof value.publishedText !== "string" || value.publishedText.length > MAX_HISTORY_TEXT_LENGTH) return null;
  if (!isIsoDate(value.completedAt) || !isIsoDate(value.updatedAt)) return null;
  const comparison = sanitizeComparison(value.comparison);
  if (value.comparison !== null && value.comparison !== undefined && !comparison) return null;

  return Object.freeze({
    schemaVersion: 1,
    id: value.id,
    title: value.title,
    preparedText: value.preparedText,
    publishedText: value.publishedText,
    comparison,
    completedAt: new Date(value.completedAt).toISOString(),
    updatedAt: new Date(value.updatedAt).toISOString(),
  });
}

function compareNewest(left, right) {
  return Date.parse(right.completedAt) - Date.parse(left.completedAt);
}

function normalizeEntries(entries) {
  const byId = new Map();
  entries
    .map(sanitizeEntry)
    .filter(Boolean)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .forEach((entry) => {
      if (!byId.has(entry.id)) byId.set(entry.id, entry);
    });

  const mostRecentlyUpdated = [...byId.values()].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  );
  const bounded = [];
  let totalCharacters = 0;
  for (const entry of mostRecentlyUpdated) {
    if (bounded.length >= MAX_HISTORY_ENTRIES) break;
    const entryCharacters = entry.preparedText.length + entry.publishedText.length;
    if (totalCharacters + entryCharacters > MAX_HISTORY_CHARACTERS) continue;
    bounded.push(entry);
    totalCharacters += entryCharacters;
  }
  return Object.freeze(bounded.sort(compareNewest));
}

function fitSerializedEntries(entries) {
  let fitted = [...entries];
  let serialized = JSON.stringify(fitted);

  while (serialized.length > MAX_HISTORY_SERIALIZED_LENGTH && fitted.length > 1) {
    let oldestUpdatedIndex = fitted.length - 1;
    for (let index = fitted.length - 2; index >= 0; index -= 1) {
      if (Date.parse(fitted[index].updatedAt) < Date.parse(fitted[oldestUpdatedIndex].updatedAt)) {
        oldestUpdatedIndex = index;
      }
    }
    fitted = fitted.filter((_, index) => index !== oldestUpdatedIndex);
    serialized = JSON.stringify(fitted);
  }

  if (serialized.length > MAX_HISTORY_SERIALIZED_LENGTH) {
    throw historyError("한 개의 발행 기록이 저장 한도를 넘습니다.", "HISTORY_ENTRY_TOO_LARGE");
  }

  return Object.freeze({ entries: Object.freeze(fitted), serialized });
}

export function createHistoryEntry(value) {
  const entry = sanitizeEntry({ ...value, schemaVersion: 1 });
  if (!entry) throw historyError("발행 히스토리 항목이 올바르지 않습니다.", "INVALID_HISTORY_ENTRY");
  return entry;
}

export function createHistoryIdFromContent(title, preparedText) {
  const source = `${String(title ?? "")}\n${String(preparedText ?? "")}`;
  let hash = FNV64_OFFSET;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= BigInt(source.charCodeAt(index));
    hash = (hash * FNV64_PRIME) & FNV64_MASK;
  }
  return `article-${hash.toString(16).padStart(16, "0")}`;
}

export function upsertHistoryEntry(entries, nextEntry) {
  const entry = createHistoryEntry(nextEntry);
  return normalizeEntries([entry, ...entries.filter((item) => item.id !== entry.id)]);
}

export function removeHistoryEntry(entries, entryId) {
  return normalizeEntries(entries.filter((entry) => entry.id !== entryId));
}

export function loadPublicationHistory(storage) {
  let serialized;
  try {
    serialized = storage.getItem(HISTORY_STORAGE_KEY);
  } catch (caughtError) {
    throw historyError("이 브라우저의 발행 히스토리를 읽을 수 없습니다.", "HISTORY_READ_FAILED", caughtError);
  }
  if (!serialized) return Object.freeze({ entries: Object.freeze([]), warning: "" });
  if (serialized.length > MAX_HISTORY_SERIALIZED_LENGTH) {
    return Object.freeze({
      entries: Object.freeze([]),
      warning: "저장된 발행 히스토리가 허용 크기를 넘어 읽지 않았습니다. 전체 삭제로 초기화할 수 있습니다.",
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return Object.freeze({
      entries: Object.freeze([]),
      warning: "저장된 발행 히스토리를 읽지 못했습니다. 전체 삭제로 초기화할 수 있습니다.",
    });
  }
  if (!Array.isArray(parsed)) {
    return Object.freeze({
      entries: Object.freeze([]),
      warning: "저장된 발행 히스토리 형식이 올바르지 않습니다.",
    });
  }

  const entries = normalizeEntries(parsed);
  const warning = entries.length < parsed.length
    ? `올바르지 않거나 저장 한도를 넘긴 히스토리 ${parsed.length - entries.length}건을 제외했습니다.`
    : "";
  return Object.freeze({ entries, warning });
}

export function savePublicationHistory(storage, entries) {
  const normalized = normalizeEntries(entries);
  const fitted = fitSerializedEntries(normalized);
  try {
    storage.setItem(HISTORY_STORAGE_KEY, fitted.serialized);
  } catch (caughtError) {
    throw historyError(
      "발행 히스토리를 저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.",
      "HISTORY_WRITE_FAILED",
      caughtError,
    );
  }
  return fitted.entries;
}

export function clearPublicationHistory(storage) {
  try {
    storage.removeItem(HISTORY_STORAGE_KEY);
  } catch (caughtError) {
    throw historyError("발행 히스토리를 삭제하지 못했습니다.", "HISTORY_CLEAR_FAILED", caughtError);
  }
  return Object.freeze([]);
}
