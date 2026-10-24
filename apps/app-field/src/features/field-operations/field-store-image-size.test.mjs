import assert from "node:assert/strict";
import { test } from "node:test";
import { publicStoreImageSize } from "./field-store-image-size.ts";

test("public storefront image resize bounds long dimensions without upscaling", () => {
  assert.deepEqual(publicStoreImageSize(2000, 3000), { width: 1067, height: 1600 });
  assert.deepEqual(publicStoreImageSize(3000, 2000), { width: 1600, height: 1067 });
  assert.deepEqual(publicStoreImageSize(800, 600), { width: 800, height: 600 });
  assert.deepEqual(publicStoreImageSize(1600, 1600), { width: 1600, height: 1600 });
  assert.deepEqual(publicStoreImageSize(6000, 1), { width: 1600, height: 1 });
});

test("invalid image geometry never reaches a native manipulation", () => {
  for (const n of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => publicStoreImageSize(n, 500), /STORE_IMAGE_DIMENSIONS_INVALID/);
    assert.throws(() => publicStoreImageSize(500, n), /STORE_IMAGE_DIMENSIONS_INVALID/);
  }
});
