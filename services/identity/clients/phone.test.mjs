import assert from "node:assert/strict";
import test from "node:test";
import { normalizeYemenPhoneE164 } from "./phone.ts";

test("canonical Yemeni phone normalization preserves existing admitted formats", () => {
  for (const [input, expected] of [
    ["771234567", "+967771234567"],
    ["0771234567", "+967771234567"],
    ["967771234567", "+967771234567"],
    ["00967771234567", "+967771234567"],
    ["+967 771-234-567", "+967771234567"],
    ["٧٧١٢٣٤٥٦٧", "+967771234567"],
    ["۰۷۷۱۲۳۴۵۶۷", "+967771234567"],
    ["+12025550123", "+12025550123"],
    ["invalid", "invalid"],
  ]) {
    assert.equal(normalizeYemenPhoneE164(input), expected, input);
  }
});
