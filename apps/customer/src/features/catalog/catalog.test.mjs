import assert from "node:assert/strict";
import { test } from "node:test";
import { formatPublicPriceYer } from "./price-format.ts";

test("public catalog only formats valid owner-confirmed positive prices", () => {
  assert.match(formatPublicPriceYer(500), /ريال يمني/);
  for (const value of [0, -1, NaN, 1.5, Infinity]) {
    assert.throws(() => formatPublicPriceYer(value), /INVALID_DSH_PRICE/);
  }
});
