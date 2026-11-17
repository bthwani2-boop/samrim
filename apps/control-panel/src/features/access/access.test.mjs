import assert from "node:assert/strict";
import test from "node:test";
import { findWorkspaceEntry } from "../navigation/workspace-registry.ts";
import { canShowNavigation } from "../session/operator-permissions.ts";

test("access: routes have the expected navigation permission boundary", () => {
  for (const path of ["/access","/access/operators/abc"]) {
    assert.equal(findWorkspaceEntry(path)?.permission ?? null, null);
  }
});

test("access: unauthenticated or unmapped sessions never expose navigation", () => {
  assert.equal(canShowNavigation(false, ["operations", "finance", "platform_policies"], null), false);
  assert.equal(canShowNavigation(true, [], null), false);
});
