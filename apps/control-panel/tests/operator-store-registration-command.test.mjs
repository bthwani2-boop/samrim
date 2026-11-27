import assert from "node:assert/strict";
import { test } from "node:test";
import {
  matchesPendingPolicy,
  parseRegistrationPolicy, readStoreRegistrationPolicy, reconcileRegistrationPolicy,
} from "../src/features/policies/store-registration-command.ts";

const endpoint = "/api/policies/cities/sanaa/store-registration/MARKETPLACE";
const city = "sanaa", relation = "MARKETPLACE", actor = "operator-a";
const change = { operationId: "policy-test-001", expectedVersion: 0, enabled: true,
  termsVersion: "terms-v1", termsText: "Merchant consent", reason: "Reviewed admission policy" };
const policy = { cityId: city, relation, version: 1, enabled: true,
  termsVersion: change.termsVersion, termsText: change.termsText,
  changedByActor: actor, changeReason: change.reason, updatedAt: new Date().toISOString() };
const reply = (body, status = 200) => Response.json(body, { status });

test("Operator policy parser refuses optimistic or cross-city data", () => {
  assert.equal(parseRegistrationPolicy(policy, city, relation)?.version, 1);
  assert.equal(parseRegistrationPolicy({ ...policy, cityId: "other" }, city, relation), null);
  assert.equal(parseRegistrationPolicy({ ...policy, enabled: "true" }, city, relation), null);
  assert.equal(matchesPendingPolicy(policy, actor, change), true);
  assert.equal(matchesPendingPolicy({ ...policy, changedByActor: "other" }, actor, change), false);
});
test("Operator policy PATCH is confirmed only after DSH owner GET readback", async t => {
  const methods = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, endpoint);
    methods.push(init.method);
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.headers["X-BThwani-Operator"], actor);
    if (init.method === "PATCH") {
      assert.deepEqual(JSON.parse(init.body), change);
      return reply({ policy, replay: false });
    }
    return reply(policy);
  });
  assert.deepEqual(await reconcileRegistrationPolicy(endpoint, city, relation, actor, change),
    { status: "confirmed", current: policy, replay: false, superseded: false });
  assert.deepEqual(methods, ["PATCH", "GET"]);
});
test("Operator policy refuses a success body for another actor without readback", async t => {
  const calls = t.mock.method(globalThis, "fetch", async () =>
    reply({ policy: { ...policy, changedByActor: "another-operator" }, replay: false }));
  assert.deepEqual(await reconcileRegistrationPolicy(endpoint, city, relation, actor, change),
    { status: "unknown" });
  assert.equal(calls.mock.callCount(), 1);
});
test("Operator policy preserves original operation on unknown network outcome", async t => {
  const calls = t.mock.method(globalThis, "fetch", async () => { throw new Error("lost owner reply"); });
  assert.deepEqual(await reconcileRegistrationPolicy(endpoint, city, relation, actor, change),
    { status: "unknown" });
  assert.equal(calls.mock.callCount(), 1);
});
test("Operator policy distinguishes conflict, revoked permission, and bad inputs", async t => {
  let status = 409;
  t.mock.method(globalThis, "fetch", async () => reply({ code: "error" }, status));
  for (const [next, expected] of [[409, "conflict"], [401, "denied"], [403, "denied"], [400, "rejected"], [503, "unknown"]]) {
    status = next;
    assert.deepEqual(await reconcileRegistrationPolicy(endpoint, city, relation, actor, change),
      { status: expected });
  }
});
test("Operator policy GET requires current owner payload rather than local saved UI state", async t => {
  t.mock.method(globalThis, "fetch", async () => reply({ ...policy, relation: "DIRECT" }));
  await assert.rejects(readStoreRegistrationPolicy(endpoint, city, relation, actor),
    /owner response invalid/);
});
test("A stale DSH readback after confirmed PATCH remains uncertain", async t => {
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    if (init.method === "PATCH") {
      writes++;
      return reply({ policy, replay: true });
    }
    return reply({
      ...policy, version: 0, enabled: false,
      termsVersion: undefined, termsText: undefined, changedByActor: undefined,
      changeReason: undefined, updatedAt: undefined,
    });
  });
  assert.deepEqual(await reconcileRegistrationPolicy(endpoint, city, relation, actor, change),
    { status: "unknown" });
  assert.equal(writes, 1);
});

