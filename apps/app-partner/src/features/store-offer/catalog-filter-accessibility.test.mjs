import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./store-offer.tsx", import.meta.url), "utf8");

test("product filter options expose the selected toggle state for accessible buttons", () => {
  const start = source.indexOf('([{ key: "all", label: "كل المنتجات" }');
  assert.ok(start >= 0, "existing filter choices must be preserved");
  const end = source.indexOf("</Pressable>", start);
  assert.ok(end > start, "filter option remains a single accessible action");
  const choice = source.slice(start, end);
  assert.match(choice, /accessibilityRole="button"/);
  assert.match(choice, /aria-pressed=\{listFilter === item\.key\}/);
  assert.doesNotMatch(choice, /aria-selected=/, "aria-selected is not valid on button roles");
  assert.match(choice, /accessibilityState=\{\{ selected: listFilter === item\.key \}\}/);
});
