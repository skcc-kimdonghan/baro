import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCAL_DATA_ACCESS_TOKEN_STORAGE_KEY,
  bootstrapLocalDataAccessToken,
  createBrowserLocalDataStore,
} from "../lib/browser-local-data.mjs";

test("a launcher fragment bootstraps the capability token and immediately removes it from the URL", () => {
  const values = new Map();
  let replacedUrl = "";
  const token = "f".repeat(64);
  const result = bootstrapLocalDataAccessToken({
    location: { hash: `#baro-token=${token}`, pathname: "/", search: "?view=local" },
    history: { replaceState(_state, _title, url) { replacedUrl = url; } },
    storage: {
      getItem(key) { return values.get(key) ?? null; },
      setItem(key, value) { values.set(key, value); },
    },
  });

  assert.equal(result, token);
  assert.equal(values.get(LOCAL_DATA_ACCESS_TOKEN_STORAGE_KEY), token);
  assert.equal(replacedUrl, "/?view=local");
});

test("a later tab reuses only a valid saved capability token", () => {
  const valid = "1".repeat(64);
  const storage = { getItem() { return valid; }, setItem() {} };
  assert.equal(bootstrapLocalDataAccessToken({
    location: { hash: "", pathname: "/", search: "" }, history: {}, storage,
  }), valid);
  assert.equal(bootstrapLocalDataAccessToken({
    location: { hash: "", pathname: "/", search: "" }, history: {},
    storage: { getItem() { return "not-a-token"; }, setItem() {} },
  }), "");
});

test("browser store runs legacy migration once before database reads", async () => {
  const calls = [];
  const store = createBrowserLocalDataStore({
    client: {
      async read(collection) { calls.push(`read:${collection}`); return { collection, entries: [], revision: 0 }; },
    },
    migrate: async () => { calls.push("migrate"); return { status: "empty", warning: "" }; },
  });

  await Promise.all([store.read("articleBundles"), store.read("shortcuts")]);

  assert.deepEqual(calls, ["migrate", "read:articleBundles", "read:shortcuts"]);
});

test("mutations retry a revision conflict against the newest database state", async () => {
  let reads = 0;
  let writes = 0;
  const client = {
    async read(collection) {
      reads += 1;
      return { collection, entries: reads === 1 ? [] : [{ id: "newer" }], revision: reads - 1 };
    },
    async replace(collection, entries, revision) {
      writes += 1;
      if (writes === 1) throw Object.assign(new Error("conflict"), { code: "REVISION_CONFLICT" });
      return { collection, entries, revision: revision + 1 };
    },
  };
  const store = createBrowserLocalDataStore({
    client,
    migrate: async () => ({ status: "empty", warning: "" }),
  });

  const saved = await store.mutate("shortcuts", (entries) => [...entries, { id: "mine" }]);

  assert.equal(reads, 2);
  assert.equal(writes, 2);
  assert.deepEqual(saved.entries.map((entry) => entry.id), ["newer", "mine"]);
});

test("non-conflict mutation errors preserve the previous server state", async () => {
  const expected = Object.assign(new Error("offline"), { code: "LOCAL_DATA_NETWORK_ERROR" });
  const store = createBrowserLocalDataStore({
    client: {
      async read(collection) { return { collection, entries: [{ id: "safe" }], revision: 2 }; },
      async replace() { throw expected; },
    },
    migrate: async () => ({ status: "empty", warning: "" }),
  });

  await assert.rejects(() => store.mutate("shortcuts", () => []), expected);
});
