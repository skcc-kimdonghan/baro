import assert from "node:assert/strict";
import test from "node:test";

import { createLocalBootstrapUrl } from "../scripts/local-access-token.mjs";

test("direct local startup exposes a fragment-only bootstrap URL", () => {
  const token = "a".repeat(64);
  const url = createLocalBootstrapUrl({ token, port: "45173" });

  assert.equal(url, `http://localhost:45173/#baro-token=${token}`);
  assert.equal(new URL(url).search, "");
});

test("bootstrap URL rejects malformed tokens and ports", () => {
  assert.throws(() => createLocalBootstrapUrl({ token: "bad", port: "45173" }));
  assert.throws(() => createLocalBootstrapUrl({ token: "a".repeat(64), port: "80" }));
});
