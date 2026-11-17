import assert from "node:assert/strict";
import { test } from "node:test";
import { publicStorefrontPath } from "./store-share.ts";

test("public Store share links encode valid IDs and reject path injection", () => {
  assert.equal(publicStorefrontPath("shop-42"), "/storefront/shop-42");
  assert.equal(publicStorefrontPath("store name"), "/storefront/store%20name");
  for (const value of ["", ".", "..", "../admin", "a/b", "a\\b", "bad\nstore"]) {
    assert.equal(publicStorefrontPath(value), "/stores");
  }
});
