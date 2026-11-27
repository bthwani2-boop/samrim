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

test("malformed publication scopes never dispatch or validate by coercion", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json(page, { headers: { "Cache-Control": "no-store" } }));
  for (const [city, relation, after] of [
    [["sanaa"], "DIRECT", undefined],
    ["sanaa", "DIRECT", ["store-00"]],
    ["sanaa", "DIRECT", "store-00\n"],
    ["sanaa", "DIRECT", ""],
    ["sanaa", "UNKNOWN", undefined],
    ["", "DIRECT", undefined],
  ]) await assert.rejects(listOperatorStorePublicationReview(origin, city, relation, bearer, after), { status: 400 });
  await assert.rejects(listOperatorStorePublicationReview(origin, "sanaa", "DIRECT", [bearer]), { status: 401 });
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(isPublicationReviewPage({ ...page, cityId: "" }, "", "DIRECT"), false);
  assert.equal(isPublicationReviewPage({ ...page, relation: "UNKNOWN" }, "sanaa", "UNKNOWN"), false);
  assert.equal(isPublicationReviewPage(page, "sanaa", "DIRECT", ["store-00"]), false);
});

test("projection accepts Go-valid names and refuses malformed Unicode or identifiers", () => {
  for (const name of ["\uFEFF", "متجر", "😀".repeat(120)]) {
    assert.equal(isPublicationReviewPage({ ...page, items: [{ ...item, name }] }, "sanaa", "DIRECT"), true);
  }
  for (const name of ["\u0085", "\u0085hidden", "name\u0000", "\ud800", "😀".repeat(121)]) {
    assert.equal(isPublicationReviewPage({ ...page, items: [{ ...item, name }] }, "sanaa", "DIRECT"), false);
  }
  for (const bad of [{ ...item, id: "store-01\n" }, { ...item, verticalId: "grocery\n" }]) {
    assert.equal(isPublicationReviewPage({ ...page, items: [bad] }, "sanaa", "DIRECT"), false);
  }
});

test("page cursors identify the actual final row of a strictly ordered bounded page", async t => {
  const items = Array.from({ length: 20 }, (_, n) => ({ ...item, id: "store-" + String(n + 1).padStart(2, "0") }));
  const full = { ...page, items, nextCursor: "store-20" };
  assert.equal(isPublicationReviewPage(full, "sanaa", "DIRECT", "store-00"), true);
  assert.equal(isPublicationReviewPage({ ...full, nextCursor: "store-19" }, "sanaa", "DIRECT"), false);
  assert.equal(isPublicationReviewPage({ ...full, items: [...items, item] }, "sanaa", "DIRECT"), false);
  assert.equal(isPublicationReviewPage({ ...page, items: [] }, "sanaa", "DIRECT"), true);
  assert.equal(isPublicationReviewPage(null, "sanaa", "DIRECT"), false);
  assert.equal(isPublicationReviewPage({ ...page, items: [null] }, "sanaa", "DIRECT"), false);
  assert.equal(isPublicationReviewPage({ ...page, items: [Object.fromEntries(Object.entries(item).filter(([key]) => key !== "catalogRecorded"))] }, "sanaa", "DIRECT"), false);
  t.mock.method(globalThis, "fetch", async () => Response.json({ ...full, nextCursor: "store-19" }, { headers: { "Cache-Control": "no-store" } }));
  await assert.rejects(listOperatorStorePublicationReview(origin, "sanaa", "DIRECT", bearer), { code: "OWNER_RESPONSE_INVALID" });
});
