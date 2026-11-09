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
  assert.match(component, /const visible = visibleScopeKey === scopeKey;/);
  assert.match(component, /\{!loading && visible && orders\.map\(order => \{/);
  assert.match(component, /setVisibleScopeKey\(scopeKey\);/);
  assert.match(component, /catch \{\s*if \(isCurrent\(\)\) \{(?:\s*\/\/[^\n]*\n)*\s*setOrders\(\[\]\);\s*setCursor\(""\);\s*setVisibleScopeKey\(""\);/);
  assert.match(component, /setError\("تعذر قراءة طلبات الاستلام/);
});

test("an ambiguous PATCH outcome keeps successfully reread orders visible, never retries the write", () => {
  assert.match(component, /await load\(\);\s*if \(isCurrentAction\(\)\) setError\("تعذر تأكيد التحديث/);
  assert.match(component, /\{!loading && visible && orders\.map\(order => \{/);
  assert.match(component, /\{!loading && visible && cursor \? <BthwaniButton/);
  assert.doesNotMatch(component, /\{!loading && visible && !error && orders\.map/);
  assert.match(component, /setVisibleScopeKey\(""\);[\s\S]*?setError\("تعذر قراءة طلبات الاستلام/);
});
