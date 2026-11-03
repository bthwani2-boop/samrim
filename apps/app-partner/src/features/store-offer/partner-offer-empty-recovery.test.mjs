import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./store-offer.tsx", import.meta.url), "utf8");

test("a Partner can clear no-result search and filters without changing Store data", () => {
  const start = source.indexOf("لا توجد منتجات تطابق البحث أو التصفية.");
  assert.ok(start >= 0, "filtered empty state must remain visible");
  const end = source.indexOf("hasMoreOffers", start);
  assert.ok(end > start, "empty state must be immediately before load-more");
  const emptyView = source.slice(start, end);
  assert.match(emptyView, /label="مسح البحث والتصفية"/);
  assert.match(emptyView, /setListFilter\("all"\)/);
  assert.match(emptyView, /router\.setParams\(\{ q: "", filter: "all" \}\)/);
});

test("a filtered empty state remains separate from loading, error and never-added offers", () => {
  assert.match(source, /remoteOffers\.kind === "loading"/);
  assert.match(source, /remoteOffers\.kind === "error"/);
  assert.match(source, /لا توجد عروض مرتبطة بهذا المتجر بعد/);
});
