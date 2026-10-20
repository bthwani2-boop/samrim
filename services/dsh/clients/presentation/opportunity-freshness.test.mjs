import assert from "node:assert/strict";
import test from "node:test";
import { isFreshOpportunitySample } from "./opportunity-freshness.ts";

const now = Date.parse("2026-10-20T03:00:00Z");

test("only current opportunity samples can be shown on either surface", () => {
  assert.equal(isFreshOpportunitySample(new Date(now).toISOString(), now), true);
  assert.equal(isFreshOpportunitySample(new Date(now - 179_999).toISOString(), now), true);
  assert.equal(isFreshOpportunitySample(new Date(now - 180_001).toISOString(), now), false);
  assert.equal(isFreshOpportunitySample(new Date(now + 60_001).toISOString(), now), false);
  assert.equal(isFreshOpportunitySample("not-a-date", now), false);
  assert.equal(isFreshOpportunitySample(null, now), false);
});
