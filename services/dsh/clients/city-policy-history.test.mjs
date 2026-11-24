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

test("delivery policy SDK binds owner path, rejects foreign and malformed evidence", async t => {
  const { getCityDeliveryPolicy } = await import("./city-policies.ts");
  const good = { cityId:"sanaa", version:2, radiusMetres:30000, updatedAt:"2026-11-24T05:00:00Z" };
  let body = good;
  const fetch = t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(String(url), "http://127.0.0.1:3202/v1/operators/cities/sanaa/delivery-policy");
    assert.equal(init.method, "GET");
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "error");
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  });
  assert.deepEqual(await getCityDeliveryPolicy("http://127.0.0.1:3202","sanaa","test-token"),good);
  for (const bad of [{...good,cityId:"aden"}, {...good,version:0}, {...good,radiusMetres:-1}, {...good,updatedAt:"bad"}, {...good,unexpected:true}]) {
    body=bad;
    await assert.rejects(getCityDeliveryPolicy("http://127.0.0.1:3202","sanaa","test-token"));
  }
  const count=fetch.mock.callCount();
  await assert.rejects(getCityDeliveryPolicy("http://127.0.0.1:3202","../aden","test-token"));
  assert.equal(fetch.mock.callCount(),count);
});

test("delivery preview sends only scoped proposed inputs and refuses stale or payable responses", async t => {
  const { previewCityDeliveryPolicy, isCityDeliveryPolicy } = await import("./city-policies.ts");
  const input = { expectedVersion: 3, radiusMetres: 20000, distanceMetres: 2001,
    distanceBands: [{upToMeters:2000, ratePerKmMinor:300},{upToMeters:null, ratePerKmMinor:200}] };
  const good = {cityId:"sanaa",version:3,radiusMetres:20000,distanceMetres:2001,feeYer:"601",payable:false};
  const policy = {cityId:"sanaa",version:3,radiusMetres:20000,updatedAt:"2026-11-24T05:00:00Z",distanceBands:input.distanceBands};
  assert.ok(isCityDeliveryPolicy(policy,"sanaa"));
  assert.ok(!isCityDeliveryPolicy({...policy,distanceBands:[{upToMeters:null,ratePerKmMinor:0}]},"sanaa"));
  let response = good;
  const spy = t.mock.method(globalThis,"fetch",async (url, init) => {
    assert.equal(String(url), origin + "/v1/operators/cities/sanaa/delivery-policy/preview");
    assert.equal(init.method,"POST");
    assert.equal(init.headers.Authorization,"Bearer " + bearer);
    assert.deepEqual(JSON.parse(init.body),input);
    return Response.json(response,{headers:{"Cache-Control":"no-store"}});
  });
  assert.deepEqual(await previewCityDeliveryPolicy(origin,"sanaa",bearer,input),good);
  for(const bad of [{...good,version:2},{...good,cityId:"aden"},{...good,payable:true},{...good,radiusMetres:1},{...good,feeYer:"-1"}]){
    response=bad;
    await assert.rejects(previewCityDeliveryPolicy(origin,"sanaa",bearer,input),{status:502});
  }
  const calls=spy.mock.callCount();
  await assert.rejects(previewCityDeliveryPolicy(origin,"sanaa",bearer,{...input,distanceMetres:20001}),{status:400});
  await assert.rejects(previewCityDeliveryPolicy(origin,"sanaa",bearer,{...input,distanceBands:[{upToMeters:2000,ratePerKmMinor:300}]}),{status:400});
  assert.equal(spy.mock.callCount(),calls);
});
