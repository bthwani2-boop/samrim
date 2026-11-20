import assert from "node:assert/strict";
import test from "node:test";
import { findWorkspaceEntry } from "../navigation/workspace-registry.ts";
import { canShowNavigation } from "../session/operator-permissions.ts";
import { reconcileCityPolicy } from "./city-policy-command.ts";

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
