import assert from "node:assert/strict";
import test from "node:test";
import { findWorkspaceEntry } from "../navigation/workspace-registry.ts";
import { canShowNavigation } from "../session/operator-permissions.ts";

test("operations: routes have the expected navigation permission boundary", () => {
  for (const path of ["/operations","/operations/abc","/captains"]) {
    assert.equal(findWorkspaceEntry(path)?.permission ?? null, "operations");
  }
});

test("operations: unauthenticated or unmapped sessions never expose navigation", () => {
  assert.equal(canShowNavigation(false, ["operations", "finance", "platform_policies"], "operations"), false);
  assert.equal(canShowNavigation(true, [], "operations"), false);
});
