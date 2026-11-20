import assert from "node:assert/strict";
import test from "node:test";
import { parseStoreAvailabilityQuery } from "./store-availability-query.ts";

test("operator Store availability requires a single bounded Store ID", () => {
  assert.equal(parseStoreAvailabilityQuery({}), "");
  assert.equal(parseStoreAvailabilityQuery({ storeId: "market-sanaa" }), "market-sanaa");
  for (const params of [
    { storeId: "UPPER" }, { storeId: "../secret" }, { storeId: "a?".repeat(100) },
    { storeId: ["a", "b"] }, { storeId: "store1", actorId: "forged" },
    { storeId: "" }, { storeId: "a".repeat(65) },
  ]) {
    assert.equal(parseStoreAvailabilityQuery(params), null, JSON.stringify(params));
  }
});
