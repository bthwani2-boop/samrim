import test from "node:test";
import assert from "node:assert/strict";
import { operationalAge } from "../src/features/operations/operational-age.ts";

const now = Date.UTC(2026, 9, 21, 12, 0, 0);
test("old open order names days of delay rather than saying only one hour", () => {
  const age = operationalAge("CREATED", new Date(now - 6 * 86_400_000).toISOString(), now);
  assert.equal(age.needsReview, true);
  assert.match(age.label, /6|٦|۶/);
  assert.match(age.label, /يوم/);
});
test("closed orders are not misrepresented as delayed", () => {
  for (const state of ["DELIVERED", "CANCELLED", "REJECTED"]) {
    assert.deepEqual(operationalAge(state, new Date(now - 6 * 86_400_000).toISOString(), now), {
      label: "مغلق", needsReview: false,
    });
  }
});
test("unknown future timestamps cannot be asserted as overdue", () => {
  assert.equal(operationalAge("CREATED", new Date(now + 3_600_000).toISOString(), now).needsReview, false);
});
test("half-hour pending state remains reviewable", () => {
  const age = operationalAge("CREATED", new Date(now - 31 * 60_000).toISOString(), now);
  assert.equal(age.needsReview, true);
  assert.match(age.label, /30|٣٠/);
});
