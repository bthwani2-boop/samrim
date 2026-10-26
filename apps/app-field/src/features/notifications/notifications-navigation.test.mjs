import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("notifications back action returns to home when opened without navigation history", async () => {
  const source = await readFile(new URL("./notifications-inbox.tsx", import.meta.url), "utf8");

  assert.match(source, /router\.canGoBack\(\)\s*\?\s*router\.back\(\)\s*:\s*router\.replace\("\/home" as Href\)/u);
});