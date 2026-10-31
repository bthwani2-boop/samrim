import assert from "node:assert/strict";
import { test } from "node:test";
import { promotionBucket } from "./promotion-lifecycle.ts";

const now = Date.parse("2026-10-31T09:00:00.000Z");
const record = (state, startsAt = "2026-10-31T08:00:00.000Z", endsAt = "2026-11-01T08:00:00.000Z") =>
  ({ state, startsAt, endsAt });

test("draft, paused and ended never mix with scheduled offers", () => {
  assert.equal(promotionBucket(record("DRAFT"), now), "draft");
  assert.equal(promotionBucket(record("PAUSED"), now), "paused");
  assert.equal(promotionBucket(record("ENDED"), now), "ended");
});
test("published respects effective server-owned time window", () => {
  assert.equal(promotionBucket(record("PUBLISHED"), now), "active");
  assert.equal(promotionBucket(record("PUBLISHED", "2026-11-02T08:00:00.000Z"), now), "scheduled");
  assert.equal(promotionBucket(record("PUBLISHED", "2026-10-28T08:00:00.000Z", "2026-10-30T08:00:00.000Z"), now), "ended");
  assert.equal(promotionBucket(record("PUBLISHED", "not-a-date"), now), "ended");
});
