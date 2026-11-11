import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("partner order details distinguish unit price from the charged line total", () => {
  const source = readFileSync(new URL("./order-management.tsx", import.meta.url), "utf8");
  assert.match(source, /pricingBasisLabel\(line\.pricingBasis\)}: \{formatMoney\(line\.unitPriceMinor, line\.currency\)\}/);
  assert.match(source, /إجمالي السطر: \{formatMoney\(line\.lineAmountMinor, line\.currency\)\}/);
  assert.doesNotMatch(source, /pricingBasisLabel\(line\.pricingBasis\)} · \{formatMoney\(line\.lineAmountMinor, line\.currency\)\}/);
});

test("Partner order presentation uses canonical DSH price labels and design-system digit normalization", () => {
  const source = readFileSync(new URL("./order-management.tsx", import.meta.url), "utf8");
  assert.match(source, /import \{[^;\n]*\btoAsciiDigits\b[^;\n]*\} from "@bthwani\/design-system";/);
  assert.match(source, /import \{[^;\n]*\bpricingBasisLabel\b[^;\n]*\} from "@bthwani\/dsh";/);
  assert.match(source, /import \{ createPartnerDshClient as client \} from "\.\.\/\.\.\/bootstrap\/dsh-client";/);
  assert.doesNotMatch(source, /function (?:toAsciiDigits|pricingBasisLabel)\(/);
  assert.doesNotMatch(source, /const client = createPartnerDshClient;/);
});