test("initial registration policy command survives reload, scoped to its operator", async () => {
  const { savePendingRegistrationPolicy, readPendingRegistrationPolicy, clearPendingRegistrationPolicy } =
    await import("../src/features/policies/store-registration-command.ts");
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  const pending = { cityId: city, relation, change };
  savePendingRegistrationPolicy(storage, actor, pending);
  assert.deepEqual(readPendingRegistrationPolicy(storage, actor), pending);
  assert.equal(readPendingRegistrationPolicy(storage, "operator-b"), null);
  assert.throws(() => savePendingRegistrationPolicy(storage, actor, { ...pending, change: { ...change, operationId: "different-op-001" } }));
  clearPendingRegistrationPolicy(storage, actor, pending);
  assert.equal(readPendingRegistrationPolicy(storage, actor), null);
  savePendingRegistrationPolicy(storage, actor, pending);
  const key = [...data.keys()][0];
  data.set(key, "{broken");
  assert.throws(() => readPendingRegistrationPolicy(storage, actor));
  assert.throws(() => savePendingRegistrationPolicy(storage, actor, pending));
});


test("registration command rejects wrong route and invalid actor before any network request", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => reply(policy));
  for (const path of ["https://example.invalid/policy", endpoint + "?history=1", endpoint + "/extra", endpoint.replace("sanaa", "aden"), endpoint.replace("MARKETPLACE", "DIRECT")]) {
    await assert.rejects(readStoreRegistrationPolicy(path, city, relation, actor), /scope/);
    assert.deepEqual(await reconcileRegistrationPolicy(path, city, relation, actor, change), { status: "rejected" });
  }
  await assert.rejects(readStoreRegistrationPolicy(endpoint, city, relation, ""), /scope/);
  assert.equal(fetch.mock.callCount(), 0);
});

test("registration history rejects integer overflow without contacting BFF", async t => {
  const { readRegistrationHistory } = await import("../src/features/policies/store-registration-command.ts");
  const fetch = t.mock.method(globalThis, "fetch", async () => reply({ entries: [] }));
  await assert.rejects(readRegistrationHistory(endpoint, city, relation, actor, "9223372036854775808"), /scope/);
  assert.equal(fetch.mock.callCount(), 0);
});

test("registration mutation cannot confirm a noncanonical write envelope", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async (_url, init) =>
    reply(init.method === "PATCH" ? { policy, replay: false, extra: "unexpected" } : policy));
  assert.deepEqual(await reconcileRegistrationPolicy(endpoint, city, relation, actor, change), { status: "unknown" });
  assert.equal(fetch.mock.callCount(), 1);
});

test("registration command refuses oversized or non-JSON successful response", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify(policy) + " ".repeat(65536), { headers: { "Content-Type": "application/json" } }));
  await assert.rejects(readStoreRegistrationPolicy(endpoint, city, relation, actor), /response invalid/);
  fetch.mock.restore();
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(policy), { headers: { "Content-Type": "text/plain" } }));
  await assert.rejects(readStoreRegistrationPolicy(endpoint, city, relation, actor), /response invalid/);
});


test("scope admission validates real actor and city values without coercion", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => reply(policy));
  for (const invalid of [123, "", " actor", "x".repeat(129), "actor\nname", "\ud800"]) {
    await assert.rejects(readStoreRegistrationPolicy(endpoint, city, relation, invalid), /scope/);
  }
  for (const [invalidCity, invalidRelation] of [[123, relation], ["../sanaa", relation], [city, "OTHER"]]) {
    await assert.rejects(readStoreRegistrationPolicy(endpoint, invalidCity, invalidRelation, actor), /scope/);
  }
  assert.deepEqual(await reconcileRegistrationPolicy(endpoint, city, relation, actor, { ...change, reason: "" }), { status: "rejected" });
  assert.equal(fetch.mock.callCount(), 0);
});

