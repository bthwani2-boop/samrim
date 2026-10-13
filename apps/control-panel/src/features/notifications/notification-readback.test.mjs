import assert from "node:assert/strict";
import test from "node:test";
import { parseOperatorNotificationList } from "./notification-readback.ts";

const valid = {
  notifications: [{ id: "order:12", kind: "ORDER_CREATED", title: "جديد", body: "طلب", orderId: "order-1", createdAt: "2026-10-13T12:00:00Z", readAt: null }],
  unreadCount: 1,
  nextCursor: "cursor-2",
};

test("accepts valid notifications including empty true readback", () => {
  assert.equal(parseOperatorNotificationList(valid).notifications.length, 1);
  assert.deepEqual(parseOperatorNotificationList({ notifications: [], unreadCount: 0, nextCursor: "" }).notifications, []);
});

test("rejects missing list instead of inventing an empty inbox", () => {
  for (const value of [null, {}, { unreadCount: 0 }, { notifications: null, unreadCount: 0 }, { notifications: [], unreadCount: -1 }]) {
    assert.throws(() => parseOperatorNotificationList(value), /INVALID_OPERATOR_NOTIFICATIONS/);
  }
});

test("rejects forged/malformed readback and duplicate ids", () => {
  for (const notification of [
    { ...valid.notifications[0], id: "" },
    { ...valid.notifications[0], createdAt: "invalid" },
    { ...valid.notifications[0], readAt: "invalid" },
    { ...valid.notifications[0], orderId: 12 },
  ]) {
    assert.throws(() => parseOperatorNotificationList({ ...valid, notifications: [notification] }), /INVALID_OPERATOR_NOTIFICATIONS/);
  }
  assert.throws(() => parseOperatorNotificationList({ ...valid, notifications: [valid.notifications[0], valid.notifications[0]] }), /INVALID_OPERATOR_NOTIFICATIONS/);
  assert.throws(() => parseOperatorNotificationList({ ...valid, nextCursor: 4 }), /INVALID_OPERATOR_NOTIFICATIONS/);
});
