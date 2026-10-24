import test from "node:test";
import assert from "node:assert/strict";
import { operationalStageElapsed, operationalStageAttention, operationalSlaAttention } from "./operational-stage-elapsed.ts";

const now = Date.parse("2026-10-23T12:00:00Z");
test("elapsed stage age reads only a proven transition timestamp", () => {
  assert.equal(operationalStageElapsed(undefined, now), null);
  assert.equal(operationalStageElapsed(null, now), null);
  assert.equal(operationalStageElapsed("not-a-date", now), null);
  assert.equal(operationalStageElapsed("2026-10-23T12:05:00Z", now), null);
  assert.match(operationalStageElapsed("2026-10-23T11:35:00Z", now) ?? "", /25|٢٥|۲۵/);
  assert.match(operationalStageElapsed("2026-10-23T10:00:00Z", now) ?? "", /ساع/);
});

test("early-stage follow-up uses stage transition rather than order updatedAt", () => {
  assert.equal(operationalStageAttention("CREATED", "2026-10-23T11:29:00Z", now)?.needsReview, true);
  assert.equal(operationalStageAttention("PREPARING", "2026-10-23T11:31:00Z", now)?.needsReview, false);
  assert.equal(operationalStageAttention("PARTNER_ACCEPTED", null, now)?.needsReview, true);
  assert.equal(operationalStageAttention("PREPARING", "bad-time", now)?.needsReview, true);
  assert.equal(operationalStageAttention("CAPTAIN_ASSIGNED", null, now), null);
  assert.equal(operationalStageAttention("DELIVERED", null, now), null);
});

test("Store preparation target controls attention only while preparing", () => {
  assert.equal(operationalStageAttention("PREPARING", "2026-10-23T11:25:00Z", now, 45)?.needsReview, false);
  assert.equal(operationalStageAttention("PREPARING", "2026-10-23T11:25:00Z", now, 10)?.needsReview, true);
  assert.match(operationalStageAttention("PREPARING", "2026-10-23T11:25:00Z", now, 10)?.label ?? "", /10/);
  assert.equal(operationalStageAttention("CREATED", "2026-10-23T11:25:00Z", now, 180)?.needsReview, true);
  assert.equal(operationalStageAttention("PREPARING", "2026-10-23T11:25:00Z", now, null)?.needsReview, true);
});

test("upcoming checkpoint is visible without claiming a contractual SLA", () => {
  const preparing = operationalStageAttention("PREPARING", "2026-10-23T11:25:00Z", now, 45);
  assert.equal(preparing?.needsReview, false);
  assert.match(preparing?.label ?? "", /10|١٠|۱۰/);
  assert.match(preparing?.label ?? "", /التجهيز/);
  const created = operationalStageAttention("CREATED", "2026-10-23T11:50:00Z", now);
  assert.equal(created?.needsReview, false);
  assert.match(created?.label ?? "", /20|٢٠|۲۰/);
  assert.match(created?.label ?? "", /التشغيلي/);
  assert.doesNotMatch(created?.label ?? "", /SLA|عقد|مخالفة/);
});
test("overdue attention uses audited stage entry and configured store preparation time", () => {
  const overdue = operationalStageAttention("PREPARING", "2026-10-23T11:25:00Z", now, 10);
  assert.equal(overdue?.needsReview, true);
  assert.match(overdue?.label ?? "", /25|٢٥|۲۵/);
  assert.equal(operationalStageAttention("PREPARING", "bad", now, 10)?.needsReview, true);
  assert.equal(operationalStageAttention("CAPTAIN_ASSIGNED", "2026-10-23T10:00:00Z", now, 10), null);
});


test("approved SLA takes precedence without hiding missing evidence or inventing default", () => {
  const at = "2026-10-23T12:10:00Z";
  const overdue = operationalSlaAttention({ slaStatus: "ON_TRACK", slaDeadlineAt: "2026-10-23T11:50:00Z", slaPolicyVersion: 1 }, now);
  assert.equal(overdue?.needsReview, true);
  assert.match(overdue?.label ?? "", /SLA متأخر/);
  const tracked = operationalSlaAttention({ slaStatus: "ON_TRACK", slaDeadlineAt: at, slaPolicyVersion: 2 }, now);
  assert.equal(tracked?.needsReview, false);
  assert.match(tracked?.label ?? "", /ضمن المهلة/);
  assert.equal(operationalSlaAttention({ slaStatus: "UNCONFIGURED" }, now), null);
  assert.equal(operationalSlaAttention({ slaStatus: "NOT_APPLICABLE" }, now), null);
  assert.equal(operationalSlaAttention({ slaStatus: "MISSING_EVENT" }, now)?.needsReview, true);
  assert.equal(operationalSlaAttention({ slaStatus: "AT_RISK", slaDeadlineAt: at, slaPolicyVersion: 2 }, now)?.needsReview, true);
  assert.equal(operationalSlaAttention({ slaStatus: "OVERDUE", slaDeadlineAt: null, slaPolicyVersion: 1 }, now)?.needsReview, true);
});
