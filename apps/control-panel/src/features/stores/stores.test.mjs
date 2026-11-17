import assert from "node:assert/strict";
import test from "node:test";
import { findWorkspaceEntry } from "../navigation/workspace-registry.ts";
import { canShowNavigation } from "../session/operator-permissions.ts";

test("stores: routes have the expected navigation permission boundary", () => {
  for (const path of ["/merchants","/merchants/stores/abc"]) {
    assert.equal(findWorkspaceEntry(path)?.permission ?? null, "partners");
  }
});

test("stores: unauthenticated or unmapped sessions never expose navigation", () => {
  assert.equal(canShowNavigation(false, ["operations", "finance", "platform_policies"], "partners"), false);
  assert.equal(canShowNavigation(true, [], "partners"), false);
});
