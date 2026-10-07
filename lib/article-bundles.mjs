export const ARTICLE_BUNDLE_STORAGE_KEY = "naver-blog-finalizer.article-bundles.local.v1";
export const MAX_ARTICLE_BUNDLE_ENTRIES = 20;
export const MAX_ARTICLE_BUNDLE_CHARACTERS = 1_000_000;

const MAX_ARTICLE_BUNDLE_SERIALIZED_LENGTH = 1_250_000;
const MAX_SOURCE_TEXT_LENGTH = 100_000;
const MAX_ARTICLE_TITLES = 50;
const MAX_ARTICLE_TITLE_LENGTH = 100;
const VALID_COLOR = /^#[0-9A-F]{6}$/;
const VALID_ARTICLE_TYPES = Object.freeze(["information", "advertisement"]);
const FNV64_OFFSET = 14_695_981_039_346_656_037n;
const FNV64_PRIME = 1_099_511_628_211n;
const FNV64_MASK = 0xffff_ffff_ffff_ffffn;

function bundleError(message, code, cause) {
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

function createDisplayTitle(articleTitles) {
  const firstTitle = articleTitles[0]?.trim() || "제목 없는 글";
  return articleTitles.length > 1 ? `${firstTitle} 외 ${articleTitles.length - 1}편` : firstTitle;
}

function sanitizeEntry(value) {
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  if (typeof value.id !== "string" || !value.id.trim() || value.id.length > 200) return null;
  if (typeof value.sourceText !== "string" || !value.sourceText.trim() || value.sourceText.length > MAX_SOURCE_TEXT_LENGTH) return null;
  if (typeof value.headerColor !== "string") return null;
  const headerColor = value.headerColor.toUpperCase();
  if (!VALID_COLOR.test(headerColor)) return null;
  const articleType = value.articleType ?? "information";
  if (!VALID_ARTICLE_TYPES.includes(articleType)) return null;
  if (!Array.isArray(value.articleTitles) || value.articleTitles.length < 1 || value.articleTitles.length > MAX_ARTICLE_TITLES) return null;
  if (value.articleTitles.some((title) => typeof title !== "string" || title.length > MAX_ARTICLE_TITLE_LENGTH)) return null;
  if (!isIsoDate(value.createdAt) || !isIsoDate(value.updatedAt)) return null;
  const createdAt = new Date(value.createdAt).toISOString();
  const updatedAt = new Date(value.updatedAt).toISOString();
  if (Date.parse(updatedAt) < Date.parse(createdAt)) return null;
  const articleTitles = Object.freeze(value.articleTitles.map((title) => title.trim() || "제목 없는 글"));

  return Object.freeze({
    schemaVersion: 1,
    id: value.id,
    displayTitle: createDisplayTitle(articleTitles),
    sourceText: value.sourceText,
    headerColor,
    articleType,
    articleTitles,
    createdAt,
    updatedAt,
  });
}

function compareRecent(left, right) {
  const timestampDifference = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  return timestampDifference || left.id.localeCompare(right.id);
}

function entryCharacters(entry) {
  return entry.sourceText.length + entry.articleTitles.reduce((sum, title) => sum + title.length, 0);
}

function normalizeEntries(entries, preferredEntryId = "") {
  const byId = new Map();
  entries
    .map(sanitizeEntry)
    .filter(Boolean)
    .sort(compareRecent)
    .forEach((entry) => {
      if (!byId.has(entry.id)) byId.set(entry.id, entry);
    });

  const uniqueEntries = [...byId.values()];
  const preferredEntry = preferredEntryId
    ? uniqueEntries.find((entry) => entry.id === preferredEntryId)
    : null;
  const selectionOrder = preferredEntry
    ? [preferredEntry, ...uniqueEntries.filter((entry) => entry.id !== preferredEntryId)]
    : uniqueEntries;
  const bounded = [];
  let totalCharacters = 0;
  for (const entry of selectionOrder) {
    if (bounded.length >= MAX_ARTICLE_BUNDLE_ENTRIES) break;
    const characters = entryCharacters(entry);
    if (totalCharacters + characters > MAX_ARTICLE_BUNDLE_CHARACTERS) continue;
    bounded.push(entry);
    totalCharacters += characters;
  }
  return Object.freeze(bounded.sort(compareRecent));
}

function fitSerializedEntries(entries, preferredEntryId = "") {
  let fitted = [...entries];
  let serialized = JSON.stringify(fitted);

  while (serialized.length > MAX_ARTICLE_BUNDLE_SERIALIZED_LENGTH && fitted.length > 1) {
    const removableIndex = preferredEntryId
      ? fitted.findLastIndex((entry) => entry.id !== preferredEntryId)
      : fitted.length - 1;
    if (removableIndex < 0) break;
    fitted = fitted.filter((_, index) => index !== removableIndex);
    serialized = JSON.stringify(fitted);
  }
  if (serialized.length > MAX_ARTICLE_BUNDLE_SERIALIZED_LENGTH) {
    throw bundleError("한 개의 글뭉치가 브라우저 저장 한도를 넘습니다.", "ARTICLE_BUNDLE_ENTRY_TOO_LARGE");
  }
  return Object.freeze({ entries: Object.freeze(fitted), serialized });
}

export function createArticleBundle(value) {
  const entry = sanitizeEntry({ ...value, schemaVersion: 1 });
  if (!entry) throw bundleError("저장할 글뭉치 형식이 올바르지 않습니다.", "INVALID_ARTICLE_BUNDLE");
  return entry;
}

export function createArticleBundleId(sourceText) {
  const source = String(sourceText ?? "").replace(/\r\n?/g, "\n");
  let hash = FNV64_OFFSET;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= BigInt(source.charCodeAt(index));
    hash = (hash * FNV64_PRIME) & FNV64_MASK;
  }
  return `bundle-${hash.toString(16).padStart(16, "0")}`;
}

