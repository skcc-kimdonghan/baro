export const GPT_SHORTCUT_STORAGE_KEY = "naver-blog-finalizer.gpt-shortcuts.local.v1";
export const MAX_GPT_SHORTCUTS = 6;
export const MAX_GPT_SHORTCUT_NAME_LENGTH = 30;

const MAX_GPT_SHORTCUT_URL_LENGTH = 2_048;
const MAX_GPT_SHORTCUT_STORAGE_LENGTH = 20_000;
const BLOCKED_HOSTNAME_SUFFIXES = Object.freeze([
  "localhost",
  "local",
  "localdomain",
  "internal",
  "intranet",
  "home",
  "lan",
  "home.arpa",
  "test",
  "invalid",
  "example",
  "onion",
]);

function gptShortcutError(code, message) {
  return Object.assign(new Error(message), { code });
}

function freezeEntries(entries) {
  return Object.freeze(entries.map((entry) => Object.freeze({ ...entry })));
}

function normalizeTimestamp(value, fieldName) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw gptShortcutError("INVALID_GPT_SHORTCUT", `${fieldName} 시간이 올바르지 않습니다.`);
  }
  return new Date(value).toISOString();
}

function normalizeName(value) {
  if (typeof value !== "string") {
    throw gptShortcutError("INVALID_GPT_SHORTCUT_NAME", "바로가기 이름을 입력해 주세요.");
  }
  const name = value.trim();
  if (!name || name.length > MAX_GPT_SHORTCUT_NAME_LENGTH) {
    throw gptShortcutError(
      "INVALID_GPT_SHORTCUT_NAME",
      `바로가기 이름은 1~${MAX_GPT_SHORTCUT_NAME_LENGTH}자로 입력해 주세요.`,
    );
  }
  return name;
}

function normalizeHostname(value) {
  return value.toLowerCase().replace(/\.+$/, "");
}

function isPublicHostname(value) {
  const hostname = normalizeHostname(value);
  if (!hostname || hostname.length > 253 || !hostname.includes(".")) return false;
  if (hostname.startsWith("[") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  const labels = hostname.split(".");
  if (labels.some((label) => (
    !label ||
    label.length > 63 ||
    label.startsWith("-") ||
    label.endsWith("-") ||
    !/^[a-z0-9-]+$/.test(label)
  ))) return false;
  if (BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => (
    hostname === suffix || hostname.endsWith(`.${suffix}`)
  ))) return false;
  return true;
}

function normalizeUrl(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > MAX_GPT_SHORTCUT_URL_LENGTH) {
    throw gptShortcutError("INVALID_GPT_SHORTCUT_URL", "웹사이트 URL을 입력해 주세요.");
  }

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw gptShortcutError("INVALID_GPT_SHORTCUT_URL", "올바른 웹사이트 URL을 입력해 주세요.");
  }

  const normalizedHostname = normalizeHostname(parsed.hostname);
  if (
    parsed.protocol !== "https:" ||
    !isPublicHostname(normalizedHostname) ||
    parsed.username ||
    parsed.password
  ) {
    throw gptShortcutError(
      "INVALID_GPT_SHORTCUT_URL",
      "로그인 정보가 포함되지 않은 HTTPS 웹사이트 주소만 등록할 수 있습니다.",
    );
  }

  parsed.hostname = normalizedHostname;
  if (!isPublicHostname(parsed.hostname)) {
    throw gptShortcutError(
      "INVALID_GPT_SHORTCUT_URL",
      "로그인 정보가 포함되지 않은 HTTPS 웹사이트 주소만 등록할 수 있습니다.",
    );
  }
  return parsed.href;
}

function assertNoDuplicates(entries, candidate, ignoredId = "") {
  const normalizedName = candidate.name.toLocaleLowerCase("ko-KR");
  for (const entry of entries) {
    if (entry.id === ignoredId) continue;
    if (entry.id === candidate.id) {
      throw gptShortcutError("DUPLICATE_GPT_SHORTCUT_ID", "이미 등록된 바로가기입니다.");
    }
    if (entry.name.toLocaleLowerCase("ko-KR") === normalizedName) {
      throw gptShortcutError("DUPLICATE_GPT_SHORTCUT_NAME", "같은 이름의 바로가기가 이미 있습니다.");
    }
    if (entry.url === candidate.url) {
      throw gptShortcutError("DUPLICATE_GPT_SHORTCUT_URL", "같은 웹사이트 주소가 이미 등록되어 있습니다.");
    }
  }
}

export function createGptShortcut(input) {
  if (!input || typeof input !== "object") {
    throw gptShortcutError("INVALID_GPT_SHORTCUT", "바로가기 정보가 올바르지 않습니다.");
  }

  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (!id || id.length > 120) {
    throw gptShortcutError("INVALID_GPT_SHORTCUT", "바로가기 식별자가 올바르지 않습니다.");
  }

  const createdAt = normalizeTimestamp(input.createdAt, "생성");
  const updatedAt = normalizeTimestamp(input.updatedAt, "수정");
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw gptShortcutError("INVALID_GPT_SHORTCUT", "수정 시간이 생성 시간보다 빠를 수 없습니다.");
  }

  return Object.freeze({
    schemaVersion: 1,
    id,
    name: normalizeName(input.name),
    url: normalizeUrl(input.url),
    createdAt,
    updatedAt,
  });
}

