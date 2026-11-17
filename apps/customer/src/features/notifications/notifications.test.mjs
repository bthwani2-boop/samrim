import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveNotificationDestination } from "./notification-destination.ts";

test("notifications can only route to allowlisted internal paths", () => {
  for (const path of ["/stores", "/orders", "/wallet", "/orders/order-123", "/store/abc_1"]) {
    assert.equal(resolveNotificationDestination(path), path);
  }
  for (const path of ["//other.test", "https://other.test", "/admin", "/orders/../admin", "/wallet/credit", null]) {
    assert.equal(resolveNotificationDestination(path), null);
  }
});
