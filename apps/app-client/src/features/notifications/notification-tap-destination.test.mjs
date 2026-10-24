import assert from "node:assert/strict";
import { test } from "node:test";
import { clientPushDestination } from "./notification-tap-destination.ts";

test("routes an owned order notification to its order", () => {
  assert.equal(clientPushDestination("actor-A", { actorId: "actor-A", orderId: "order-123" }), "/orders/order-123");
});

test("routes an owned client share push with no order to the notification inbox", () => {
  assert.equal(clientPushDestination("actor-A", { actorId: "actor-A", orderId: "", notificationId: "share:42" }), "/notifications");
});

test("never opens a push from another account", () => {
  assert.equal(clientPushDestination("actor-A", { actorId: "actor-B", orderId: "order-123" }), null);
  assert.equal(clientPushDestination("", { actorId: "", notificationId: "share:42" }), null);
});

test("rejects invalid navigation data and unknown non-order pushes", () => {
  for (const data of [
    { actorId: "actor-A", orderId: "../wallet" },
    { actorId: "actor-A", orderId: "/orders/other" },
    { actorId: "actor-A", notificationId: "share:../2" },
    { actorId: "actor-A", notificationId: "other:42" },
    { actorId: "actor-A", orderId: 123 },
    undefined,
  ]) {
    assert.equal(clientPushDestination("actor-A", data), null);
  }
});
