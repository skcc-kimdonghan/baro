import test from "node:test";
import assert from "node:assert/strict";

import {
  GPT_SHORTCUT_STORAGE_KEY,
  MAX_GPT_SHORTCUTS,
  addGptShortcut,
  createGptShortcut,
  loadGptShortcuts,
  moveGptShortcut,
  removeGptShortcut,
  saveGptShortcuts,
  shortcutLinkProps,
  updateGptShortcut,
} from "../lib/gpt-shortcuts.mjs";

class FakeStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
    this.failRead = false;
    this.failWrite = false;
  }

  getItem(key) {
    if (this.failRead) throw new Error("read blocked");
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    if (this.failWrite) throw new Error("quota exceeded");
    this.values.set(key, value);
  }
}

function shortcut(index = 1, overrides = {}) {
  const seconds = String(index).padStart(2, "0");
  return createGptShortcut({
    id: `shortcut-${index}`,
    name: `채팅 ${index}`,
    url: `https://chatgpt.com/c/chat-${index}`,
    createdAt: `2026-10-01T00:00:${seconds}.000Z`,
    updatedAt: `2026-10-01T00:00:${seconds}.000Z`,
    ...overrides,
  });
}

test("GPT shortcuts trim input, normalize URLs, and return frozen values", () => {
  const input = Object.freeze({
    id: "  shortcut-one  ",
    name: "  원고 작성 GPT  ",
    url: "  https://chatgpt.com/c/example  ",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  });

  const created = createGptShortcut(input);

  assert.equal(input.name, "  원고 작성 GPT  ");
  assert.equal(created.id, "shortcut-one");
  assert.equal(created.name, "원고 작성 GPT");
  assert.equal(created.url, "https://chatgpt.com/c/example");
  assert.ok(Object.isFrozen(created));
});

test("ChatGPT and other HTTPS websites are accepted", () => {
  assert.equal(shortcut(1).url, "https://chatgpt.com/c/chat-1");
  assert.equal(
    shortcut(2, { url: "https://chat.openai.com/g/g-example" }).url,
    "https://chat.openai.com/g/g-example",
  );
  assert.equal(
    shortcut(3, { url: "https://onecalc.kr/calc/everland-ride-passport/" }).url,
    "https://onecalc.kr/calc/everland-ride-passport/",
  );
  assert.equal(
    shortcut(4, { url: "https://blog.naver.com/aa38240/224418566417" }).url,
    "https://blog.naver.com/aa38240/224418566417",
  );
});

test("non-HTTPS schemes, relative URLs, and user info are rejected", () => {
  const invalidUrls = [
    "",
    "/c/example",
    "http://chatgpt.com/c/example",
    "http://example.com/",
    "javascript:alert(1)",
    "data:text/html,test",
    "file:///tmp/chat",
    "https://user:pass@chatgpt.com/c/example",
  ];

  for (const url of invalidUrls) {
    assert.throws(
      () => shortcut(1, { url }),
      (error) => error instanceof Error && error.code === "INVALID_GPT_SHORTCUT_URL",
      url,
    );
  }
});

test("local, reserved, malformed, and IP-address HTTPS shortcuts remain rejected", () => {
  const invalidUrls = [
    "https://localhost/",
    "https://app.localhost/",
    "https://printer.local/",
    "https://127.0.0.1/",
    "https://192.168.0.1/",
    "https://[::1]/",
    "https://intranet/",
    "https://localhost../",
    "https://app.localhost../",
    "https://printer.local../",
    "https://host.internal../",
    "https://127.0.0.1../",
    "https://device.home.arpa/",
    "https://foo.localdomain/",
    "https://router.intranet/",
    "https://foo.test/",
    "https://foo.invalid/",
    "https://foo.example/",
    "https://bad..example.com/",
    "https://-bad.example.com/",
    "https://bad-.example.com/",
  ];

  for (const url of invalidUrls) {
    assert.throws(
      () => shortcut(1, { url }),
      (error) => error instanceof Error && error.code === "INVALID_GPT_SHORTCUT_URL",
      url,
    );
  }
});

test("equivalent normalized HTTPS URLs remain duplicates", () => {
  const existing = shortcut(1, { name: "문서", url: "https://example.com/docs" });

  assert.throws(
    () => addGptShortcut([
      existing,
    ], shortcut(2, { name: "다른 이름", url: "HTTPS://EXAMPLE.COM:443/docs" })),
    (error) => error instanceof Error && error.code === "DUPLICATE_GPT_SHORTCUT_URL",
  );
});

