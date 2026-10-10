import assert from "node:assert/strict";
import { test } from "node:test";

import { isValidStoreWorkingHours, joiningCaseImageMultipartPart, resolveJoiningCaseImageContentType } from "./joining-case-media.ts";

test("native joining-case image upload uses the URI file part instead of a fetched Blob", () => {
  const blob = new Blob(["image"], { type: "image/png" });
  assert.deepEqual(joiningCaseImageMultipartPart("file:///cache/proof.png", "proof.png", "image/png", blob), {
    uri: "file:///cache/proof.png", name: "proof.png", type: "image/png",
  });
  assert.deepEqual(joiningCaseImageMultipartPart("content://media/7", "store.jpg", "image/jpeg", blob), {
    uri: "content://media/7", name: "store.jpg", type: "image/jpeg",
  });
  assert.equal(joiningCaseImageMultipartPart("blob:https://example.test/image", "proof.png", "image/png", blob), blob);
});

test("resolveJoiningCaseImageContentType uses declared type and supported extensions", () => {
	assert.equal(resolveJoiningCaseImageContentType("image/png", "image/jpeg", "photo.jpg", "file:///photo"), "image/png");
	assert.equal(resolveJoiningCaseImageContentType(undefined, "", "photo.JPEG", "file:///photo"), "image/jpeg");
	assert.equal(resolveJoiningCaseImageContentType(undefined, undefined, undefined, "file:///cache/photo.png?preview=1"), "image/png");
	assert.equal(resolveJoiningCaseImageContentType(undefined, "application/octet-stream", "photo.heic", "file:///cache/asset"), null);
});

test("isValidStoreWorkingHours accepts a valid overnight interval", () => {
	assert.equal(isValidStoreWorkingHours([
		{ dayOfWeek: 1, opensAt: "21:00", closesAt: "08:00", closesNextDay: true },
	]), true);
	assert.equal(isValidStoreWorkingHours([
		{ dayOfWeek: 1, opensAt: "09:00", closesAt: "09:00", closesNextDay: true },
	]), true);
});

test("isValidStoreWorkingHours rejects invalid clocks, >24-hour spans, and weekly overlap", () => {
	assert.equal(isValidStoreWorkingHours([
		{ dayOfWeek: 1, opensAt: "24:00", closesAt: "08:00", closesNextDay: true },
	]), false);
	assert.equal(isValidStoreWorkingHours([
		{ dayOfWeek: 1, opensAt: "09:00", closesAt: "09:01", closesNextDay: true },
	]), false);
	assert.equal(isValidStoreWorkingHours([
		{ dayOfWeek: 7, opensAt: "23:00", closesAt: "01:00", closesNextDay: true },
		{ dayOfWeek: 1, opensAt: "00:30", closesAt: "02:00", closesNextDay: false },
	]), false);
});
