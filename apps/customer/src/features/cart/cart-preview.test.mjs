import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { previewLineSubtotalYer, summarizeCartPreview } from "./cart-preview.ts";

test("cart read-only preview keeps large DSH integer YER amounts exact", () => {
  const first = { previewUnitYer: "9007199254740993", quantity: 2147483647, previewAvailable: true };
  const second = { previewUnitYer: "150", quantity: 2, previewAvailable: true };
  assert.equal(previewLineSubtotalYer(first), 9007199254740993n * 2147483647n);
  assert.deepEqual(summarizeCartPreview([first, second]), {
    availableSubtotalYer: 9007199254740993n * 2147483647n + 300n,
    unavailableLines: 0,
  });
});

test("cart preview excludes unavailable offers without hiding their count", () => {
  const available = { previewUnitYer: "1200", quantity: 2, previewAvailable: true };
  const unavailable = { previewUnitYer: "990000", quantity: 1, previewAvailable: false };
  assert.deepEqual(summarizeCartPreview([unavailable, available]), {
    availableSubtotalYer: 2400n, unavailableLines: 1,
  });
  assert.deepEqual(summarizeCartPreview([]), {
    availableSubtotalYer: 0n, unavailableLines: 0,
  });
});

test("customer cart UI labels preview subtotal as non-authoritative and counts unavailable lines", () => {

  const source = readFileSync(new URL("./cart-screen.tsx", import.meta.url), "utf8");
  assert.match(source, /summarizeCartPreview\(view\.cart\.lines\)/);
  assert.match(source, /previewLineSubtotalYer\(line\)/);
  assert.match(source, /الإجمالي التقديري للعروض المتاحة/);
  assert.match(source, /التسعير النهائي/);
  assert.match(source, /preview\.unavailableLines/);
});