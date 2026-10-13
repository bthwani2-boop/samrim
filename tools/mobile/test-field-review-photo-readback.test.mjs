import assert from "node:assert/strict";
import { test } from "node:test";

import { fieldReviewPhotoUploadConfirmed } from "../../apps/app-field/src/features/field-operations/field-draft-readback.ts";

const receipt = { id: "case-1", origin: "field", state: "draft", version: 8, reviewPhotoUploaded: true };
const saved = { ...receipt };

test("only a field review-photo write advancing this exact case version is confirmed", () => {
  assert.equal(fieldReviewPhotoUploadConfirmed(receipt, saved, "case-1", 7), true);
  assert.equal(fieldReviewPhotoUploadConfirmed(receipt, { ...saved, version: 9 }, "case-1", 7), true);
});

test("existing older review photo flag cannot confirm a new upload", () => {
  assert.equal(fieldReviewPhotoUploadConfirmed({ ...receipt, version: 7 }, saved, "case-1", 7), false);
  assert.equal(fieldReviewPhotoUploadConfirmed(receipt, { ...saved, version: 7 }, "case-1", 7), false);
  assert.equal(fieldReviewPhotoUploadConfirmed(receipt, saved, "case-1", 8), false);
  assert.equal(fieldReviewPhotoUploadConfirmed(receipt, { ...saved, reviewPhotoUploaded: false }, "case-1", 7), false);
});

test("foreign case and control-panel-origin reads cannot confirm field media", () => {
  assert.equal(fieldReviewPhotoUploadConfirmed(receipt, saved, "case-2", 7), false);
  assert.equal(fieldReviewPhotoUploadConfirmed(receipt, { ...saved, id: "case-2" }, "case-1", 7), false);
  assert.equal(fieldReviewPhotoUploadConfirmed({ ...receipt, origin: "control_panel" }, saved, "case-1", 7), false);
  assert.equal(fieldReviewPhotoUploadConfirmed(receipt, { ...saved, origin: "control_panel" }, "case-1", 7), false);
});
