import assert from "node:assert/strict";
import { test } from "node:test";
import { changeOperatorStoreRegistrationPolicy, getOperatorStoreRegistrationPolicy,
  isOperatorStoreRegistrationPolicy, validOperatorStoreRegistrationChange,
} from "./operator-store-registration-policy.ts";

const origin = "http://127.0.0.1:33222";
const bearer = Buffer.alloc(32, 8).toString("base64url");
const city = "sanaa";
const relation = "MARKETPLACE";
const path = "/v1/operators/cities/sanaa/store-registration-policy/MARKETPLACE";
const change = {
  operationId: "admission-policy-001", expectedVersion: 0, enabled: true,
  termsVersion: "merchant-terms-v1",
  termsText: "Isolated Merchant consent, no financial authorization.",
  reason: "Reviewed Operator policy decision",
};
const empty = { cityId: city, relation, version: 0, enabled: false };
const policy = {
  cityId: city, relation, version: 1, enabled: true,
  termsVersion: change.termsVersion, termsText: change.termsText,
  changedByActor: "operator-one", changeReason: change.reason,
  updatedAt: "2026-11-22T00:00:00Z",
};
const owner = (body, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store" },
});

test("Store registration policy is an exact DSH snapshot, including explicit disabled default", () => {
  assert.equal(isOperatorStoreRegistrationPolicy(empty, city, relation), true);
  assert.equal(isOperatorStoreRegistrationPolicy(policy, city, relation), true);
  assert.equal(isOperatorStoreRegistrationPolicy({ ...policy, changeReason: "" }, city, relation), false);
  for (const invalid of [
    { ...empty, enabled: true },
    { ...empty, changedByActor: "operator" },
    { ...policy, enabled: "true" },
    { ...policy, relation: "DIRECT" },
    { ...policy, updatedAt: "tomorrow" },
    { ...policy, termsText: "" },
    { ...policy, unexpected: "grants" },
    { ...policy, changedByActor: "" },
  ]) assert.equal(isOperatorStoreRegistrationPolicy(invalid, city, relation), false);
});
test("Operator policy changes refuse unverifiable terms, stale versions and extra grants", () => {
  assert.equal(validOperatorStoreRegistrationChange(change), true);
  for (const invalid of [
    { ...change, operationId: "short" },
    { ...change, expectedVersion: -1 },
    { ...change, enabled: "true" },
    { ...change, termsVersion: "../other" },
    { ...change, termsText: "" },
    { ...change, reason: "\u0001" },
    { ...change, extra: "OWNER_ADMIN" },
  ]) assert.equal(validOperatorStoreRegistrationChange(invalid), false);
});
test("Operator policy GET sends current bearer only to the DSH-owned scoped URL", async t => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url.toString(), origin + path);
    assert.equal(init.method, "GET");
    assert.equal(init.headers.Authorization, "Bearer " + bearer);
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    assert.equal(init.body, undefined);
    return owner(empty);
  });
  assert.deepEqual(await getOperatorStoreRegistrationPolicy(origin, city, relation, bearer), empty);
});
test("Operator policy PATCH verifies DSH's versioned committed response", async t => {
  const calls = t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url.toString(), origin + path);
    assert.equal(init.method, "PATCH");
    assert.equal(init.headers.Authorization, "Bearer " + bearer);
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    assert.deepEqual(JSON.parse(init.body), change);
    return owner({ policy, replay: false });
  });
  assert.deepEqual(await changeOperatorStoreRegistrationPolicy(origin, city, relation, bearer, change),
    { policy, replay: false });
  assert.equal(calls.mock.callCount(), 1);
});
test("Operator policy PATCH refuses forged policy versions and invented actor privileges", async t => {
  t.mock.method(globalThis, "fetch", async () => owner({ policy: { ...policy, version: 2 }, replay: false }));
  await assert.rejects(changeOperatorStoreRegistrationPolicy(origin, city, relation, bearer, change),
    { code: "OPERATION_RESULT_UNKNOWN" });
});
test("Operator policy PATCH returns uncertainty for a lost owner response without auto-retrying", async t => {
  const calls = t.mock.method(globalThis, "fetch", async () => { throw Error("network lost after commit"); });
  await assert.rejects(changeOperatorStoreRegistrationPolicy(origin, city, relation, bearer, change),
    { code: "OPERATION_RESULT_UNKNOWN" });
  assert.equal(calls.mock.callCount(), 1);
});
test("Operator policy SDK fails closed for invalid credentials, city, relation or DSH scope", async t => {
  const calls = t.mock.method(globalThis, "fetch", async () => { assert.fail("unsafe outbound fetch"); });
  await assert.rejects(getOperatorStoreRegistrationPolicy(origin, "../city", relation, bearer),
    { code: "INVALID_STORE_REGISTRATION" });
  await assert.rejects(getOperatorStoreRegistrationPolicy(origin, city, "PARTNER", bearer),
    { code: "INVALID_STORE_REGISTRATION" });
  await assert.rejects(getOperatorStoreRegistrationPolicy(origin, city, relation, "bad"),
    { code: "UNAUTHENTICATED" });
  await assert.rejects(changeOperatorStoreRegistrationPolicy(origin, city, relation, bearer,
    { ...change, extra: "scope" }), { code: "INVALID_STORE_REGISTRATION" });
  assert.equal(calls.mock.callCount(), 0);
});
test("Operator policy owner refusal propagates permission denial without creating a policy", async t => {
  t.mock.method(globalThis, "fetch", async () => owner({ code: "STORE_OPERATION_FORBIDDEN" }, 403));
  await assert.rejects(changeOperatorStoreRegistrationPolicy(origin, city, relation, bearer, change),
    { status: 403 });
});

