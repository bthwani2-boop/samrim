import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import path from "node:path";

const component = readFileSync(path.resolve(import.meta.dirname, "../src/features/order-management/independent-pickup-orders.tsx"), "utf8");
const parent = readFileSync(path.resolve(import.meta.dirname, "../src/features/partner-onboarding/partner-orders.tsx"), "utf8");

test("the real partner Orders parent remounts each independent Store before showing its data", () => {
  assert.match(parent, /<IndependentPickupOrders key=\{selectedStore\.id\} storeID=\{selectedStore\.id\}/);
  assert.match(component, /result\.orders\.some\(order => order\.storeId !== storeID\)/);
  assert.match(component, /currentScope\(\) === scope/);
});

test("direct Order records are hidden during any revalidation or rejected readback", () => {
  assert.match(component, /\{!loading && !error && orders\.map\(order => \{/);
  assert.match(component, /catch \{\s*if \(isCurrent\(\)\) \{(?:\s*\/\/[^\n]*\n)*\s*setOrders\(\[\]\);\s*setCursor\(""\);/);
  assert.match(component, /setError\("تعذر قراءة طلبات الاستلام/);
});
