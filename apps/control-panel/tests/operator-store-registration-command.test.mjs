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
