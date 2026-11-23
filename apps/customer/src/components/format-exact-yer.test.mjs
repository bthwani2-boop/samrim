import assert from "node:assert/strict";
import { test } from "node:test";
import { formatExactYer } from "./format-exact-yer.ts";

test("Customer presentation formats zero and exact owner amounts without loss of precision", () => {
  for (const amount of ["0", "1200", "9007199254740993", "9223372036854775807", "9".repeat(29)]) {
    assert.equal(formatExactYer(amount), BigInt(amount).toLocaleString("ar-YE"));
    assert.equal(formatExactYer(BigInt(amount)), BigInt(amount).toLocaleString("ar-YE"));
  }
});

test("Customer presentation rejects malformed untrusted amount text", () => {
  for (const value of ["", "01", "-1", "1.5", " 200", "1e3", "9".repeat(30)]) {
    assert.throws(() => formatExactYer(value), /INVALID_YER_AMOUNT/);
  }
});
