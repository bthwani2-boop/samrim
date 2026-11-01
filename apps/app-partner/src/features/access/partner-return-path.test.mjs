import assert from "node:assert/strict";
import { test } from "node:test";

import { partnerReturnPath, partnerReturnPathPattern } from "./partner-return-path.ts";

test("Partner product filter survives login only when it is admitted", () => {
  for (const filter of ["all", "popular", "offers", "published", "unavailable", "hidden", "stockout"]) {
    const value = partnerReturnPath("/products", filter);
    assert.equal(value, "/products?filter=" + filter);
    assert.equal(partnerReturnPathPattern.test(value), true);
  }
});

test("Partner other surfaces keep only their paths and do not acquire filters", () => {
  for (const path of ["/orders", "/wallet", "/store", "/more", "/account", "/onboarding", "/notifications"]) {
    assert.equal(partnerReturnPath(path, "stockout"), path);
    assert.equal(partnerReturnPathPattern.test(path), true);
  }
});

test("Untrusted filters and redirects are not copied into login destinations", () => {
  for (const filter of ["", "error", "stockout&next=https://example.com", "stockout#fragment",
    "stockout/../../wallet", "%2f%2fevil", "stockout?returnTo=//evil"]) {
    assert.equal(partnerReturnPath("/products", filter), "/products");
  }
  assert.equal(partnerReturnPath("/products", ["stockout", "hidden"]), "/products");
  for (const malicious of ["//example.com", "/products?filter=stockout&extra=x", "/products?filter=stockout#frag",
    "/wallet?filter=stockout", "/products/../wallet", "/products?filter=%2f%2fevil",
    "/products?filter=stockout%0a", "/products?filter=published&returnTo=//example.com"]) {
    assert.equal(partnerReturnPathPattern.test(malicious), false, malicious);
  }
});