test("names and identifiers have explicit validation limits", () => {
  assert.throws(
    () => shortcut(1, { name: " " }),
    (error) => error instanceof Error && error.code === "INVALID_GPT_SHORTCUT_NAME",
  );
  assert.throws(
    () => shortcut(1, { name: "가".repeat(31) }),
    (error) => error instanceof Error && error.code === "INVALID_GPT_SHORTCUT_NAME",
  );
  assert.throws(
    () => shortcut(1, { id: " " }),
    (error) => error instanceof Error && error.code === "INVALID_GPT_SHORTCUT",
  );
});

test("adding a shortcut does not mutate the existing array", () => {
  const original = Object.freeze([shortcut(1)]);
  const added = addGptShortcut(original, shortcut(2));

  assert.equal(original.length, 1);
  assert.deepEqual(added.map((entry) => entry.id), ["shortcut-1", "shortcut-2"]);
  assert.ok(Object.isFrozen(added));
});

test("duplicate names and URLs are rejected without changing saved entries", () => {
  const original = Object.freeze([shortcut(1)]);

  assert.throws(
    () => addGptShortcut(original, shortcut(2, { name: "채팅 1" })),
    (error) => error instanceof Error && error.code === "DUPLICATE_GPT_SHORTCUT_NAME",
  );
  assert.throws(
    () => addGptShortcut(original, shortcut(2, { url: "https://chatgpt.com/c/chat-1" })),
    (error) => error instanceof Error && error.code === "DUPLICATE_GPT_SHORTCUT_URL",
  );
  assert.equal(original.length, 1);
});

test("ten shortcuts are allowed and an eleventh is rejected without mutation", () => {
  const original = Object.freeze(
    Array.from({ length: MAX_GPT_SHORTCUTS }, (_, index) => shortcut(index + 1)),
  );

  assert.equal(MAX_GPT_SHORTCUTS, 10);
  assert.throws(
    () => addGptShortcut(original, shortcut(11)),
    (error) => error instanceof Error && error.code === "GPT_SHORTCUT_LIMIT_REACHED",
  );
  assert.equal(original.length, MAX_GPT_SHORTCUTS);
});

test("moving a shortcut up or down returns a frozen reordered copy", () => {
  const original = Object.freeze([shortcut(1), shortcut(2), shortcut(3)]);

  const movedUp = moveGptShortcut(original, "shortcut-3", "up");
  const movedDown = moveGptShortcut(movedUp, "shortcut-1", "down");

  assert.deepEqual(original.map((entry) => entry.id), ["shortcut-1", "shortcut-2", "shortcut-3"]);
  assert.deepEqual(movedUp.map((entry) => entry.id), ["shortcut-1", "shortcut-3", "shortcut-2"]);
  assert.deepEqual(movedDown.map((entry) => entry.id), ["shortcut-3", "shortcut-1", "shortcut-2"]);
  assert.equal(movedUp[1].updatedAt, original[2].updatedAt);
  assert.ok(Object.isFrozen(movedUp));
  assert.ok(movedUp.every(Object.isFrozen));
});

test("moving at a list boundary is a safe no-op and invalid moves are rejected", () => {
  const original = Object.freeze([shortcut(1), shortcut(2)]);

  assert.deepEqual(moveGptShortcut(original, "shortcut-1", "up"), original);
  assert.deepEqual(moveGptShortcut(original, "shortcut-2", "down"), original);
  assert.throws(
    () => moveGptShortcut(original, "missing", "up"),
    (error) => error instanceof Error && error.code === "GPT_SHORTCUT_NOT_FOUND",
  );
  assert.throws(
    () => moveGptShortcut(original, "shortcut-1", "sideways"),
    (error) => error instanceof Error && error.code === "INVALID_GPT_SHORTCUT_MOVE",
  );
});

test("updating keeps the same id, timestamps, and list position", () => {
  const original = Object.freeze([shortcut(1), shortcut(2)]);
  const updated = updateGptShortcut(original, "shortcut-1", {
    name: "수정한 채팅",
    url: "https://chatgpt.com/g/g-updated",
    updatedAt: "2026-10-01T01:00:00.000Z",
  });

  assert.equal(original[0].name, "채팅 1");
  assert.deepEqual(updated.map((entry) => entry.id), ["shortcut-1", "shortcut-2"]);
  assert.equal(updated[0].name, "수정한 채팅");
  assert.equal(updated[0].createdAt, original[0].createdAt);
  assert.equal(updated[0].updatedAt, "2026-10-01T01:00:00.000Z");
});

test("updating remains possible after a future system clock is corrected", () => {
  const future = shortcut(1, {
    createdAt: "2036-10-01T00:00:01.000Z",
    updatedAt: "2036-10-01T00:00:01.000Z",
  });

  const updated = updateGptShortcut([future], future.id, {
    name: "정상 시계에서 수정",
    url: future.url,
    updatedAt: "2026-10-01T00:00:01.000Z",
  });

  assert.equal(updated[0].name, "정상 시계에서 수정");
  assert.equal(updated[0].createdAt, future.createdAt);
  assert.equal(updated[0].updatedAt, future.updatedAt);
});

