import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript-ast");
const source = readFileSync(new URL("../src/navigation/workspace-registry.ts", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/(workspace)/layout.tsx", import.meta.url), "utf8");
const hr = readFileSync(new URL("../src/features/hr/hr-center-workspace.tsx", import.meta.url), "utf8");
const entries = readFileSync(new URL("../src/features/webmcp/workspace-entry-access.ts", import.meta.url), "utf8");

const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const registry = {};
new Function("exports", "require", compiled)(registry, (specifier) => {
  assert.equal(specifier, "../features/policies/policy-capabilities");
  return { policyCapabilities: [] };
});
const { workspaceDestinations, canOpenWorkspaceDestination, canOpenWorkspaceRoute, currentWorkspaceDestination } = registry;
const operator = (permissions, canManageOperatorPermissions = false) =>
  ({ role: "operator", permissions, canManageOperatorPermissions });
const visible = (identity) => workspaceDestinations
  .filter((destination) => destination.showInWorkspaceNavigation !== false && canOpenWorkspaceDestination(identity, destination))
  .map((destination) => destination.href);

test("the authorized operator has exactly eight navigation groups and preserved nested routes", () => {
  const full = operator(["operations", "partners", "catalog", "marketing", "finance", "hr", "platform_policies"], true);
  assert.deepEqual(visible(full), ["/workspace", "/operations", "/partners", "/catalog", "/marketing", "/finance", "/hr", "/policies"]);
  assert.equal(currentWorkspaceDestination("/studio").href, "/marketing");
  assert.equal(currentWorkspaceDestination("/access/operators/%2B96712345678").href, "/hr");
  assert.equal(currentWorkspaceDestination("/hr/employees").href, "/hr");
  assert.ok(canOpenWorkspaceRoute(full, "/studio"));
  assert.ok(canOpenWorkspaceRoute(full, "/access/operators/%2B96712345678"));
});

test("HR and Identity-admin authorization remain independent in navigation", () => {
  const hrOnly = operator(["hr"]);
  assert.deepEqual(visible(hrOnly), ["/workspace", "/hr"]);
  assert.equal(canOpenWorkspaceRoute(hrOnly, "/hr/employees"), true);
  assert.equal(canOpenWorkspaceRoute(hrOnly, "/access"), false);
  assert.equal(canOpenWorkspaceRoute(hrOnly, "/access/operators/%2B96712345678"), false);

  const adminOnly = operator([], true);
  assert.deepEqual(visible(adminOnly), ["/workspace", "/hr"]);
  assert.equal(canOpenWorkspaceRoute(adminOnly, "/hr/employees"), false);
  assert.equal(canOpenWorkspaceRoute(adminOnly, "/access"), true);
  assert.equal(canOpenWorkspaceRoute(adminOnly, "/access?view=permissions"), true);

  const marketingOnly = operator(["marketing"]);
  assert.deepEqual(visible(marketingOnly), ["/workspace", "/marketing"]);
  assert.equal(canOpenWorkspaceRoute(marketingOnly, "/studio"), true);
  assert.equal(canOpenWorkspaceRoute(marketingOnly, "/access"), false);
  assert.equal(canOpenWorkspaceRoute(marketingOnly, "/hr"), false);
});

test("sidebar, search, WebMCP, and HR hub reuse the same navigation permissions", () => {
  assert.match(layout, /canOpenWorkspaceRoute\(identity, child\.href\)/);
  assert.match(layout, /workspaceSearchEntries\.filter\(\(entry\) => canOpenWorkspaceRoute\(identity, entry\.href\)\)/);
  assert.match(entries, /if \(!canOpenWorkspaceRoute\(identity, href\)\) return false/);
  assert.match(hr, /if\(!hasHR\) return <section/);
  assert.match(hr, /canManageOperators\?<p><Link href="\/access"/);
  assert.match(hr, /<EmployeeDirectory\/>/);
});
