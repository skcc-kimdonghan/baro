import test from "node:test";
import assert from "node:assert/strict";

import { copyArticle } from "../lib/clipboard.mjs";

test("rich copy writes HTML and plain text representations together", async () => {
  const writes = [];
  class FakeBlob {
    constructor(parts, options) {
      this.parts = parts;
      this.type = options.type;
    }
  }
  class FakeClipboardItem {
    constructor(data) {
      this.data = data;
    }
  }
  const environment = {
    Blob: FakeBlob,
    ClipboardItem: FakeClipboardItem,
    clipboard: { write: async (items) => writes.push(items) },
  };

  const result = await copyArticle(
    { html: "<p>본문</p>", plainText: "본문" },
    "rich",
    environment,
  );

  assert.equal(result.mode, "rich");
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0][0].data).sort(), ["text/html", "text/plain"]);
});

test("rich copy falls back to writeText when the rich clipboard is rejected", async () => {
  const copied = [];
  const environment = {
    Blob,
    ClipboardItem: class ClipboardItem {},
    clipboard: {
      write: async () => {
        throw new Error("denied");
      },
      writeText: async (value) => copied.push(value),
    },
  };

  const result = await copyArticle(
    { html: "<p>본문</p>", plainText: "본문" },
    "rich",
    environment,
  );

  assert.equal(result.mode, "plain-fallback");
  assert.deepEqual(copied, ["본문"]);
});

test("plain copy uses the legacy selection fallback when Clipboard API is absent", async () => {
  let executed = false;
  let removed = false;
  const node = {
    value: "",
    setAttribute() {},
    select() {},
    remove() {
      removed = true;
    },
    style: {},
  };
  const environment = {
    clipboard: null,
    document: {
      body: { appendChild() {} },
      createElement: () => node,
      execCommand: (command) => {
        executed = command === "copy";
        return true;
      },
    },
  };

  const result = await copyArticle(
    { html: "<p>본문</p>", plainText: "본문" },
    "plain",
    environment,
  );

  assert.equal(result.mode, "legacy");
  assert.equal(node.value, "본문");
  assert.equal(executed, true);
  assert.equal(removed, true);
});

test("writeText permission rejection also falls back to legacy selection copy", async () => {
  let executed = false;
  const node = {
    value: "",
    setAttribute() {},
    select() {},
    remove() {},
    style: {},
  };
  const environment = {
    clipboard: {
      writeText: async () => {
        throw new Error("denied");
      },
    },
    document: {
      body: { appendChild() {} },
      createElement: () => node,
      execCommand: () => {
        executed = true;
        return true;
      },
    },
  };

  const result = await copyArticle(
    { html: "<p>본문</p>", plainText: "본문" },
    "plain",
    environment,
  );

  assert.equal(result.mode, "legacy");
  assert.equal(executed, true);
});