test("updating a missing shortcut is a clear error", () => {
  assert.throws(
    () => updateGptShortcut([shortcut(1)], "missing", { name: "없음", url: "https://chatgpt.com/c/missing" }),
    (error) => error instanceof Error && error.code === "GPT_SHORTCUT_NOT_FOUND",
  );
});

test("deleting removes only the selected shortcut", () => {
  const original = Object.freeze([shortcut(1), shortcut(2)]);
  const removed = removeGptShortcut(original, "shortcut-1");

  assert.deepEqual(removed.map((entry) => entry.id), ["shortcut-2"]);
  assert.equal(original.length, 2);
});

test("shortcuts save and restore in display order", () => {
  const storage = new FakeStorage();
  const entries = [
    shortcut(1),
    shortcut(2, { name: "네이버", url: "https://www.naver.com/" }),
  ];

  assert.deepEqual(saveGptShortcuts(storage, entries), entries);
  assert.deepEqual(loadGptShortcuts(storage), { entries, warning: "", storageError: false });
});

test("ten long shortcuts fit the legacy storage envelope and preserve order", () => {
  const storage = new FakeStorage();
  const entries = Array.from({ length: MAX_GPT_SHORTCUTS }, (_, index) => shortcut(index + 1, {
    url: `https://chatgpt.com/c/${index + 1}/${"a".repeat(1_900)}`,
  }));

  const saved = saveGptShortcuts(storage, entries);
  const loaded = loadGptShortcuts(storage);

  assert.equal(saved.length, 10);
  assert.deepEqual(loaded.entries.map((entry) => entry.id), entries.map((entry) => entry.id));
});

test("corrupt, wrong-root, and mixed saved values recover safely", () => {
  const corrupt = new FakeStorage({ [GPT_SHORTCUT_STORAGE_KEY]: "{broken" });
  const wrongRoot = new FakeStorage({ [GPT_SHORTCUT_STORAGE_KEY]: JSON.stringify({ entries: [] }) });
  const mixed = new FakeStorage({
    [GPT_SHORTCUT_STORAGE_KEY]: JSON.stringify([shortcut(1), { id: "bad", name: 7 }]),
  });

  assert.deepEqual(loadGptShortcuts(corrupt).entries, []);
  assert.match(loadGptShortcuts(corrupt).warning, /읽지 못/);
  assert.deepEqual(loadGptShortcuts(wrongRoot).entries, []);
  assert.match(loadGptShortcuts(wrongRoot).warning, /형식/);
  assert.equal(loadGptShortcuts(mixed).entries.length, 1);
  assert.match(loadGptShortcuts(mixed).warning, /제외/);
});

test("too many saved shortcuts are capped with a warning", () => {
  const storage = new FakeStorage({
    [GPT_SHORTCUT_STORAGE_KEY]: JSON.stringify(
      Array.from({ length: MAX_GPT_SHORTCUTS + 1 }, (_, index) => shortcut(index + 1)),
    ),
  });

  const loaded = loadGptShortcuts(storage);
  assert.equal(loaded.entries.length, MAX_GPT_SHORTCUTS);
  assert.match(loaded.warning, /10개/);
});

test("storage read and write failures become user-facing errors", () => {
  const readFailure = new FakeStorage();
  readFailure.failRead = true;
  assert.deepEqual(loadGptShortcuts(readFailure).entries, []);
  assert.match(loadGptShortcuts(readFailure).warning, /불러오지 못/);
  assert.equal(loadGptShortcuts(readFailure).storageError, true);

  const corrupt = new FakeStorage({ [GPT_SHORTCUT_STORAGE_KEY]: "{broken" });
  assert.equal(loadGptShortcuts(corrupt).storageError, false);

  const writeFailure = new FakeStorage();
  writeFailure.failWrite = true;
  assert.throws(
    () => saveGptShortcuts(writeFailure, [shortcut(1)]),
    (error) => error instanceof Error && error.code === "GPT_SHORTCUT_STORAGE_FAILED",
  );
});

test("untrusted names remain plain strings and links open in an isolated new tab", () => {
  const created = shortcut(1, { name: "<img src=x onerror=alert(1)>" });
  const props = shortcutLinkProps(created);

  assert.equal(created.name, "<img src=x onerror=alert(1)>");
  assert.equal(props.href, created.url);
  assert.equal(props.target, "_blank");
  assert.deepEqual(new Set(props.rel.split(/\s+/)), new Set(["noopener", "noreferrer"]));
});
