import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./order-management.tsx", import.meta.url), "utf8");

test("an empty Partner order search offers a scoped one-tap recovery", () => {
  const start = source.indexOf("!loading && !orders.length && !error");
  const end = source.indexOf("{orders.map((order)", start);
  assert.ok(start > 0 && end > start, "existing filtered empty state remains in the order workspace");
  const empty = source.slice(start, end);
  assert.match(empty, /label="مسح بحث الطلبات"/);
  assert.match(empty, /router\.setParams\(\{ q: "", orderId: "" \}\)/);
  assert.match(empty, /normalizedSearch\s*\?/);
});

test("search recovery does not replace status filters or order authorization", () => {
  assert.match(source, /requestScopeKey = JSON\.stringify\(\[unreadScope, storeId \?\? "", filter, normalizedSearch\]\)/);
  assert.match(source, /canFulfillOrder\(order\.storeId\)/);
  assert.match(source, /filter === "NEEDS_ACTION"/);
});

test("Partner order queue buttons expose their selected state to assistive technology", () => {
  assert.match(source, /aria-pressed=\{filter === key\}/);
  assert.match(source, /accessibilityLabel=\{label\}/);
});
