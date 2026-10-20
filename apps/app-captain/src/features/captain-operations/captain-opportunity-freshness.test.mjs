import assert from "node:assert/strict";
import test from "node:test";

test("a network error must clear previously shown opportunity circles", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./captain-opportunities.tsx", import.meta.url), "utf8");
  const refreshCatch = source.match(/\} catch \{([\s\S]*?)\} finally \{/);
  assert.ok(refreshCatch, "the refresh failure handler must exist");
  assert.match(refreshCatch[1], /setData\(null\);\s*setError\(/);
});
