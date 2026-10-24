import assert from "node:assert/strict";
import test from "node:test";
import { clientShareMessageLabel } from "./client-share-types.ts";

test("private share presets are short and never impersonate a payment authorization", () => {
  const labels = ["LOOK", "LIKE", "OFFER", "TRY"].map(clientShareMessageLabel);
  assert.equal(new Set(labels).size, 4);
  assert.deepEqual(labels, ["شوف هذا", "قد يعجبك", "استفد من هذا", "خلينا نجربه"]);
  for (const label of labels) assert.ok(label.length <= 25);
});
