import { migrateLegacyLocalData } from "./legacy-data-migration.mjs";
import { createLocalDataClient } from "./local-data-client.mjs";

export const LOCAL_DATA_ACCESS_TOKEN_STORAGE_KEY = "naver-blog-finalizer.local-access-token.v1";
const LOCAL_DATA_ACCESS_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export function bootstrapLocalDataAccessToken({ location, history, storage }) {
  let fragmentToken = "";
  const hash = typeof location?.hash === "string" ? location.hash : "";
  if (hash.startsWith("#")) {
    fragmentToken = new URLSearchParams(hash.slice(1)).get("baro-token") ?? "";
  }
  if (fragmentToken) {
    try {
      if (LOCAL_DATA_ACCESS_TOKEN_PATTERN.test(fragmentToken)) {
        try {
          storage.setItem(LOCAL_DATA_ACCESS_TOKEN_STORAGE_KEY, fragmentToken);
        } catch {
          // The current tab can still use the fragment token when storage is unavailable.
        }
      }
    } finally {
      history?.replaceState?.(null, "", `${location?.pathname || "/"}${location?.search || ""}`);
    }
    return LOCAL_DATA_ACCESS_TOKEN_PATTERN.test(fragmentToken) ? fragmentToken : "";
  }

  try {
    const saved = storage.getItem(LOCAL_DATA_ACCESS_TOKEN_STORAGE_KEY) ?? "";
    return LOCAL_DATA_ACCESS_TOKEN_PATTERN.test(saved) ? saved : "";
  } catch {
    return "";
  }
}

function defaultMigrationId() {
  if (globalThis.crypto?.randomUUID) return `migration-${globalThis.crypto.randomUUID()}`;
  return `migration-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}

export function createBrowserLocalDataStore({ client, migrate, maxConflictRetries = 2 }) {
  let preparation = null;
  const prepare = () => {
    if (!preparation) {
      preparation = Promise.resolve().then(migrate).catch((error) => {
        preparation = null;
        throw error;
      });
    }
    return preparation;
  };

  return Object.freeze({
    prepare,
    async read(collection) {
      await prepare();
      return client.read(collection);
    },
    async mutate(collection, change) {
      await prepare();
      for (let attempt = 0; attempt <= maxConflictRetries; attempt += 1) {
        const current = await client.read(collection);
        const nextEntries = await change(current.entries);
        try {
          return await client.replace(collection, nextEntries, current.revision);
        } catch (error) {
          if (error?.code !== "REVISION_CONFLICT" || attempt >= maxConflictRetries) throw error;
        }
      }
      throw Object.assign(new Error("로컬 DB 변경을 다시 시도해 주세요."), { code: "REVISION_CONFLICT" });
    },
  });
}

let browserStore = null;
const LOCAL_DATA_CHANGE_EVENT = "baro-publish-local-data-change";
const LOCAL_DATA_CHANNEL = "baro-publish-local-data";

export function getBrowserLocalDataStore() {
  if (browserStore) return browserStore;
  if (!globalThis.window?.localStorage || typeof globalThis.fetch !== "function") {
    throw Object.assign(new Error("브라우저 로컬 DB 연결을 사용할 수 없습니다."), {
      code: "LOCAL_DATA_CLIENT_UNAVAILABLE",
    });
  }
  const accessToken = bootstrapLocalDataAccessToken({
    location: globalThis.window.location,
    history: globalThis.window.history,
    storage: globalThis.window.localStorage,
  });
  const client = createLocalDataClient({
    fetchImpl: globalThis.fetch.bind(globalThis),
    accessToken,
  });
  browserStore = createBrowserLocalDataStore({
    client,
    migrate: async () => {
      try {
        return await migrateLegacyLocalData({
          storage: globalThis.window.localStorage,
          client,
          idFactory: defaultMigrationId,
        });
      } catch {
        return Object.freeze({
          status: "failed",
          warning: "기존 브라우저 데이터는 그대로 보존했습니다. 로컬 DB 연결을 확인한 뒤 다시 열면 이전을 재시도합니다.",
        });
      }
    },
  });
  return browserStore;
}

export function notifyLocalDataChanged(collection) {
  globalThis.window?.dispatchEvent(new CustomEvent(LOCAL_DATA_CHANGE_EVENT, { detail: { collection } }));
  if (typeof globalThis.BroadcastChannel === "function") {
    const channel = new BroadcastChannel(LOCAL_DATA_CHANNEL);
    channel.postMessage({ collection });
    channel.close();
  }
}

export function subscribeToLocalDataChanges(collection, listener) {
  const handleLocalChange = (event) => {
    if (!event.detail?.collection || event.detail.collection === collection) listener();
  };
  const handleFocus = () => listener();
  const handleVisibility = () => {
    if (globalThis.document?.visibilityState === "visible") listener();
  };
  let channel = null;
  if (typeof globalThis.BroadcastChannel === "function") {
    channel = new BroadcastChannel(LOCAL_DATA_CHANNEL);
    channel.addEventListener("message", (event) => {
      if (!event.data?.collection || event.data.collection === collection) listener();
    });
  }
  globalThis.window?.addEventListener(LOCAL_DATA_CHANGE_EVENT, handleLocalChange);
  globalThis.window?.addEventListener("focus", handleFocus);
  globalThis.document?.addEventListener("visibilitychange", handleVisibility);
  return () => {
    channel?.close();
    globalThis.window?.removeEventListener(LOCAL_DATA_CHANGE_EVENT, handleLocalChange);
    globalThis.window?.removeEventListener("focus", handleFocus);
    globalThis.document?.removeEventListener("visibilitychange", handleVisibility);
  };
}
