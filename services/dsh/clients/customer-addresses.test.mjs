import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateDeliveryServiceability, getCustomerAddress, isCustomerAddressId,
  listCustomerAddresses, parseCustomerAddress, parseCustomerAddressPage,
  parseCustomerAddressResult, parseDeliveryServiceability, saveCustomerAddress,
  validCustomerAddressChange,
} from "./customer-addresses.ts";

const bearer = Buffer.alloc(32, 14).toString("base64url");
const origin = "http://127.0.0.1:3202";
const actor = "customer-a";
const id = "addr-00000000000000000000000000000001";
const otherId = "addr-00000000000000000000000000000002";
const change = { cityId: "sanaa", label: "بيت", details: "عنوان اصطناعي", latitude: 15.3, longitude: 44.2, expectedVersion: 0 };
const { expectedVersion: _version, ...fields } = change;
const address = { id, ...fields, version: 1 };
const page = { actorId: actor, items: [address] };
const receipt = { actorId: actor, address, replay: false };
const read = { actorId: actor, address };
const json = data => Response.json(data, { headers: { "Cache-Control": "no-store" } });
const invalid = { code: "OWNER_RESPONSE_INVALID" };
const unknown = { code: "OPERATION_RESULT_UNKNOWN" };

test("generated address routes bind bearer, omit cookies and dispatch exact data", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push([url.toString(), init.method, init.credentials]);
    assert.equal(init.headers.Authorization, "Bearer " + bearer);
    if (init.method === "PUT") {
      assert.deepEqual(JSON.parse(init.body), change);
      return json(receipt);
    }
    return json(url.endsWith(id) ? read : page);
  });
  assert.deepEqual(await listCustomerAddresses(origin, bearer, actor), page);
  assert.deepEqual(await getCustomerAddress(origin, bearer, actor, id), read);
  assert.deepEqual(await saveCustomerAddress(origin, bearer, actor, id, change), receipt);
  assert.deepEqual(calls, [
    [origin + "/v1/addresses", "GET", "omit"],
    [origin + "/v1/addresses/" + id, "GET", "omit"],
    [origin + "/v1/addresses/" + id, "PUT", "omit"],
  ]);
});

test("address reads require canonical owner fields, actor, version, resource and cursor", () => {
  assert.deepEqual(parseCustomerAddress(read, actor, id), read);
  assert.deepEqual(parseCustomerAddressPage(page, actor), page);
  for (const bad of [
    { ...read, actorId: "customer-b" }, { ...read, replay: false },
    ...[{ id: otherId }, { latitude: 91 }, { version: 0 }, { label: " بيت " }, { details: "\u0085" }].map(v => ({ ...read, address: { ...address, ...v } })),
  ]) assert.throws(() => parseCustomerAddress(bad, actor, id), invalid);
  for (const bad of [
    { ...page, actorId: "customer-b" }, { ...page, items: [address, address] },
    { ...page, items: [{ ...address, longitude: 181 }] },
    { ...page, items: [{ ...address, recipientPhone: "private" }] },
    { ...page, nextCursor: id }, { ...page, nextCursor: undefined },
    { ...page, items: [{ ...address, label: " بيت " }] },
  ]) assert.throws(() => parseCustomerAddressPage(bad, actor), invalid);
  assert.throws(() => parseCustomerAddressPage(page, actor, id), invalid);
  const items = Array.from({ length: 20 }, (_, i) => ({ ...address, id: "addr-" + (i + 1).toString(16).padStart(32, "0") }));
  const full = { actorId: actor, items, nextCursor: items.at(-1).id };
  assert.deepEqual(parseCustomerAddressPage(full, actor), full);
  assert.throws(() => parseCustomerAddressPage({ ...full, nextCursor: id }, actor), invalid);
});

test("receipt binds normalized submitted fields, version, actor and resource", () => {
  assert.deepEqual(parseCustomerAddressResult(receipt, actor, id, change), receipt);
  assert.deepEqual(parseCustomerAddressResult({ ...receipt, replay: true }, actor, id, change), { ...receipt, replay: true });
  for (const bad of [
    { ...receipt, actorId: "customer-b" }, { ...receipt, replay: 1 },
    ...[{ id: otherId }, { version: 2 }, { label: "changed" }, { cityId: "aden" }, { latitude: 0 }, { longitude: 0 }, { details: "changed" }].map(v => ({ ...receipt, address: { ...address, ...v } })),
  ]) assert.throws(() => parseCustomerAddressResult(bad, actor, id, change), unknown);
});

