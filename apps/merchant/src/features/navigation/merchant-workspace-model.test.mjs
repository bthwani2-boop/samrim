import assert from "node:assert/strict";
import { test } from "node:test";
import {
  merchantMobileSections,
  merchantNavigation,
  merchantStoreSummary,
} from "./merchant-workspace-model.ts";

test("Merchant workspace has unique functional navigation targets on desktop and mobile", () => {
  const ids = merchantNavigation.map(item => item.id);
  assert.deepEqual(ids, ["home", "stores", "orders", "products", "wallet", "more"]);
  assert.equal(new Set(ids).size, ids.length);
  for (const section of merchantMobileSections) {
    assert.ok(ids.includes(section), `mobile section ${section} must also exist on desktop`);
  }
  assert.deepEqual(merchantMobileSections, ["home", "orders", "products", "wallet", "more"]);
});

test("Merchant workspace metrics depend exclusively on owner-verified DSH stores", () => {
  assert.deepEqual(merchantStoreSummary([]), { total: 0, published: 0, unpublished: 0 });
  const stores = [
    { id: "a", name: "أ", relation: "DIRECT", published: true },
    { id: "b", name: "ب", relation: "MARKETPLACE", published: false },
    { id: "c", name: "ج", relation: "DIRECT", published: true },
  ];
  assert.deepEqual(merchantStoreSummary(stores), { total: 3, published: 2, unpublished: 1 });
  assert.equal(merchantStoreSummary(stores).total, stores.length);
});
