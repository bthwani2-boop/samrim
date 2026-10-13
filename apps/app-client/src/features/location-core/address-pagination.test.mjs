import assert from "node:assert/strict";
import test from "node:test";
import { appendDistinctDeliveryAddresses } from "./address-pagination.ts";

const page1 = [{ id: "address-1", addressText: "old" }, { id: "address-2", addressText: "current" }];

test("merges pagination without duplicate owner IDs", () => {
  const result = appendDistinctDeliveryAddresses(page1, [{ id: "address-2", addressText: "stale" }, { id: "address-3", addressText: "new" }, { id: "address-3", addressText: "new" }]);
  assert.deepEqual(result.map((address) => address.id), ["address-1", "address-2", "address-3"]);
  assert.equal(result[1].addressText, "current");
});

test("preserves existing ordering and input arrays", () => {
  const incoming = [{ id: "address-4" }];
  const result = appendDistinctDeliveryAddresses(page1, incoming);
  assert.deepEqual(result.map((address) => address.id), ["address-1", "address-2", "address-4"]);
  assert.equal(page1.length, 2);
  assert.equal(incoming.length, 1);
});
