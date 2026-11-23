import assert from "node:assert/strict";
import test from "node:test";
import { findWorkspaceEntry } from "../navigation/workspace-registry.ts";
import { canShowNavigation } from "../session/operator-permissions.ts";
import { reconcileCityPolicy } from "./city-policy-command.ts";
import { readRegistrationHistory, readRegistrationOverview } from "./store-registration-command.ts";

test("policies: routes have the expected navigation permission boundary", () => {
  for (const path of ["/policies","/policies/stage-sla"]) {
    assert.equal(findWorkspaceEntry(path)?.permission ?? null, "platform_policies");
  }
});

test("policies: unauthenticated or unmapped sessions never expose navigation", () => {
  assert.equal(canShowNavigation(false, ["operations", "finance", "platform_policies"], "platform_policies"), false);
  assert.equal(canShowNavigation(true, [], "platform_policies"), false);
});

const endpoint = "/api/policies/cities/sanaa";
const actorId = "operator-1";
const change = {
  operationId: "city-policy-001",
  expectedVersion: 1,
  maxPauseSeconds: 600,
  maxPreparationMinutes: 20,
  reason: "Scheduled synthetic review",
};
const committed = {
  cityId: "sanaa", version: 2, maxPauseSeconds: 600, maxPreparationMinutes: 20,
  changedByActor: "operator-1", changeReason: change.reason, updatedAt: "2026-11-19T05:00:00Z",
};

test("a lost PATCH reply keeps the command uncertain and reconciles the exact payload after a newer write", async (t) => {
  const superseding = { ...committed, version: 3, maxPauseSeconds: 1200, changedByActor: "operator-2" };
  const fetch = t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, endpoint);
    assert.equal(init.headers["X-BThwani-Operator"], actorId);
    if (init.method === "GET") return Response.json(superseding);
    assert.equal(init.method, "PATCH");
    assert.deepEqual(JSON.parse(init.body), change);
    if (fetch.mock.callCount() === 0) throw new TypeError("Network connection lost");
    return Response.json({ replay: true, policy: committed });
  });

  assert.deepEqual(await reconcileCityPolicy(endpoint, "sanaa", actorId, change), { status: "unknown" });
  assert.deepEqual(await reconcileCityPolicy(endpoint, "sanaa", actorId, change), {
    status: "confirmed", current: superseding, replay: true, superseded: true,
  });
  assert.equal(fetch.mock.callCount(), 3);
});

test("a successful PATCH still requires a matching or newer independent owner readback", async (t) => {
  const stale = { ...committed, version: 1 };
  const result = { replay: false, policy: committed };
  const fetch = t.mock.method(globalThis, "fetch", async (_url, init) =>
    Response.json(init.method === "PATCH" ? result : stale));
  assert.deepEqual(await reconcileCityPolicy(endpoint, "sanaa", actorId, change), { status: "unknown" });
  assert.equal(fetch.mock.callCount(), 2);
});

test("a PATCH result for another version, city or command cannot be reported as confirmed", async (t) => {
  for (const conflictingPolicy of [
    { ...committed, version: 3 },
    { ...committed, cityId: "aden" },
    { ...committed, changedByActor: "operator-2" },
    { ...committed, maxPauseSeconds: 601 },
  ]) {
    const fetch = t.mock.method(globalThis, "fetch", async () =>
      Response.json({ replay: true, policy: conflictingPolicy }));
    assert.deepEqual(await reconcileCityPolicy(endpoint, "sanaa", actorId, change), { status: "unknown" });
    assert.equal(fetch.mock.callCount(), 1);
    fetch.mock.restore();
  }
});