test("response admission cancels rejected body and handles an unavailable reader", async t => {
  let canceled = 0;
  const stream = new ReadableStream({ cancel() { canceled++; throw new Error("cancel failed"); } });
  let response = new Response(stream, { headers: { "Content-Type": "application/json", "Content-Length": "65537" } });
  t.mock.method(globalThis, "fetch", async () => response);
  await assert.rejects(readStoreRegistrationPolicy(endpoint, city, relation, actor), /response invalid/);
  assert.equal(canceled, 1);
  response = new Response(null, { headers: { "Content-Type": "application/json" } });
  await assert.rejects(readStoreRegistrationPolicy(endpoint, city, relation, actor), /response invalid/);
  response = reply(policy);
  const reader = response.body.getReader();
  await assert.rejects(readStoreRegistrationPolicy(endpoint, city, relation, actor), /response invalid/);
  reader.releaseLock();
  response = new Response("{", { headers: { "Content-Type": "application/json", "Content-Length": "invalid" } });
  await assert.rejects(readStoreRegistrationPolicy(endpoint, city, relation, actor), /response invalid/);
  response = new Response(Uint8Array.of(0xff), { headers: { "Content-Type": "application/json" } });
  await assert.rejects(readStoreRegistrationPolicy(endpoint, city, relation, actor), /response invalid/);
  assert.equal(response.body.locked, false);
});

test("audit accepts exclusive int64 cursor and rejects malformed page", async t => {
  const { readRegistrationHistory } = await import("../src/features/policies/store-registration-command.ts");
  const entries = [{ version: 1, enabled: true, termsVersion: "terms-v1", changedByActor: actor, changeReason: "Reviewed", updatedAt: policy.updatedAt }];
  let body = { entries };
  t.mock.method(globalThis, "fetch", async () => reply(body));
  assert.deepEqual(await readRegistrationHistory(endpoint, city, relation, actor, "9223372036854775807"), body);
  body = { entries: [null] };
  await assert.rejects(readRegistrationHistory(endpoint, city, relation, actor), /audit owner response invalid/);
});

test("recovery refuses invalid or mismatched pending data and retains the original command", async () => {
  const { savePendingRegistrationPolicy, readPendingRegistrationPolicy, clearPendingRegistrationPolicy } = await import("../src/features/policies/store-registration-command.ts");
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  const pending = { cityId: city, relation, change };
  assert.throws(() => clearPendingRegistrationPolicy(storage, actor, pending));
  assert.throws(() => savePendingRegistrationPolicy(storage, actor, { ...pending, relation: "OTHER" }));
  savePendingRegistrationPolicy(storage, actor, pending);
  savePendingRegistrationPolicy(storage, actor, pending);
  for (const different of [{ ...pending, cityId: "aden" }, { ...pending, relation: "DIRECT" }, ...Object.keys(change).map(key => ({ ...pending, change: { ...change, [key]: key === "enabled" ? false : key === "expectedVersion" ? 1 : "different-value" } }))]) {
    assert.throws(() => clearPendingRegistrationPolicy(storage, actor, different));
  }
  assert.deepEqual(readPendingRegistrationPolicy(storage, actor), pending);
  data.set([...data.keys()][0], JSON.stringify({ ...pending, extra: true }));
  assert.throws(() => readPendingRegistrationPolicy(storage, actor), /Invalid pending/);
});

test("mutation cannot confirm unexpected response status or malformed envelope", async t => {
  let response = reply({ policy, replay: true }, 201);
  t.mock.method(globalThis, "fetch", async () => response);
  assert.deepEqual(await reconcileRegistrationPolicy(endpoint, city, relation, actor, change), { status: "unknown" });
  for (const body of [null, [], { policy, replay: "yes" }, { policy: null, replay: true }]) {
    response = reply(body);
    assert.deepEqual(await reconcileRegistrationPolicy(endpoint, city, relation, actor, change), { status: "unknown" });
  }
});
