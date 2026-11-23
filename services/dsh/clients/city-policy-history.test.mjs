import assert from "node:assert/strict";
import { test } from "node:test";
import { isCityStoreOperationalPolicyHistoryPage, listCityStoreOperationalPolicyHistory } from "./city-policies.ts";

const origin = "http://127.0.0.1:33222";
const bearer = Buffer.alloc(32, 9).toString("base64url");
const policy = { cityId: "sanaa", version: 3, maxPauseSeconds: 900,
  maxPreparationMinutes: 40, changedByActor: "operator-a",
  changeReason: "Reviewed limits", updatedAt: "2026-11-23T12:00:00Z" };
const page = { cityId: "sanaa", entries: [policy, { ...policy, version: 2 }], nextBeforeVersion: "2" };

test("city history verifies city, descending versions, exact cursor and allowed fields", () => {
  assert.equal(isCityStoreOperationalPolicyHistoryPage(page, "sanaa", 2), true);
  assert.equal(isCityStoreOperationalPolicyHistoryPage(page, "sanaa", 2, "4"), true);
  for (const data of [
    { ...page, cityId: "aden" }, { ...page, nextBeforeVersion: "1" },
    { ...page, entries: [policy, policy] }, { ...page, entries: [{ ...policy, cityId: "aden" }] },
    { ...page, entries: [{ ...policy, maxPauseSeconds: -1 }] },
    { ...page, entries: [{ ...policy, ownerId: "unexpected" }] },
    { ...page, entries: [{ ...policy, version: Number.MAX_SAFE_INTEGER + 1 }] },
  ]) assert.equal(isCityStoreOperationalPolicyHistoryPage(data, "sanaa", 2), false);
  assert.equal(isCityStoreOperationalPolicyHistoryPage(page, "sanaa", 2, "3"), false);
  assert.equal(isCityStoreOperationalPolicyHistoryPage(page, "sanaa", 2, "9007199254740992"), false);
  assert.equal(isCityStoreOperationalPolicyHistoryPage({ cityId: "sanaa", entries: [] }, "sanaa", 2), true);
});

test("city history reads only the canonical scoped, authenticated GET", async t => {
  const spy = t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, origin + "/v1/operators/cities/sanaa/store-availability-policy/history?limit=2&beforeVersion=4");
    assert.equal(init.method, "GET");
    assert.equal(init.cache, "no-store");
    assert.equal(init.headers.Authorization, "Bearer " + bearer);
    return Response.json(page, { headers: { "Cache-Control": "no-store" } });
  });
  assert.deepEqual(await listCityStoreOperationalPolicyHistory(origin, "sanaa", bearer, 2, "4"), page);
  await assert.rejects(listCityStoreOperationalPolicyHistory(origin, "sanaa", bearer, 2, "9007199254740992"), { status: 400 });
  await assert.rejects(listCityStoreOperationalPolicyHistory(origin, "../aden", bearer), { status: 400 });
  assert.equal(spy.mock.callCount(), 1);
});

test("city history refuses mismatched owner responses and revoked permissions", async t => {
  const spy = t.mock.method(globalThis, "fetch", async () => Response.json({ ...page, cityId: "aden" }, { headers: { "Cache-Control": "no-store" } }));
  await assert.rejects(listCityStoreOperationalPolicyHistory(origin, "sanaa", bearer, 2), { status: 502 });
  spy.mock.mockImplementation(async () => Response.json({ code: "FORBIDDEN" }, { status: 403 }));
  await assert.rejects(listCityStoreOperationalPolicyHistory(origin, "sanaa", bearer, 2), { status: 403 });
});
