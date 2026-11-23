import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseMerchantRegistrationOptions, parseMerchantRegistrationResult,
  readMerchantRegistrationOptions, registerMerchantStore, validMerchantStoreRegistration,
} from "./merchant-registration.ts";

const bearer = Buffer.alloc(32, 7).toString("base64url");
const dsh = "http://127.0.0.1:33222";
const opts = { choices: [{
  cityId: "sanaa", relation: "MARKETPLACE", policyVersion: 1,
  termsVersion: "merchant-terms-v1", termsText: "Isolated registration terms, no publication.",
}], verticals: ["grocery"] };
const request = { operationId: "register-store-001", name: "Store One", cityId: "sanaa",
  relation: "MARKETPLACE", verticalId: "grocery", latitude: 15.3694,
  longitude: 44.191, policyVersion: 1, termsVersion: "merchant-terms-v1", acceptedTerms: true };
const store = { id: "store-11111111111111111111111111111111", name: "Store One",
  relation: "MARKETPLACE", published: false };
const response = (v, status = 200) => Response.json(v, { status, headers: { "Cache-Control": "no-store" } });

test("Registration options accept only exact, bounded DSH policy and displayed terms", () => {
  assert.deepEqual(parseMerchantRegistrationOptions(opts), opts);
  for (const invalid of [
    { ...opts, choices: [{ ...opts.choices[0], termsText: "" }] },
    { ...opts, choices: [{ ...opts.choices[0], termsVersion: "../x" }] },
    { ...opts, choices: [{ ...opts.choices[0], policyVersion: 0 }] },
    { ...opts, choices: [...opts.choices, ...opts.choices] },
    { ...opts, verticals: ["grocery", "grocery"] },
    { ...opts, additional: "private" },
  ]) assert.throws(() => parseMerchantRegistrationOptions(invalid), { code: "OWNER_RESPONSE_INVALID" });
});
test("Registration accepts an unpublished DSH result and validates the exact envelope", () => {
  assert.deepEqual(parseMerchantRegistrationResult({ store, replay: false }), { store, replay: false });
  for (const invalid of [
    { store: { ...store, published: "false" }, replay: false },
    { store: { ...store, id: "../other" }, replay: false },
    { store, replay: "false" },
    { store, replay: false, ownerActorId: "forged" },
  ]) assert.throws(() => parseMerchantRegistrationResult(invalid), { code: "OPERATION_RESULT_UNKNOWN" });
});
test("Client-side registration fails closed for missing proof, location, or current terms", () => {
  assert.equal(validMerchantStoreRegistration(request), true);
  for (const invalid of [
    { ...request, operationId: "bad" }, { ...request, latitude: Number.NaN },
    { ...request, longitude: 182 }, { ...request, acceptedTerms: false },
    { ...request, termsVersion: "" }, { ...request, cityId: "../sanaa" },
  ]) assert.equal(validMerchantStoreRegistration(invalid), false);
});
test("Owner SDK options never put bearer or actor in URLs, cookies or bodies", async t => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(String(url), dsh + "/v1/stores/registration-options");
    assert.equal(init.method, "GET");
    assert.equal(init.headers.Authorization, "Bearer " + bearer);
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    assert.equal(init.body, undefined);
    return response(opts);
  });
  assert.deepEqual(await readMerchantRegistrationOptions(dsh, bearer), opts);
});
test("Owner SDK registration sends the exactly scoped, single-use Store command", async t => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(String(url), dsh + "/v1/stores");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.Authorization, "Bearer " + bearer);
    assert.equal(init.credentials, "omit");
    assert.deepEqual(JSON.parse(init.body), request);
    return response({ store, replay: false }, 201);
  });
  assert.deepEqual(await registerMerchantStore(dsh, bearer, request), { store, replay: false });
});
test("Owner SDK rejects forged publication and response-status mismatches after a write", async t => {
  t.mock.method(globalThis, "fetch", async () => response({ store: { ...store, published: true }, replay: false }, 201));
  await assert.rejects(registerMerchantStore(dsh, bearer, request), { code: "OPERATION_RESULT_UNKNOWN" });
});
test("Owner SDK exposes unknown commit outcome and never retries with a new key", async t => {
  const calls = t.mock.method(globalThis, "fetch", async () => { throw Error("network lost after Store commit"); });
  await assert.rejects(registerMerchantStore(dsh, bearer, request), { code: "OPERATION_RESULT_UNKNOWN" });
  assert.equal(calls.mock.callCount(), 1);
});
test("Owner SDK blocks untrusted DSH base and invalid Merchant bearer before any network call", async t => {
  const calls = t.mock.method(globalThis, "fetch", async () => { assert.fail("unsafe network call"); });
  await assert.rejects(readMerchantRegistrationOptions(dsh, "not-a-bearer"), { code: "UNAUTHENTICATED" });
  await assert.rejects(registerMerchantStore("http://evil.example", bearer, request), { code: "DSH_ENDPOINT_UNSAFE" });
  assert.equal(calls.mock.callCount(), 0);
});
