import assert from "node:assert/strict";
import { test } from "node:test";
import { formatPublicEstimateYer, formatPublicPriceYer } from "./price-format.ts";

test("public catalog only formats valid owner-confirmed positive prices", () => {
  assert.match(formatPublicPriceYer(500), /ريال يمني/);
  const maxPrice = 9223372036854775807n;
  assert.equal(formatPublicPriceYer(maxPrice.toString()), `${maxPrice.toLocaleString("ar-YE")} ريال يمني`);
  for (const value of [0, -1, NaN, 1.5, Infinity, Number(maxPrice), (maxPrice + 1n).toString()]) {
    assert.throws(() => formatPublicPriceYer(value), /INVALID_DSH_PRICE/);
  }
});

test("public merchandise estimate formats exact YER without passing BigInt to NumberFormat", () => {
  for (const amount of ["1", "1200", "9007199254740993", "9223372036854775807", "9".repeat(29)]) {
    assert.equal(formatPublicEstimateYer(amount), BigInt(amount).toLocaleString("ar-YE"));
  }
  for (const invalid of ["", "0", "01", "-1", "1.5", "1e3", "9".repeat(30)]) {
    assert.throws(() => formatPublicEstimateYer(invalid), /INVALID_DSH_AMOUNT/);
  }
});
