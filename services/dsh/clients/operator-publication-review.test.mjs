import assert from "node:assert/strict";
import { test } from "node:test";
import { isPublicationReviewPage, listOperatorStorePublicationReview } from "./operator-publication-review.ts";

const origin = "http://127.0.0.1:33222";
const bearer = Buffer.alloc(32, 7).toString("base64url");
const item = { id: "store-01", name: "Test Store", verticalId: "grocery", cityActive: true,
  verticalActive: true, locationRecorded: true, registrationTermsRecorded: true,
  weeklyHoursRecorded: false, catalogRecorded: false };
const page = { cityId: "sanaa", relation: "DIRECT", items: [item] };
test("publication review refuses unknown fields, approval claims and cross-scope rows", () => {
  assert.equal(isPublicationReviewPage(page, "sanaa", "DIRECT"), true);
  for (const value of [
    { ...page, relation: "MARKETPLACE" },
    { ...page, cityId: "aden" },
    { ...page, items: [item, item] },
    { ...page, items: [{ ...item, published: true }] },
    { ...page, items: [{ ...item, registrationTermsRecorded: "true" }] },
    { ...page, items: [{ ...item, ownerActorId: "private" }] },
    { ...page, nextCursor: "store-01" },
  ]) assert.equal(isPublicationReviewPage(value, "sanaa", "DIRECT"), false);
  assert.equal(isPublicationReviewPage(page, "sanaa", "DIRECT", "store-01"), false);
});
test("publication review reads only the current authorized DSH scope", async t => {
  const f = t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url.toString(), `${origin}/v1/operators/cities/sanaa/store-publication-review/DIRECT?after=store-00`);
    assert.equal(init.method, "GET");
    assert.equal(init.cache, "no-store");
    assert.equal(init.headers.Authorization, `Bearer ${bearer}`);
    return Response.json(page, { headers: { "Cache-Control": "no-store" } });
  });
  assert.deepEqual(await listOperatorStorePublicationReview(origin, "sanaa", "DIRECT", bearer, "store-00"), page);
  await assert.rejects(listOperatorStorePublicationReview(origin, "sanaa", "DIRECT", bearer, "../other"), { status: 400 });
  assert.equal(f.mock.callCount(), 1);
});
test("publication review fails closed on revoked operator access", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ code: "FORBIDDEN" }, { status: 403 }));
  await assert.rejects(listOperatorStorePublicationReview(origin, "sanaa", "DIRECT", bearer), { status: 403 });
});
