import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("partner order details distinguish unit price from the charged line total", () => {
  const source = readFileSync(new URL("./order-management.tsx", import.meta.url), "utf8");
  assert.match(source, /pricingBasisLabel\(line\.pricingBasis\)}: \{formatMoney\(line\.unitPriceMinor, line\.currency\)\}/);
  assert.match(source, /إجمالي السطر: \{formatMoney\(line\.lineAmountMinor, line\.currency\)\}/);
  assert.doesNotMatch(source, /pricingBasisLabel\(line\.pricingBasis\)} · \{formatMoney\(line\.lineAmountMinor, line\.currency\)\}/);
});
