import assert from "node:assert/strict";
import { test } from "node:test";
import { customerAuthDestination } from "./auth-return-path.ts";

test("Customer login continues only to exact admitted screens", () => {
  for (const path of ["/", "/account", "/wallet", "/addresses", "/orders"]) {
    assert.equal(customerAuthDestination(path), path);
  }
});

test("Customer login refuses external, encoded, ambiguous and unadmitted destinations", () => {
  for (const path of [
    "/api/customer-auth", "/wallet-cash-in", "/lab", "/verification", "/login",
    "//evil.test", "https://evil.test", "/%2f%2fevil", "/../wallet", "/../account",
    "/\\evil", "/orders?next=/wallet", "/orders#details", "/orders/", "/Orders",
    " /orders", "/orders ", "/".repeat(301), "", null, undefined, 1, true,
    ["/wallet"], { toString: () => "/wallet" },
  ]) {
    assert.equal(customerAuthDestination(path), "/");
  }
});
