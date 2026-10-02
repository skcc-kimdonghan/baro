import assert from "node:assert/strict";
import test from "node:test";

import { createLocalDataHttpHandlers } from "../lib/local-data-http.mjs";

const ACCESS_TOKEN = "a".repeat(64);

function request(path, options = {}) {
  return new Request(`http://localhost:45173${path}`, options);
}

function createService() {
  return {
    async read(collection) { return { collection, entries: [], revision: 0 }; },
    async replace(collection, entries, expectedRevision) {
      return { collection, entries, revision: expectedRevision + 1 };
    },
    async importLegacy() { return { alreadyApplied: false, snapshot: {}, revisions: {} }; },
  };
}

function createHandlers(options = {}) {
  return createLocalDataHttpHandlers({ service: createService(), accessToken: ACCESS_TOKEN, ...options });
}

function authenticatedHeaders(extra = {}) {
  return { "x-baro-publish-token": ACCESS_TOKEN, ...extra };
}

test("GET returns a no-store success envelope", async () => {
  const handlers = createHandlers();
  const response = await handlers.GET(request("/api/local-data?collection=shortcuts", {
    headers: authenticatedHeaders(),
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.success, true);
  assert.equal(body.data.collection, "shortcuts");
});

test("writes require a matching loopback origin and JSON content type", async () => {
  const handlers = createHandlers();
  const body = JSON.stringify({ collection: "shortcuts", entries: [], expectedRevision: 0 });

  const external = await handlers.PUT(request("/api/local-data", {
    method: "PUT",
    headers: authenticatedHeaders({ origin: "https://evil.example", "content-type": "application/json" }),
    body,
  }));
  const wrongType = await handlers.PUT(request("/api/local-data", {
    method: "PUT",
    headers: authenticatedHeaders({ origin: "http://localhost:45173", "content-type": "text/plain" }),
    body,
  }));

  assert.equal(external.status, 403);
  assert.equal(wrongType.status, 415);
});

test("reads reject non-loopback hostnames", async () => {
  const handlers = createHandlers();
  const response = await handlers.GET(new Request("http://evil.example/api/local-data?collection=shortcuts"));

  assert.equal(response.status, 403);
});

test("all local data methods require the per-user capability token", async () => {
  const handlers = createHandlers();
  const missing = await handlers.GET(request("/api/local-data?collection=shortcuts"));
  const forged = await handlers.GET(request("/api/local-data?collection=shortcuts", {
    headers: { "x-baro-publish-token": "b".repeat(64) },
  }));
  const valid = await handlers.GET(request("/api/local-data?collection=shortcuts", {
    headers: authenticatedHeaders(),
  }));

  assert.equal(missing.status, 401);
  assert.equal(forged.status, 401);
  assert.equal(valid.status, 200);
});

test("invalid collections and oversized bodies are rejected before the service runs", async () => {
  let calls = 0;
  const service = createService();
  service.replace = async () => { calls += 1; };
  const handlers = createLocalDataHttpHandlers({ service, accessToken: ACCESS_TOKEN, maxRequestBytes: 128 });
  const invalid = await handlers.PUT(request("/api/local-data", {
    method: "PUT",
    headers: authenticatedHeaders({ origin: "http://localhost:45173", "content-type": "application/json" }),
    body: JSON.stringify({ collection: "unknown", entries: [], expectedRevision: 0 }),
  }));
  const oversized = await handlers.PUT(request("/api/local-data", {
    method: "PUT",
    headers: {
      origin: "http://localhost:45173",
      "x-baro-publish-token": ACCESS_TOKEN,
      "content-type": "application/json",
      "content-length": "999",
    },
    body: "{}",
  }));

  assert.equal(invalid.status, 422);
  assert.equal(oversized.status, 413);
  assert.equal(calls, 0);
});

test("chunked request bodies stop reading as soon as the byte limit is exceeded", async () => {
  let pullCount = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pullCount += 1;
      if (pullCount === 1) controller.enqueue(new TextEncoder().encode('{"value":"'));
      else if (pullCount === 2) controller.enqueue(new TextEncoder().encode("too-large"));
      else controller.error(new Error("the handler read beyond the configured limit"));
    },
  });
  const handlers = createHandlers({ maxRequestBytes: 12 });
  const response = await handlers.POST(request("/api/local-data/import", {
    method: "POST",
    duplex: "half",
    headers: authenticatedHeaders({
      origin: "http://localhost:45173",
      "content-type": "application/json",
    }),
    body: stream,
  }));

  assert.equal(response.status, 413);
  assert.ok(pullCount <= 2);
});

test("the default byte limit accepts a valid multi-byte payload above the old 3 MB cap", async () => {
  let receivedLength = 0;
  const service = createService();
  service.importLegacy = async (body) => {
    receivedLength = body.payload.length;
    return { alreadyApplied: false, snapshot: {}, revisions: {} };
  };
  const handlers = createLocalDataHttpHandlers({ service, accessToken: ACCESS_TOKEN });
  const response = await handlers.POST(request("/api/local-data/import", {
    method: "POST",
    headers: authenticatedHeaders({
      origin: "http://localhost:45173",
      "content-type": "application/json",
    }),
    body: JSON.stringify({ payload: "한".repeat(1_200_000) }),
  }));

  assert.equal(response.status, 200);
  assert.equal(receivedLength, 1_200_000);
});

test("revision conflicts keep their status while unexpected storage errors hide internals", async () => {
  const conflict = new Error("conflict");
  conflict.code = "REVISION_CONFLICT";
  const conflictHandlers = createLocalDataHttpHandlers({
    service: { ...createService(), async replace() { throw conflict; } },
    accessToken: ACCESS_TOKEN,
  });
  const options = {
    method: "PUT",
    headers: authenticatedHeaders({ origin: "http://localhost:45173", "content-type": "application/json" }),
    body: JSON.stringify({ collection: "shortcuts", entries: [], expectedRevision: 0 }),
  };
  const conflictResponse = await conflictHandlers.PUT(request("/api/local-data", options));
  assert.equal(conflictResponse.status, 409);

  const failedHandlers = createLocalDataHttpHandlers({
    service: { ...createService(), async replace() { throw new Error("SQL /private/secret.sqlite failed"); } },
    accessToken: ACCESS_TOKEN,
    onError() {},
  });
  const failedResponse = await failedHandlers.PUT(request("/api/local-data", options));
  const body = await failedResponse.json();
  assert.equal(failedResponse.status, 500);
  assert.equal(body.error.code, "LOCAL_DATA_UNAVAILABLE");
  assert.equal(JSON.stringify(body).includes("secret.sqlite"), false);
});
