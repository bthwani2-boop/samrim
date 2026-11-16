import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const panel = resolve(import.meta.dirname, "..");
const file = (path) => resolve(panel, path);
const read = (path) => readFileSync(file(path), "utf8");

test("Operator workspace keeps control-panel identity and uses a real Next route group", () => {
  for (const path of ["app/page.tsx", "app/(workspace)/layout.tsx",
    "app/(workspace)/workspace/page.tsx", "proxy.ts"]) {
    assert.ok(existsSync(file(path)), path);
  }
  assert.match(read("app/page.tsx"), /OperatorEntryScreen/);
  assert.match(read("app/(workspace)/workspace/page.tsx"), /OperatorDashboardPage/);
  assert.equal(existsSync(file("src/app")), false);
});

test("Operator workspace fails closed without Identity; no public dashboard data", () => {
  const layout = read("app/(workspace)/layout.tsx");
  assert.match(layout, /OperatorWorkspaceGate/);
  assert.doesNotMatch(layout, /\{children\}|<\w+\s+children=/);
  const gate = read("src/features/access/operator-workspace-gate.tsx");
  assert.match(gate, /غير متاح/);
  assert.doesNotMatch(gate, /fetch\(|getOrder\(|useSession\(/);
  const entry = read("src/features/access/operator-entry-screen.tsx");
  assert.match(entry, /لوحة تحكم بثواني/);
  assert.doesNotMatch(entry, /setSession\(|localStorage|mock/i);
});
