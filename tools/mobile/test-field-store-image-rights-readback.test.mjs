import assert from "node:assert/strict";
import { test } from "node:test";

import { fieldDraftMediaUploadConfirmed } from "../../apps/app-field/src/features/field-operations/field-draft-readback.ts";

const rights = {
  creator: "  مصور المتجر ",
  sourceDescription: "  الصورة الأصلية  ",
  sourceUri: "HTTPS://example.test/photo",
  rightsStatement: "  موافقة صاحب الحق  ",
  rightsUri: "https://example.test/license",
  rightsAttested: true,
};
const stored = {
  uri: "https://media.example.test/store.jpg",
  contentSha256: "123abc",
  provenance: {
    creator: "مصور المتجر",
    sourceDescription: "الصورة الأصلية",
    sourceUri: "https://example.test/photo",
    rightsStatement: "موافقة صاحب الحق",
    rightsUri: "https://example.test/license",
    attestedByActorId: "field-1",
    attestedAt: "2026-10-13T12:00:00Z",
  },
};
const uploaded = { id: "case-1", origin: "field", version: 6, storeProfileImage: stored };
const canonical = { ...uploaded, version: 6 };
const confirmed = (first = uploaded, second = canonical, expected = rights, caseID = "case-1") =>
  fieldDraftMediaUploadConfirmed(first, second, "store", 5, caseID, expected);

test("exact Field case and persisted normalized image rights confirm upload", () => {
  assert.equal(confirmed(), true);
});

test("identical image bytes with different source, creator, rights or URI cannot confirm", () => {
  for (const mismatch of [
    { creator: "مصور مختلف" },
    { sourceDescription: "مصدر آخر" },
    { sourceUri: "https://example.test/other" },
    { rightsStatement: "ترخيص آخر" },
    { rightsUri: "https://example.test/other-license" },
    { rightsAttested: false },
  ]) {
    assert.equal(confirmed(uploaded, canonical, { ...rights, ...mismatch }), false, JSON.stringify(mismatch));
  }
});

test("wrong case, origin or insufficient version never confirms", () => {
  assert.equal(confirmed(uploaded, canonical, rights, "case-2"), false);
  assert.equal(confirmed({ ...uploaded, origin: "control_panel" }), false);
  assert.equal(confirmed(uploaded, { ...canonical, origin: "control_panel" }), false);
  assert.equal(confirmed({ ...uploaded, version: 5 }), false);
  assert.equal(confirmed(uploaded, { ...canonical, version: 5 }), false);
});

test("missing attestation, mismatched staff, or unrelated saved image fails closed", () => {
  assert.equal(confirmed(uploaded, { ...canonical, storeProfileImage: { ...stored, contentSha256: "wrong" } }), false);
  assert.equal(confirmed(uploaded, { ...canonical, storeProfileImage: { ...stored, provenance: null } }), false);
  assert.equal(confirmed(uploaded, { ...canonical, storeProfileImage: { ...stored, provenance: { ...stored.provenance, rightsStatement: "wrong" } } }), false);
  assert.equal(confirmed(uploaded, { ...canonical, storeProfileImage: { ...stored, provenance: { ...stored.provenance, attestedByActorId: "another-staff" } } }), false);
  assert.equal(confirmed(uploaded, { ...canonical, storeProfileImage: { ...stored, provenance: { ...stored.provenance, attestedAt: "" } } }), false);
  assert.equal(confirmed({ ...uploaded, storeProfileImage: { ...stored, provenance: null } }), false);
});
