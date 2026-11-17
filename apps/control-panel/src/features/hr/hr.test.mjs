import assert from "node:assert/strict";
import test from "node:test";
import { findWorkspaceEntry } from "../navigation/workspace-registry.ts";
import { canShowNavigation } from "../session/operator-permissions.ts";

test("hr: routes have the expected navigation permission boundary", () => {
  for (const path of ["/hr","/hr/employees/abc"]) {
    assert.equal(findWorkspaceEntry(path)?.permission ?? null, "hr");
  }
});

test("hr: unauthenticated or unmapped sessions never expose navigation", () => {
  assert.equal(canShowNavigation(false, ["operations", "finance", "platform_policies"], "hr"), false);
  assert.equal(canShowNavigation(true, [], "hr"), false);
});