export function addGptShortcut(entries, shortcut) {
  const current = freezeEntries(entries.map((entry) => createGptShortcut(entry)));
  if (current.length >= MAX_GPT_SHORTCUTS) {
    throw gptShortcutError(
      "GPT_SHORTCUT_LIMIT_REACHED",
      `바로가기는 최대 ${MAX_GPT_SHORTCUTS}개까지 등록할 수 있습니다.`,
    );
  }
  const candidate = createGptShortcut(shortcut);
  assertNoDuplicates(current, candidate);
  return freezeEntries([...current, candidate]);
}

export function updateGptShortcut(entries, id, changes) {
  const current = freezeEntries(entries.map((entry) => createGptShortcut(entry)));
  const index = current.findIndex((entry) => entry.id === id);
  if (index < 0) {
    throw gptShortcutError("GPT_SHORTCUT_NOT_FOUND", "수정할 바로가기를 찾지 못했습니다.");
  }

  const existing = current[index];
  const requestedUpdatedAt = normalizeTimestamp(changes?.updatedAt ?? new Date().toISOString(), "수정");
  const updatedAt = Date.parse(requestedUpdatedAt) > Date.parse(existing.updatedAt)
    ? requestedUpdatedAt
    : existing.updatedAt;
  const candidate = createGptShortcut({
    ...existing,
    name: changes?.name,
    url: changes?.url,
    updatedAt,
  });
  assertNoDuplicates(current, candidate, existing.id);
  return freezeEntries(current.map((entry) => (entry.id === existing.id ? candidate : entry)));
}

export function removeGptShortcut(entries, id) {
  const current = freezeEntries(entries.map((entry) => createGptShortcut(entry)));
  return freezeEntries(current.filter((entry) => entry.id !== id));
}

export function loadGptShortcuts(storage) {
  let raw;
  try {
    raw = storage.getItem(GPT_SHORTCUT_STORAGE_KEY);
  } catch {
    return { entries: freezeEntries([]), warning: "저장한 바로가기를 불러오지 못했습니다.", storageError: true };
  }

  if (!raw) return { entries: freezeEntries([]), warning: "", storageError: false };
  if (raw.length > MAX_GPT_SHORTCUT_STORAGE_LENGTH) {
    return { entries: freezeEntries([]), warning: "저장한 바로가기가 허용 크기를 초과해 불러오지 않았습니다.", storageError: false };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { entries: freezeEntries([]), warning: "저장한 바로가기를 읽지 못해 빈 목록으로 시작합니다.", storageError: false };
  }
  if (!Array.isArray(parsed)) {
    return { entries: freezeEntries([]), warning: "저장한 바로가기 형식이 올바르지 않습니다.", storageError: false };
  }

  const validEntries = [];
  let excludedCount = 0;
  for (const value of parsed) {
    if (validEntries.length >= MAX_GPT_SHORTCUTS) {
      excludedCount += 1;
      continue;
    }
    try {
      const entry = createGptShortcut(value);
      assertNoDuplicates(validEntries, entry);
      validEntries.push(entry);
    } catch {
      excludedCount += 1;
    }
  }

  const warning = excludedCount
    ? `올바르지 않거나 최대 ${MAX_GPT_SHORTCUTS}개를 넘은 바로가기 ${excludedCount}개를 제외했습니다.`
    : "";
  return { entries: freezeEntries(validEntries), warning, storageError: false };
}

export function saveGptShortcuts(storage, entries) {
  if (!Array.isArray(entries) || entries.length > MAX_GPT_SHORTCUTS) {
    throw gptShortcutError(
      "GPT_SHORTCUT_LIMIT_REACHED",
      `바로가기는 최대 ${MAX_GPT_SHORTCUTS}개까지 저장할 수 있습니다.`,
    );
  }

  const validated = [];
  for (const value of entries) {
    const entry = createGptShortcut(value);
    assertNoDuplicates(validated, entry);
    validated.push(entry);
  }
  const frozen = freezeEntries(validated);
  const serialized = JSON.stringify(frozen);
  if (serialized.length > MAX_GPT_SHORTCUT_STORAGE_LENGTH) {
    throw gptShortcutError("GPT_SHORTCUT_STORAGE_FAILED", "바로가기 저장 용량을 초과했습니다.");
  }

  try {
    storage.setItem(GPT_SHORTCUT_STORAGE_KEY, serialized);
  } catch {
    throw gptShortcutError("GPT_SHORTCUT_STORAGE_FAILED", "브라우저에 바로가기를 저장하지 못했습니다.");
  }
  return frozen;
}

export function shortcutLinkProps(shortcut) {
  const validated = createGptShortcut(shortcut);
  return Object.freeze({ href: validated.url, target: "_blank", rel: "noopener noreferrer" });
}
