import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { findWorkspaceEntry, workspaceGroupLabels, workspaceRegistry, workspaceSubsections } from "../navigation/workspace-registry.ts";
import { canEnterOperatorWorkspace, canShowNavigation, visibleWorkspaceEntries } from "../session/operator-permissions.ts";

const allGrants = ["operations", "merchant", "catalog", "marketing", "finance", "hr", "platform_policies"];
const permissionCases = [
  [null, ["/access", "/access/operators/abc"]],
  ["operations", ["/operations", "/operations/abc", "/captains"]],
  ["merchant", ["/merchants", "/merchants/stores/abc"]],
  ["catalog", ["/catalog", "/catalog/import"]],
  ["marketing", ["/marketing", "/studio"]],
  ["finance", ["/finance", "/finance/customer-withdrawals"]],
  ["hr", ["/hr", "/hr/employees/abc"]],
  ["platform_policies", ["/policies", "/policies/stage-sla"]],
];

for (const [permission, routes] of permissionCases) {
  test("Operator navigation permission boundary: " + (permission ?? "original-operator"), () => {
    for (const route of routes) {
      assert.equal(findWorkspaceEntry(route)?.permission ?? null, permission, route);
      assert.equal(canEnterOperatorWorkspace([], route), false, route);
      if (permission !== null) {
        assert.equal(canEnterOperatorWorkspace([permission], route), true, route);
        for (const other of allGrants.filter(grant => grant !== permission)) {
          assert.equal(canEnterOperatorWorkspace([other], route), false, route);
        }
      }
    }
    assert.equal(canShowNavigation(false, ["operations", "finance", "platform_policies"], permission), false);
    assert.equal(canShowNavigation(false, allGrants, permission), false);
    assert.equal(canShowNavigation(true, [], permission), false);
    assert.equal(canShowNavigation(true, allGrants, permission), permission !== null);
  });
}

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

test("access: the owner-confirmed original Operator enters without a delegated scope", () => {
  assert.equal(canEnterOperatorWorkspace(["finance", "platform_policies"], "/access"), false);
  assert.equal(canEnterOperatorWorkspace([], "/access", true), true);
  assert.equal(canEnterOperatorWorkspace([], "/access/operators/operator-1", true), true);
  assert.equal(canEnterOperatorWorkspace([], "/hr", true), false);
  assert.deepEqual(visibleWorkspaceEntries([], true).map(item => item.href), ["/access"]);
});

test("Operator navigation retains all routes allowed by the current grants", () => {
  assert.deepEqual(visibleWorkspaceEntries([]), []);
  assert.deepEqual(visibleWorkspaceEntries(["operations"]).map(item => item.href), ["/workspace", "/operations", "/captains"]);
  assert.deepEqual(visibleWorkspaceEntries(["marketing"]).map(item => item.href), ["/workspace", "/marketing", "/studio"]);
  const grants = ["operations", "merchant", "catalog", "marketing", "finance", "hr", "platform_policies"];
  const entries = visibleWorkspaceEntries(grants);
  assert.deepEqual([...new Set(entries.map(item => item.group))], [
    "home", "operations", "stores", "catalog", "marketing", "finance", "administration", "policies",
  ]);
  assert.equal(new Set(entries.map(item => item.href)).size, entries.length);
  for (const entry of entries) {
    assert.ok(workspaceGroupLabels[entry.group]);
    assert.equal(canEnterOperatorWorkspace(grants, entry.href), true);
  }
  assert.equal(entries.some(item => ["/access", "/customers", "/notifications"].includes(item.href)), false);
});

test("function tabs point to existing pages under their canonical permissioned section", () => {
  const panelRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const seen = new Set();
  for (const section of workspaceSubsections) {
    assert.equal(seen.has(section.href), false, section.href);
    seen.add(section.href);
    const parent = workspaceRegistry.find(entry => entry.href === section.parent);
    assert.ok(parent, section.parent);
    assert.ok(parent.permission, section.parent);
    assert.equal(section.href.startsWith(`${section.parent}/`), true, section.href);
    assert.equal(findWorkspaceEntry(section.href)?.href, section.parent);
    assert.equal(canEnterOperatorWorkspace([], section.href), false);
    assert.equal(canEnterOperatorWorkspace([parent.permission], section.href), true);
    assert.ok(existsSync(path.join(panelRoot, "app", "(workspace)", section.href.slice(1), "page.tsx")), section.href);
  }
});

test("merchant navigation and page headings use canonical trader/store terminology without altering grants", () => {
  const merchant = workspaceRegistry.find((entry) => entry.href === "/merchants");
  assert.equal(merchant?.label, "التجار والمتاجر");
  assert.equal(merchant?.permission, "merchant");
  assert.deepEqual(workspaceSubsections.filter((entry) => entry.parent === "/merchants").slice(0, 2).map((entry) => entry.label), [
    "مراجعة المتاجر غير المنشورة",
    "إضافة تاجر",
  ]);
  const panelRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  for (const [relative, text] of [
    ["app/(workspace)/merchants/page.tsx", "إدارة التجار والمتاجر"],
    ["src/features/stores/stores-workspace.tsx", "التجار والمتاجر"],
    ["app/(workspace)/finance/merchant-store-commissions/page.tsx", "عمولات المتاجر"],
    ["app/(workspace)/finance/merchant-commission-receivables/page.tsx", "ذمم عمولات التجار"],
    ["app/(workspace)/merchants/public-stores/page.tsx", "صلاحية إدارة التجار"],
    ["app/(workspace)/merchants/public-stores/[storeId]/page.tsx", "صلاحية إدارة التجار"],
  ]) {
    const source = readFileSync(path.join(panelRoot, relative), "utf8");
    assert.ok(source.includes(text), relative);
    assert.doesNotMatch(source, /الشركاء|شريك/, relative);
  }
});
