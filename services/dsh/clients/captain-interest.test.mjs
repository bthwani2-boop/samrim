import assert from "node:assert/strict";
import { test } from "node:test";
import {listOperatorCaptainInterest,
  markOperatorCaptainInterestContacted,
  submitCaptainInterest, validCaptainInterest,
} from "./captain-interest.ts";

const origin = "http://127.0.0.1:33113";
const bearer = Buffer.alloc(32, 5).toString("base64url");
const candidate = {
  name: "محمد أحمد", phone: "771234567", city: "صنعاء", district: "التحرير",
  vehicleType: "MOTORCYCLE", plateRegistered: true, phoneType: "SMART", experienced: false,
};
const record = { ...candidate, id: 13, contacted: false, createdAt: "2026-11-23T00:00:00Z" };
const reply = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

test("guest Captain form only submits bounded contact information and never a role or session", async t => {
  const network = t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(String(url), origin + "/v1/captain-interest");
    assert.equal(init.method, "POST");
    assert.equal(init.credentials, "omit");
    assert.equal(init.cache, "no-store");
    assert.ok(!Object.hasOwn(init.headers, "Authorization"));
    assert.deepEqual(JSON.parse(init.body), candidate);
    return reply({ received: true }, 202);
  });
  assert.equal(await submitCaptainInterest(origin, candidate), undefined);
  assert.equal(network.mock.callCount(), 1);
});
test("guest input rejects unknown keys, malformed phone and excessive text before the network", async t => {
  const network = t.mock.method(globalThis, "fetch", async () => assert.fail("invalid data sent"));
  for (const invalid of [
    { ...candidate, phone: "123" },
    { ...candidate, status: "APPROVED" },
    { ...candidate, name: "x" },
    { ...candidate, vehicleType: "BICYCLE", plateRegistered: true },
  ]) {
    assert.equal(validCaptainInterest(invalid), false);
    await assert.rejects(submitCaptainInterest(origin, invalid), { code: "INVALID_REQUEST" });
  }
  assert.equal(network.mock.callCount(), 0);
});
test("only operations bearer may ask DSH for private candidate rows or flag contact", async t => {
  const calls = t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(init.headers.Authorization, "Bearer " + bearer);
    assert.equal(init.credentials, "omit");
    if (init.method === "GET") {
      assert.equal(String(url), origin + "/v1/operators/captain-interest?limit=20");
      return reply({ items: [record] });
    }
    assert.equal(init.method, "PATCH");
    assert.equal(String(url), origin + "/v1/operators/captain-interest/13/contact");
    assert.deepEqual(JSON.parse(init.body), { contacted: true });
    return reply({ ...record, contacted: true });
  });
  assert.deepEqual(await listOperatorCaptainInterest(origin, bearer), { items: [record] });
  assert.equal((await markOperatorCaptainInterestContacted(origin, bearer, 13)).contacted, true);
  assert.equal(calls.mock.callCount(), 2);
});
test("operator owner response cannot inject a false Captain role, contact or extra private data", async t => {
  t.mock.method(globalThis, "fetch", async () => reply({ items: [{ ...record, role: "captain" }] }));
  await assert.rejects(listOperatorCaptainInterest(origin, bearer), { code: "OWNER_RESPONSE_INVALID" });
});
