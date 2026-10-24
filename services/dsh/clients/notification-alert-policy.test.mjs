import assert from "node:assert/strict";
import test from "node:test";
import { OrderAlertCursor, orderAlertLevel } from "./notification-alert-policy.ts";

const event = (id, kind, title, createdAt, readAt = null) => ({
  id, kind, title, createdAt, readAt, body: "تحديث", orderId: "ord-1"
});

test("urgent types are role-scoped and expired captain offers never ring", () => {
  assert.equal(orderAlertLevel("partner", event("1", "ORDER_CREATED", "وصل طلب جديد", "")), "action");
  assert.equal(orderAlertLevel("client", event("1", "ORDER_CREATED", "", "")), "silent");
  assert.equal(orderAlertLevel("captain", event("1", "CAPTAIN_OFFER", "طلب توصيل جديد", "")), "action");
  assert.equal(orderAlertLevel("captain", event("1", "CAPTAIN_OFFER", "تحديث عرض التوصيل", "")), "silent");
  assert.equal(orderAlertLevel("operator", event("1", "DELIVERY_FAILED", "", "")), "action");
  assert.equal(orderAlertLevel("operator", event("1", "ORDER_CREATED", "", "")), "silent");
});

test("baseline skips history; newer unread event rings once per actor", () => {
  const cursor = new OrderAlertCursor();
  const now = Date.parse("2026-10-24T06:00:00Z");
  const old = event("o1", "ORDER_CREATED", "وصل طلب جديد", new Date(now - 20_000).toISOString());
  const next = event("o2", "ORDER_CREATED", "وصل طلب جديد", new Date(now - 1_000).toISOString());
  assert.deepEqual(cursor.receive("partner", "partnerA", [old], now), []);
  assert.deepEqual(cursor.receive("partner", "partnerA", [next, old], now).map(x => x.id), ["o2"]);
  assert.deepEqual(cursor.receive("partner", "partnerA", [next, old], now), []);
  assert.deepEqual(cursor.receive("partner", "partnerB", [next, old], now), []);
});

test("no false ring for read, stale or future notifications", () => {
  const cursor = new OrderAlertCursor();
  const now = Date.parse("2026-10-24T06:00:00Z");
  cursor.receive("partner", "P", [], now);
  const events = [
    event("r", "ORDER_CREATED", "وصل طلب جديد", new Date(now).toISOString(), new Date(now).toISOString()),
    event("s", "ORDER_CREATED", "وصل طلب جديد", new Date(now - 90001).toISOString()),
    event("f", "ORDER_CREATED", "وصل طلب جديد", new Date(now + 3000).toISOString())
  ];
  assert.deepEqual(cursor.receive("partner", "P", events, now), []);
});

test("superseded offers and resolved failures never wake a user", () => {
  const now = Date.parse("2026-10-24T06:00:00Z");
  for (const [role, oldKind, oldTitle, nextKind, nextTitle] of [
    ["captain", "CAPTAIN_OFFER", "طلب توصيل جديد", "CAPTAIN_OFFER", "تحديث عرض التوصيل"],
    ["partner", "ORDER_CREATED", "وصل طلب جديد", "ORDER_ACCEPTED", "تم القبول"],
    ["operator", "DELIVERY_FAILED", "تعذر", "DELIVERY_RECOVERED", "استأنف"],
  ]) {
    const cursor = new OrderAlertCursor();
    cursor.receive(role, role, [], now);
    const previous = event("old", oldKind, oldTitle, new Date(now - 8000).toISOString());
    const newer = event("new", nextKind, nextTitle, new Date(now - 4000).toISOString());
    assert.deepEqual(cursor.receive(role, role, [newer, previous], now), []);
  }
});
