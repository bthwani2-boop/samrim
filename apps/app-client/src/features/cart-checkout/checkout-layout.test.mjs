import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./cart-checkout.tsx", import.meta.url), "utf8");
const parent = readFileSync(new URL("./client-cart-screen.tsx", import.meta.url), "utf8");
const footer = readFileSync(new URL("../order-experience/premium-order-ui.tsx", import.meta.url), "utf8");

test("checkout renders exactly one payment selector and one invoice", () => {
  assert.equal(source.split('accessibilityLabel="توزيع مصدر الدفع"').length - 1, 1);
  assert.equal(source.split('accessibilityLabel="الفاتورة"').length - 1, 1);
});
test("checkout sections remain in the approved single-page order", () => {
  const index = (value) => { const result = source.indexOf(value); assert.notEqual(result, -1, value); return result; };
  assert.ok(index('style={styles.lineList}') < index("{addressSection}"));
  assert.ok(index("{addressSection}") < index('accessibilityLabel="توزيع مصدر الدفع"'));
  assert.ok(index('accessibilityLabel="توزيع مصدر الدفع"') < index('accessibilityLabel="الفاتورة"'));
});
test("unpriced checkout uses a state label rather than a fictitious total", () => {
  assert.match(source, /totalReady: Boolean\(verifiedQuote\)/);
  assert.match(parent, /caption=\{footer\.totalReady \? "الإجمالي الكلي" : "قبل التأكيد"\}/);
  assert.match(footer, /\{caption\}/);
});
