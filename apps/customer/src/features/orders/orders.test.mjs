import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { repeatOrderStoreDestination } from "./repeat-order.ts";

test("repeat-order link only reopens a Store, it cannot create an Order", () => {
  assert.equal(repeatOrderStoreDestination("shop-42"), "/store/shop-42");
  assert.equal(repeatOrderStoreDestination("../admin"), null);
  assert.equal(repeatOrderStoreDestination(""), null);
});
test("orders screens do not fabricate order statuses", () => {
  for (const file of ["orders-screen.tsx", "order-detail-screen.tsx"]) {
    assert.match(readFileSync(new URL(file, import.meta.url), "utf8"), /CapabilityUnavailableScreen/);
  }
});
