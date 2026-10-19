import assert from "node:assert/strict";
import test from "node:test";
import { operationalAge } from "./operational-age.ts";
const now = Date.parse("2026-10-14T12:00:00Z");
test("last changed age identifies inactivity without claiming SLA breach", () => {
  assert.deepEqual(operationalAge("READY_FOR_DISPATCH", "2026-10-14T11:28:00Z", now), { label: "أكثر من 30 دقيقة دون تحديث", needsReview: true });
  assert.deepEqual(operationalAge("IN_CUSTODY", "2026-10-14T10:58:00Z", now), { label: "أكثر من ساعة دون تحديث", needsReview: true });
  assert.equal(operationalAge("CREATED", "2026-10-14T11:59:00Z", now).needsReview, false);
});
test("closed orders are not mislabeled as stalled active work", () => {
  for (const state of ["DELIVERED", "CANCELLED", "REJECTED"]) assert.equal(operationalAge(state, "2026-01-01T00:00:00Z", now).needsReview, false);
  assert.equal(operationalAge("DELIVERY_FAILED", "2026-10-14T11:59:00Z", now).needsReview, true);
});
test("invalid or future clocks do not invent delay", () => {
  assert.equal(operationalAge("CREATED", "not-a-timestamp", now).needsReview, false);
  assert.equal(operationalAge("CREATED", "2026-10-14T13:00:00Z", now).needsReview, false);
});
