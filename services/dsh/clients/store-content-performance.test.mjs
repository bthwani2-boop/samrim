import assert from "node:assert/strict";
import { test } from "node:test";
import { verifiedStoreContentPerformance, storeContentEventRatios } from "./store-content-performance.ts";

const base = {
  storeId: "store-a", period: "30d", contentCount: 2,
  impressions: 400, clicks: 42, attributedOrdersCreated: 8, attributedOrdersCompleted: 6,
};

test("store marketing projection rejects foreign scope and impossible completion", () => {
  assert.equal(verifiedStoreContentPerformance(base, "store-a", "30d"), base);
  assert.equal(verifiedStoreContentPerformance(base, "store-b", "30d"), null);
  assert.equal(verifiedStoreContentPerformance(base, "store-a", "7d"), null);
  for (const change of [{ clicks: -1 }, { impressions: NaN }, { attributedOrdersCompleted: 9 }, { contentCount: 1.5 }]) {
    assert.equal(verifiedStoreContentPerformance({ ...base, ...change }, "store-a", "30d"), null);
  }
});

test("reports event click ratio, completion ratio, and genuine zero-denominator absence", () => {
  assert.deepEqual(storeContentEventRatios(base), {
    clicksPerHundredImpressions: 10.5, completedAttributedOrdersPercent: 75,
  });
  assert.deepEqual(storeContentEventRatios({ ...base, impressions: 0, clicks: 4,
    attributedOrdersCreated: 0, attributedOrdersCompleted: 0 }), {
    clicksPerHundredImpressions: null, completedAttributedOrdersPercent: null,
  });
  assert.deepEqual(storeContentEventRatios({ ...base, impressions: 2, clicks: 5 }), {
    clicksPerHundredImpressions: 250, completedAttributedOrdersPercent: 75,
  });
  assert.deepEqual(storeContentEventRatios({ ...base, attributedOrdersCompleted: 20 }), {
    clicksPerHundredImpressions: null, completedAttributedOrdersPercent: null,
  });
});
