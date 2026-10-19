import assert from "node:assert/strict";
import test from "node:test";
import { operationNotificationHref } from "./notification-operation-link.ts";

test("operation notification link uses a canonical order ID only", () => {
  assert.equal(operationNotificationHref("ord_123-456"), "/operations/ord_123-456?tab=overview");
  assert.equal(operationNotificationHref("order-123"), "/operations/order-123?tab=overview");
});

test("notification links cannot traverse to another route", () => {
  for (const invalid of ["", "../access", "/finance", "https://example.com", "..", "x?lane=history", "a/b", "a#frag", " ", "x".repeat(129)]) {
    assert.equal(operationNotificationHref(invalid), null, invalid);
  }
});
