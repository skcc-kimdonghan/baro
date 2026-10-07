import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  isCurrentRequestGeneration,
  shouldReportRequestFailure,
} from "../lib/request-generation.mjs";

test("only the newest request generation may update visible state", () => {
  assert.equal(isCurrentRequestGeneration(4, 4), true);
  assert.equal(isCurrentRequestGeneration(4, 5), false);
  assert.equal(isCurrentRequestGeneration(-1, -1), false);
});

test("only the newest request failure may replace the visible warning", () => {
  assert.equal(shouldReportRequestFailure(4, 4), true);
  assert.equal(shouldReportRequestFailure(3, 4), false);
});

test("every persistent mutation hook guards failure reporting by generation", async () => {
  const hookUrls = [
    new URL("../hooks/use-article-bundles.ts", import.meta.url),
    new URL("../hooks/use-gpt-shortcuts.ts", import.meta.url),
    new URL("../hooks/use-publication-history.ts", import.meta.url),
  ];
  const sources = await Promise.all(hookUrls.map((url) => readFile(url, "utf8")));

  for (const [index, source] of sources.entries()) {
    assert.equal(
      source.match(/shouldReportRequestFailure\(/g)?.length,
      hookUrls[index].pathname.endsWith("use-gpt-shortcuts.ts") ? 4 : 3,
      "save/add/update/move/remove/clear mutation catches must suppress stale warnings",
    );
  }
});
