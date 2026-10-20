import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./opportunity-zones.tsx", import.meta.url), "utf8");

test("operator map rejects dated opportunity samples before drawing", () => {
  assert.match(source, /isFreshOpportunitySample\(body\.measuredAt\)/);
  assert.match(source, /setValue\(\(previous\) => previous && !isFreshOpportunitySample\(previous\.measuredAt\) \? null : previous\)/);
});

test("background refresh failure removes circles rather than showing stale data", () => {
  const handler = source.match(/\} catch \(cause\) \{([\s\S]*?)\} finally \{/);
  assert.ok(handler);
  assert.match(handler[1], /setValue\(null\)/);
  assert.doesNotMatch(handler[1], /if\s*\(!quiet\)/);
});

test("returning to operations tab refreshes the sample", () => {
  assert.match(source, /addEventListener\("visibilitychange", refreshOnReturn\)/);
  assert.match(source, /removeEventListener\("visibilitychange", refreshOnReturn\)/);
});
