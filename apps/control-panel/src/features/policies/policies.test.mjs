import assert from "node:assert/strict";
import test from "node:test";
import { findWorkspaceEntry } from "../navigation/workspace-registry.ts";
import { canShowNavigation } from "../session/operator-permissions.ts";

test("policies: routes have the expected navigation permission boundary", () => {
  for (const path of ["/policies","/policies/stage-sla"]) {
    assert.equal(findWorkspaceEntry(path)?.permission ?? null, "platform_policies");
  }
});

test("policies: unauthenticated or unmapped sessions never expose navigation", () => {
  assert.equal(canShowNavigation(false, ["operations", "finance", "platform_policies"], "platform_policies"), false);
  assert.equal(canShowNavigation(true, [], "platform_policies"), false);
});
