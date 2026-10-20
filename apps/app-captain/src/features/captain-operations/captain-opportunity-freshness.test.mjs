import assert from "node:assert/strict";
import test from "node:test";
import { isFreshOpportunitySample } from "./captain-opportunity-freshness.ts";

const now = Date.parse("2026-10-20T03:00:00Z");

test("only current opportunity samples can be shown", () => {
  assert.equal(isFreshOpportunitySample(new Date(now).toISOString(), now), true);
  assert.equal(isFreshOpportunitySample(new Date(now - 179_999).toISOString(), now), true);
  assert.equal(isFreshOpportunitySample(new Date(now - 180_001).toISOString(), now), false);
  assert.equal(isFreshOpportunitySample(new Date(now + 60_001).toISOString(), now), false);
  assert.equal(isFreshOpportunitySample("not-a-date", now), false);
});

test("a network error must clear previously shown opportunity circles", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./captain-opportunities.tsx", import.meta.url), "utf8");
  const refreshCatch = source.match(/\} catch \{([\s\S]*?)\} finally \{/);
  assert.ok(refreshCatch, "the refresh failure handler must exist");
  assert.match(refreshCatch[1], /setData\(null\);\s*setError\(/);
});