export function upsertArticleBundle(entries, nextEntry) {
  const current = entries.find((entry) => entry.id === nextEntry.id);
  const updatedAt = current && Date.parse(current.updatedAt) > Date.parse(nextEntry.updatedAt)
    ? current.updatedAt
    : nextEntry.updatedAt;
  const entry = createArticleBundle({
    ...nextEntry,
    createdAt: current?.createdAt ?? nextEntry.createdAt,
    updatedAt,
  });
  return normalizeEntries([entry, ...entries.filter((item) => item.id !== entry.id)], entry.id);
}

export function hasArticleBundleWorkspaceChanges(entry, workspace) {
  if (!workspace?.sourceText?.trim()) return false;
  if (workspace.sourceText !== entry.sourceText) return true;
  if (workspace.headerColor !== entry.headerColor) return true;
  if ((workspace.articleType ?? "information") !== entry.articleType) return true;
  if (workspace.hasPublicationWork) return true;
  if (!Array.isArray(workspace.articleTitles)) return false;
  if (workspace.articleTitles.length !== entry.articleTitles.length) return true;
  return workspace.articleTitles.some((title, index) => title !== entry.articleTitles[index]);
}

export function removeArticleBundle(entries, entryId) {
  return normalizeEntries(entries.filter((entry) => entry.id !== entryId));
}

export function loadArticleBundles(storage) {
  let serialized;
  try {
    serialized = storage.getItem(ARTICLE_BUNDLE_STORAGE_KEY);
  } catch (caughtError) {
    throw bundleError("이 브라우저의 저장된 글뭉치를 읽을 수 없습니다.", "ARTICLE_BUNDLE_READ_FAILED", caughtError);
  }
  if (!serialized) return Object.freeze({ entries: Object.freeze([]), warning: "" });
  if (serialized.length > MAX_ARTICLE_BUNDLE_SERIALIZED_LENGTH) {
    return Object.freeze({
      entries: Object.freeze([]),
      warning: "저장된 글뭉치가 허용 크기를 넘어 읽지 않았습니다. 전체 삭제로 초기화할 수 있습니다.",
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return Object.freeze({
      entries: Object.freeze([]),
      warning: "저장된 글뭉치를 읽지 못했습니다. 전체 삭제로 초기화할 수 있습니다.",
    });
  }
  if (!Array.isArray(parsed)) {
    return Object.freeze({ entries: Object.freeze([]), warning: "저장된 글뭉치 형식이 올바르지 않습니다." });
  }

  const entries = normalizeEntries(parsed);
  const warning = entries.length < parsed.length
    ? `올바르지 않거나 저장 한도를 넘긴 글뭉치 ${parsed.length - entries.length}건을 제외했습니다.`
    : "";
  return Object.freeze({ entries, warning });
}

export function saveArticleBundles(storage, entries, preferredEntryId = "") {
  const fitted = fitSerializedEntries(normalizeEntries(entries, preferredEntryId), preferredEntryId);
  try {
    storage.setItem(ARTICLE_BUNDLE_STORAGE_KEY, fitted.serialized);
  } catch (caughtError) {
    const isQuotaError = caughtError instanceof Error && caughtError.name === "QuotaExceededError";
    throw bundleError(
      isQuotaError
        ? "브라우저 저장 공간이 부족합니다. 오래된 글뭉치를 삭제한 뒤 다시 저장해 주세요."
        : "글뭉치를 저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.",
      isQuotaError ? "ARTICLE_BUNDLE_QUOTA_EXCEEDED" : "ARTICLE_BUNDLE_WRITE_FAILED",
      caughtError,
    );
  }
  return fitted.entries;
}

export function clearArticleBundles(storage) {
  try {
    storage.removeItem(ARTICLE_BUNDLE_STORAGE_KEY);
  } catch (caughtError) {
    throw bundleError("저장된 글뭉치를 삭제하지 못했습니다.", "ARTICLE_BUNDLE_CLEAR_FAILED", caughtError);
  }
  return Object.freeze([]);
}
