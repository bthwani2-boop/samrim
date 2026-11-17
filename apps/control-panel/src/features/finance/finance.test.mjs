import assert from "node:assert/strict";
import test from "node:test";
import { findWorkspaceEntry } from "../navigation/workspace-registry.ts";
import { canShowNavigation } from "../session/operator-permissions.ts";

test("finance: routes have the expected navigation permission boundary", () => {
  for (const path of ["/finance","/finance/customer-withdrawals"]) {
    assert.equal(findWorkspaceEntry(path)?.permission ?? null, "finance");
  }
});

test("finance: unauthenticated or unmapped sessions never expose navigation", () => {
  assert.equal(canShowNavigation(false, ["operations", "finance", "platform_policies"], "finance"), false);
  assert.equal(canShowNavigation(true, [], "finance"), false);
});