test("normalization follows Go White_Space, preserving BOM and rejecting blank normalized values", async t => {
  const submitted = { ...change, label: "\u0085بيت\u0085", details: "\ufeffعنوان" };
  const normalized = { ...submitted, label: "بيت" };
  const saved = { ...receipt, address: { ...address, label: normalized.label, details: normalized.details } };
  assert.equal(validCustomerAddressChange(submitted), true);
  assert.equal(validCustomerAddressChange({ ...change, label: "\ufeff" }), true);
  assert.equal(validCustomerAddressChange({ ...change, label: "\u0085" }), false);
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), normalized);
    return json(saved);
  });
  assert.deepEqual(await saveCustomerAddress(origin, bearer, actor, id, submitted), saved);
  assert.deepEqual(parseCustomerAddressResult(saved, actor, id, submitted), saved);
});

test("receipt is bound to dispatched immutable snapshot even when caller changes its draft", async t => {
  const draft = { ...change };
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), change);
    draft.label = "new draft";
    draft.expectedVersion = 42;
    return json(receipt);
  });
  assert.deepEqual(await saveCustomerAddress(origin, bearer, actor, id, draft), receipt);
});

test("invalid inputs fail before dispatch; lost acknowledgement remains unknown", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("lost acknowledgement"); });
  for (const v of [
    null, { ...change, latitude: NaN }, { ...change, longitude: 181 },
    { ...change, expectedVersion: -1 }, { ...change, expectedVersion: Number.MAX_SAFE_INTEGER },
    { ...change, actorId: "customer-b" }, { ...change, label: "\u0000" },
    { ...change, label: "\ud800" }, { ...change, label: "x".repeat(81) },
    { ...change, details: "x".repeat(301) }, { ...change, cityId: "sanaa\n" },
  ]) await assert.rejects(saveCustomerAddress(origin, bearer, actor, id, v), { code: "INVALID_REQUEST" });
  assert.equal(isCustomerAddressId(id + "\n"), false);
  await assert.rejects(getCustomerAddress(origin, bearer, actor, "invalid"), { code: "INVALID_REQUEST" });
  await assert.rejects(listCustomerAddresses(origin, bearer, actor, "invalid"), { code: "INVALID_REQUEST" });
  await assert.rejects(listCustomerAddresses(origin, "invalid", actor), { code: "UNAUTHENTICATED" });
  assert.equal(calls, 0);
  await assert.rejects(saveCustomerAddress(origin, bearer, actor, id, change), unknown);
  assert.equal(calls, 1);
});

test("serviceability binds geographic evidence and exact owner route", async t => {
  const value = { actorId: actor, storeId: "store-a", addressId: id, status: "SERVICEABLE", evidence: {
    storeCityId: "sanaa", addressCityId: "sanaa", addressVersion: 1, policyVersion: 2, radiusMetres: 30000, distanceMetres: 30000,
  } };
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (input, init) => {
    calls++;
    assert.equal(input.toString(), origin + "/v1/carts/store-a/serviceability?addressId=" + id);
    assert.equal(init.method, "GET");
    assert.equal(init.credentials, "omit");
    return json(value);
  });
  assert.deepEqual(await evaluateDeliveryServiceability(origin, bearer, actor, "store-a", id), value);
  for (const bad of [
    { ...value, actorId: "customer-b" }, { ...value, addressId: otherId }, { ...value, storeId: "store-b" },
    { ...value, status: "UNAVAILABLE" }, { ...value, status: "UNSERVICEABLE" },
    ...[{ distanceMetres: 30001 }, { addressCityId: "aden" }, { latitude: 15.3 }, { policyVersion: 0 }, { distanceMetres: -1 }, { radiusMetres: 2147483648 }].map(v => ({ ...value, evidence: { ...value.evidence, ...v } })),
  ]) assert.throws(() => parseDeliveryServiceability(bad, actor, "store-a", id), invalid);
  const unavailable = { actorId: actor, storeId: "store-a", addressId: id, status: "UNAVAILABLE" };
  assert.deepEqual(parseDeliveryServiceability(unavailable, actor, "store-a", id), unavailable);
  const outside = { ...value, status: "UNSERVICEABLE", evidence: { ...value.evidence, distanceMetres: 30001 } };
  assert.deepEqual(parseDeliveryServiceability(outside, actor, "store-a", id), outside);
  await assert.rejects(evaluateDeliveryServiceability(origin, bearer, actor, "store-a", "invalid"), { code: "INVALID_REQUEST" });
  assert.equal(calls, 1);
});
