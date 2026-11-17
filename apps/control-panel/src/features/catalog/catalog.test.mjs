import assert from "node:assert/strict";
import test from "node:test";
import { findWorkspaceEntry } from "../navigation/workspace-registry.ts";
import { canShowNavigation } from "../session/operator-permissions.ts";

test("catalog: routes have the expected navigation permission boundary", () => {
  for (const path of ["/catalog","/catalog/import"]) {
    assert.equal(findWorkspaceEntry(path)?.permission ?? null, "catalog");
  }
});

test("catalog: unauthenticated or unmapped sessions never expose navigation", () => {
  assert.equal(canShowNavigation(false, ["operations", "finance", "platform_policies"], "catalog"), false);
  assert.equal(canShowNavigation(true, [], "catalog"), false);
});
