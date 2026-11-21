import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOperatorHomeCity } from "./operator-home-city.ts";

test("operator home accepts only one bounded DSH city filter", () => {
  assert.equal(parseOperatorHomeCity({}), "");
  assert.equal(parseOperatorHomeCity({ city: "" }), "");
  assert.equal(parseOperatorHomeCity({ city: "sanaa" }), "sanaa");
  assert.equal(parseOperatorHomeCity({ city: "city-123" }), "city-123");
  assert.equal(parseOperatorHomeCity({ city: "x".repeat(64) }), "x".repeat(64));
});

test("operator home rejects parameters that could change the owner read scope", () => {
  for (const invalid of [
    { city: "Sanaa" }, { city: " city " }, { city: "x".repeat(65) },
    { city: "../access" }, { city: "sanaa?role=admin" },
    { city: ["sanaa", "aden"] }, { city: "sanaa", actorId: "another" },
    { city: "sanaa", cursor: "arbitrary" }, { city: undefined, q: "x" },
    { city: "\u0000" }, { city: "صنعاء" },
  ]) assert.equal(parseOperatorHomeCity(invalid), null, JSON.stringify(invalid));
});