test("retained owner policy without the omitted legacy reason remains readable", async t => {
  const { changeReason, ...retained } = policy;
  assert.equal(isOperatorStoreRegistrationPolicy(retained, city, relation), true);
  t.mock.method(globalThis, "fetch", async () => owner(retained));
  assert.deepEqual(await getOperatorStoreRegistrationPolicy(origin, city, relation, bearer), retained);
});
test("policy wire admission rejects unsafe versions, invalid Unicode, and malformed scope", async t => {
  for (const invalid of [
    { ...change, expectedVersion: Number.MAX_SAFE_INTEGER },
    { ...change, reason: "valid\u0085invalid" },
    { ...change, reason: "\u0085" },
    { ...change, termsText: "\ud800" },
    { ...change, reason: "\udfff" },
  ]) assert.equal(validOperatorStoreRegistrationChange(invalid), false);
  for (const invalid of [
    { ...policy, changedByActor: " operator" },
    { ...policy, changedByActor: "é".repeat(65) },
    { ...policy, changedByActor: "operator\u0085a" },
    { ...policy, termsText: "invalid\u0000terms" },
    { ...policy, changeReason: "invalid\u0085reason" },
  ]) assert.equal(isOperatorStoreRegistrationPolicy(invalid, city, relation), false);
  const calls = t.mock.method(globalThis, "fetch", async () => assert.fail("no unsafe fetch"));
  await assert.rejects(getOperatorStoreRegistrationPolicy(origin, ["sanaa"], relation, bearer), { code: "INVALID_STORE_REGISTRATION" });
  await assert.rejects(getOperatorStoreRegistrationPolicy(origin, city, relation, [bearer]), { code: "UNAUTHENTICATED" });
  assert.equal(calls.mock.callCount(), 0);
});
test("owner-normalized committed policy accepts Go Unicode whitespace and preserves BOM", async t => {
  const requested = { ...change, termsText: "\u0085\uFEFFterms\u0085", reason: "\u0085Reviewed\u0085" };
  const committed = { ...policy, termsText: "\uFEFFterms", changeReason: "Reviewed" };
  assert.equal(validOperatorStoreRegistrationChange(requested), true);
  const calls = t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), requested);
    return owner({ policy: committed, replay: true });
  });
  assert.deepEqual(await changeOperatorStoreRegistrationPolicy(origin, city, relation, bearer, requested),
    { policy: committed, replay: true });
  assert.equal(calls.mock.callCount(), 1);
});

test("GET fails closed on a forged snapshot; a retained read cannot confirm a write", async t => {
  const { changeReason, ...retained } = policy;
  let reply = owner({ ...policy, cityId: "other" });
  t.mock.method(globalThis, "fetch", async () => reply);
  await assert.rejects(getOperatorStoreRegistrationPolicy(origin, city, relation, bearer),
    { code: "OWNER_RESPONSE_INVALID" });
  reply = owner({ policy: retained, replay: true });
  await assert.rejects(changeOperatorStoreRegistrationPolicy(origin, city, relation, bearer, change),
    { code: "OPERATION_RESULT_UNKNOWN" });
});
