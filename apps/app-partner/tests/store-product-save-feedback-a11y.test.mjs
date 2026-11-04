import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../src/features/store-offer/store-offer.tsx", import.meta.url), "utf8");

test("Store product saved feedback uses a supported native accessibility role and polite announcement", () => {
  const feedback = source.match(/productSaveFeedback && panel === "create" && !selectedProduct \? <Text ([^>]+)>\{productSaveFeedback\}<\/Text>/);
  assert.ok(feedback, "Store product creation success feedback must remain visible");
  assert.match(feedback[1], /accessibilityRole="text"/);
  assert.match(feedback[1], /accessibilityLiveRegion="polite"/);
  assert.doesNotMatch(source, /accessibilityRole="status"/);
});
