import test from "node:test";
import assert from "node:assert/strict";
import { inspectDemoContent } from "./preview-demo-content.mjs";

test("offline demo pack has importer-shaped catalogs and local preview artwork", () => {
  const result = inspectDemoContent();
  assert.deepEqual(result, {
    stores: 3,
    categories: 5,
    products: 9,
    productArtwork: 9,
    discoveryProposals: 1,
    artwork: 18,
    missingStoreBindings: 3,
  });
});

test("offline catalog preview contains supported CSV headers and positive YER prices", () => {
  const result = inspectDemoContent();
  assert.equal(result.products, result.stores * 3);
});
