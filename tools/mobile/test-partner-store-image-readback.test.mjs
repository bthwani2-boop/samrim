import assert from "node:assert/strict";
import { test } from "node:test";

import { partnerStoreImageReadbackMatches } from "../../apps/app-partner/src/features/partner-onboarding/store-profile-image-readback.ts";

const provenance = {
  creator: "  المصور المعتمد  ",
  sourceDescription: "  تصوير أصلي  ",
  sourceUri: "HTTPS://example.test/source",
  rightsStatement: "  أملك حقوق الصورة  ",
  rightsUri: "https://example.test/license",
  rightsAttested: true,
};
const expected = {
  caseID: "case-1",
  partnerActorID: "partner-1",
  contentSha256: "abc123",
  provenance,
};
const current = {
  id: "case-1",
  partnerActorId: "partner-1",
  storeProfileImage: {
    uri: "https://cdn.example.test/logo.jpg",
    contentSha256: "abc123",
    provenance: {
      creator: "المصور المعتمد",
      sourceDescription: "تصوير أصلي",
      sourceUri: "https://example.test/source",
      rightsStatement: "أملك حقوق الصورة",
      rightsUri: "https://example.test/license",
      attestedByActorId: "partner-1",
      attestedAt: "2026-10-13T12:00:00Z",
    },
  },
};

test("unchanged image and attested rights may be reused without an upload", () => {
  assert.equal(partnerStoreImageReadbackMatches(current, expected), true);
});

test("same image with corrected rights or source is NOT confirmed by a matching hash", () => {
  assert.equal(partnerStoreImageReadbackMatches(current, { ...expected, provenance: { ...provenance, rightsStatement: "ترخيص مختلف" } }), false);
  assert.equal(partnerStoreImageReadbackMatches(current, { ...expected, provenance: { ...provenance, sourceDescription: "صورة مرخصة" } }), false);
  assert.equal(partnerStoreImageReadbackMatches(current, { ...expected, provenance: { ...provenance, rightsUri: "https://example.test/other" } }), false);
  assert.equal(partnerStoreImageReadbackMatches(current, { ...expected, provenance: { ...provenance, sourceUri: "https://example.test/other-source" } }), false);
  assert.equal(partnerStoreImageReadbackMatches(current, { ...expected, provenance: { ...provenance, creator: "مصور آخر" } }), false);
});

test("wrong joining case, partner, attester, missing rights or changed image never confirm", () => {
  assert.equal(partnerStoreImageReadbackMatches({ ...current, id: "other" }, expected), false);
  assert.equal(partnerStoreImageReadbackMatches({ ...current, partnerActorId: "other" }, expected), false);
  assert.equal(partnerStoreImageReadbackMatches(current, { ...expected, partnerActorID: "other" }), false);
  assert.equal(partnerStoreImageReadbackMatches(current, { ...expected, contentSha256: "different" }), false);
  assert.equal(partnerStoreImageReadbackMatches(current, { ...expected, provenance: { ...provenance, rightsAttested: false } }), false);
  assert.equal(partnerStoreImageReadbackMatches({ ...current, storeProfileImage: { ...current.storeProfileImage, uri: "" } }, expected), false);
  assert.equal(partnerStoreImageReadbackMatches({ ...current, storeProfileImage: { ...current.storeProfileImage, provenance: null } }, expected), false);
  assert.equal(partnerStoreImageReadbackMatches({ ...current, storeProfileImage: { ...current.storeProfileImage, provenance: { ...current.storeProfileImage.provenance, attestedByActorId: "other" } } }, expected), false);
  assert.equal(partnerStoreImageReadbackMatches({ ...current, storeProfileImage: { ...current.storeProfileImage, provenance: { ...current.storeProfileImage.provenance, attestedAt: "" } } }, expected), false);
});
