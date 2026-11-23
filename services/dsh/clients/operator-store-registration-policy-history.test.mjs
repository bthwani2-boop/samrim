import assert from "node:assert/strict";
import { test } from "node:test";
import { DshPublicError } from "./client-core.ts";
import {
  isStoreRegistrationPolicyHistoryPage, listOperatorStoreRegistrationPolicyHistory,
} from "./operator-store-registration-policy-history.ts";

const origin = "http://127.0.0.1:33222";
const bearer = Buffer.alloc(32, 8).toString("base64url");
const row = (version, enabled = true) => ({
  version, enabled, termsVersion: "merchant-terms-v1",
  changedByActor: "operator-a", changeReason: "Reviewed policy change",
  updatedAt: "2026-11-23T10:00:00Z",
});
const page = { entries: [row(3), row(2, false)], nextBeforeVersion: "2" };
const validOwnerReply = body => Response.json(body, {
  headers: { "Cache-Control": "no-store" },
});

test("history schema accepts bounded descending immutable audit and cursor", () => {
  assert.equal(isStoreRegistrationPolicyHistoryPage(page, 2), true);
  assert.equal(isStoreRegistrationPolicyHistoryPage({ entries: [] }), true);
  for (const bad of [
    { entries: [row(2), row(3)] }, { entries: [row(2), row(2)] },
    { entries: [row(2), { ...row(1), token: "leak" }] },
    { entries: [row(2), { ...row(1), version: "1" }] },
    { entries: [row(2), { ...row(1), changedByActor: "" }] },
    { entries: [row(2), { ...row(1), updatedAt: "yesterday" }] },
    { entries: [row(2)], nextBeforeVersion: "3" },
    { entries: [row(2)], nextBeforeVersion: "2", admin: true },
    { entries: [], nextBeforeVersion: "1" },
    { entries: "not-an-array" },
    { entries: [row(1), row(2)] },
  ]) assert.equal(isStoreRegistrationPolicyHistoryPage(bad, 2), false, JSON.stringify(bad));
});

test("history SDK builds exact read-only route, bearer and bounded keyset", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url.toString(),
      origin + "/v1/operators/cities/sanaa/store-registration-policy/DIRECT/history?limit=2&beforeVersion=4");
    assert.equal(init.method, "GET");
    assert.equal(init.headers.Authorization, "Bearer " + bearer);
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    assert.equal(init.body, undefined);
    return validOwnerReply(page);
  });
  assert.deepEqual(await listOperatorStoreRegistrationPolicyHistory(
    origin, "sanaa", "DIRECT", bearer, 2, "4",
  ), page);
  assert.equal(fetch.mock.callCount(), 1);
});

test("history SDK fails before fetch for invalid actor, city, relation, limit or cursor", async t => {
  const fetch = t.mock.method(globalThis, "fetch", () => assert.fail("must not call DSH"));
  for (const args of [
    [origin, "../sanaa", "DIRECT", bearer, 2],
    [origin, "sanaa", "OTHER", bearer, 2],
    [origin, "sanaa", "DIRECT", "invalid", 2],
    [origin, "sanaa", "DIRECT", bearer, 0],
    [origin, "sanaa", "DIRECT", bearer, 51],
    [origin, "sanaa", "DIRECT", bearer, 2, "../1"],
    [origin, "sanaa", "DIRECT", bearer, 2, "00"],
  ]) await assert.rejects(listOperatorStoreRegistrationPolicyHistory(...args), DshPublicError);
  assert.equal(fetch.mock.callCount(), 0);
});

test("history SDK does not accept a forged or cacheable owner reply", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => validOwnerReply({
    entries: [{ ...row(1), ownerToken: "forged" }],
  }));
  await assert.rejects(listOperatorStoreRegistrationPolicyHistory(origin, "sanaa", "DIRECT", bearer),
    { code: "OWNER_RESPONSE_INVALID" });
  fetch.mock.restore();
  t.mock.method(globalThis, "fetch", async () => Response.json({ entries: [row(1)] }));
  await assert.rejects(listOperatorStoreRegistrationPolicyHistory(origin, "sanaa", "DIRECT", bearer),
    { code: "OWNER_RESPONSE_INVALID" });
});

test("history SDK propagates denied read without claiming a valid audit page", async t => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ code: "FORBIDDEN" }, { status: 403 }));
  await assert.rejects(listOperatorStoreRegistrationPolicyHistory(origin, "sanaa", "MARKETPLACE", bearer),
    { status: 403 });
});
