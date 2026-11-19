import assert from "node:assert/strict";
import test from "node:test";
import { findWorkspaceEntry } from "../navigation/workspace-registry.ts";
import { canEnterOperatorWorkspace, canShowNavigation } from "../session/operator-permissions.ts";

test("access: routes have the expected navigation permission boundary", () => {
  for (const path of ["/access","/access/operators/abc"]) {
    assert.equal(findWorkspaceEntry(path)?.permission ?? null, null);
  }
});

test("access: unauthenticated or unmapped sessions never expose navigation", () => {
  assert.equal(canShowNavigation(false, ["operations", "finance", "platform_policies"], null), false);
  assert.equal(canShowNavigation(true, [], null), false);
});

test("access: only current effective Identity grants allow mapped Operator routes", () => {
  assert.equal(canEnterOperatorWorkspace([], "/workspace"), false);
  assert.equal(canEnterOperatorWorkspace(["operations"], "/workspace"), true);
  assert.equal(canEnterOperatorWorkspace(["operations"], "/operations"), true);
  assert.equal(canEnterOperatorWorkspace(["operations"], "/operations/orders/one"), true);
  for (const path of ["/finance", "/hr", "/access", "/customers", "/notifications", "/somewhere", "/operations-other"]) {
    assert.equal(canEnterOperatorWorkspace(["operations"], path), false, path);
  }
  assert.equal(canEnterOperatorWorkspace(["finance"], "/finance"), true);
  assert.equal(canEnterOperatorWorkspace(["finance"], "/operations"), false);
  assert.equal(canEnterOperatorWorkspace(["platform_policies"], "/policies/stage-sla"), true);
});
