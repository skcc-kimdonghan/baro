import assert from "node:assert/strict";
import test from "node:test";

import { createLocalDataClient } from "../lib/local-data-client.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("the local data client reads and replaces a collection with its revision", async () => {
  const requests = [];
  const client = createLocalDataClient({
    accessToken: "a".repeat(64),
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      if (!options.method) {
        return jsonResponse({ success: true, data: { collection: "shortcuts", entries: [], revision: 4 } });
      }
      return jsonResponse({ success: true, data: { collection: "shortcuts", entries: [], revision: 5 } });
    },
  });

  const loaded = await client.read("shortcuts");
  const saved = await client.replace("shortcuts", [], 4);

  assert.equal(loaded.revision, 4);
  assert.equal(saved.revision, 5);
  assert.equal(requests[0].url, "/api/local-data?collection=shortcuts");
  assert.equal(requests[0].options.headers["x-baro-publish-token"], "a".repeat(64));
  assert.equal(requests[1].options.method, "PUT");
  assert.equal(requests[1].options.headers["x-baro-publish-token"], "a".repeat(64));
  assert.equal(requests[1].options.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    collection: "shortcuts",
    entries: [],
    expectedRevision: 4,
  });
});

test("the client sends one idempotent legacy import request", async () => {
  let request;
  const client = createLocalDataClient({
    accessToken: "b".repeat(64),
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({ success: true, data: { alreadyApplied: false, snapshot: {}, revisions: {} } });
    },
  });

  await client.importLegacy({
    migrationId: "migration-1",
    payloadHash: "hash-1",
    snapshot: { articleBundles: [], publicationHistory: [], shortcuts: [] },
  });

  assert.equal(request.url, "/api/local-data/import");
  assert.equal(request.options.method, "POST");
  assert.equal(JSON.parse(request.options.body).migrationId, "migration-1");
});

test("HTTP failures, malformed responses, and network failures become safe typed errors", async () => {
  const conflict = createLocalDataClient({
    accessToken: "c".repeat(64),
    fetchImpl: async () => jsonResponse({
      success: false,
      error: { code: "REVISION_CONFLICT", message: "최신 데이터를 다시 불러와 주세요." },
    }, 409),
  });
  await assert.rejects(
    () => conflict.read("shortcuts"),
    (error) => error instanceof Error && error.code === "REVISION_CONFLICT" && !error.message.includes("SQL"),
  );

  const malformed = createLocalDataClient({ accessToken: "d".repeat(64), fetchImpl: async () => new Response("not json") });
  await assert.rejects(
    () => malformed.read("shortcuts"),
    (error) => error instanceof Error && error.code === "LOCAL_DATA_PROTOCOL_ERROR",
  );

  const offline = createLocalDataClient({ accessToken: "e".repeat(64), fetchImpl: async () => { throw new Error("socket secret"); } });
  await assert.rejects(
    () => offline.read("shortcuts"),
    (error) => error instanceof Error && error.code === "LOCAL_DATA_NETWORK_ERROR" && !error.message.includes("secret"),
  );
});

test("the client refuses to send local data without a valid capability token", async () => {
  assert.throws(
    () => createLocalDataClient({ accessToken: "missing" }),
    (error) => error instanceof Error && error.code === "LOCAL_DATA_AUTH_REQUIRED",
  );
});