test("policy overview reports independent DSH relation reads and no implicit admission", async t => {
  const seen = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    seen.push(url);
    assert.equal(init.method, "GET");
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.headers["X-BThwani-Operator"], "operator-1");
    if (url.endsWith("/DIRECT")) {
      return Response.json({ cityId: "sanaa", relation: "DIRECT", version: 0, enabled: false });
    }
    return Response.json({
      cityId: "sanaa", relation: "MARKETPLACE", version: 1, enabled: true,
      termsVersion: "terms-market-1", termsText: "Approved registration only",
      changedByActor: "operator-1", changeReason: "Reviewed synthetic policy",
      updatedAt: "2026-11-23T00:00:00Z",
    });
  });
  const overview = await readRegistrationOverview("sanaa", "operator-1");
  assert.deepEqual(seen.sort(), [
    "/api/policies/cities/sanaa/store-registration/DIRECT",
    "/api/policies/cities/sanaa/store-registration/MARKETPLACE",
  ]);
  assert.equal(overview.DIRECT.status, "current");
  assert.equal(overview.DIRECT.policy.version, 0);
  assert.equal(overview.DIRECT.policy.enabled, false);
  assert.equal(overview.MARKETPLACE.status, "current");
  assert.equal(overview.MARKETPLACE.policy.enabled, true);
});

test("policy overview never labels an owner-read failure as closed registration", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async url => url.endsWith("/DIRECT")
    ? Response.json({ cityId: "sanaa", relation: "DIRECT", version: 0, enabled: false })
    : Response.json({ code: "IDENTITY_OWNER_UNAVAILABLE" }, { status: 503 }));
  const overview = await readRegistrationOverview("sanaa", "operator-1");
  assert.deepEqual(overview.MARKETPLACE, { status: "unavailable" });
  assert.equal(overview.DIRECT.status, "current");
  assert.equal(fetch.mock.callCount(), 2);
  await assert.rejects(readRegistrationOverview("../other", "operator-1"), /Invalid DSH city/);
  assert.equal(fetch.mock.callCount(), 2, "invalid city must never reach the BFF");
});

test("Operator policy audit pages bind the request to current city and relation", async t => {
  const entries = [
    { version: 2, enabled: false, termsVersion: "merchant-terms-v1",
      changedByActor: "operator-1", changeReason: "Closed new onboarding",
      updatedAt: "2026-11-23T09:00:00Z" },
    { version: 1, enabled: true, termsVersion: "merchant-terms-v1",
      changedByActor: "operator-1", changeReason: "Opened new onboarding",
      updatedAt: "2026-11-23T07:00:00Z" },
  ];
  const fetch = t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "/api/policies/cities/sanaa/store-registration/MARKETPLACE?history=1&limit=10");
    assert.equal(init.method, "GET");
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.headers["X-BThwani-Operator"], "operator-1");
    return Response.json({ entries });
  });
  assert.deepEqual(await readRegistrationHistory(
    "/api/policies/cities/sanaa/store-registration/MARKETPLACE",
    "sanaa", "MARKETPLACE", "operator-1",
  ), { entries });
  assert.equal(fetch.mock.callCount(), 1);
});

test("Operator policy audit reader refuses bad cursors, mismatched pages and denied access", async t => {
  const endpoint = "/api/policies/cities/sanaa/store-registration/DIRECT";
  const fetch = t.mock.method(globalThis, "fetch", async url => {
    assert.equal(url, endpoint + "?history=1&limit=10&beforeVersion=2");
    return Response.json({ entries: [{
      version: 2, enabled: true, termsVersion: "merchant-terms-v1",
      changedByActor: "operator-1", changeReason: "Invalid non-descending cursor",
      updatedAt: "2026-11-23T00:00:00Z",
    }] });
  });
  await assert.rejects(readRegistrationHistory(endpoint, "sanaa", "DIRECT", "operator-1", "../2"),
    /Invalid DSH history scope/);
  assert.equal(fetch.mock.callCount(), 0);
  await assert.rejects(readRegistrationHistory(endpoint, "sanaa", "DIRECT", "operator-1", "2"),
    /cursor mismatch/);
  assert.equal(fetch.mock.callCount(), 1);
  fetch.mock.restore();
  t.mock.method(globalThis, "fetch", async () => Response.json({ code: "FORBIDDEN" }, { status: 403 }));
  await assert.rejects(readRegistrationHistory(endpoint, "sanaa", "DIRECT", "operator-1"),
    /Identity rejected/);
});
