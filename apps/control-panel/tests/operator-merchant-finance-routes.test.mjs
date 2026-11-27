import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { workspaceSubsections } from "../src/features/navigation/workspace-registry.ts";
import { canEnterOperatorWorkspace, isOperatorPermission } from "../src/features/session/operator-permissions.ts";

const panel = resolve(import.meta.dirname, "..");
const root = resolve(panel, "../..");
const financeRoot = resolve(panel, "app/(workspace)/finance");
const readPage = (name) => readFileSync(resolve(financeRoot, name, "page.tsx"), "utf8");
const financePath = (name) => `/finance/${name}`;
const policyAnchor = "customer_merchant_canonical_terms--binding-naming-and-ownership-rule";
const routes = [
  { legacy: "partner-store-commissions", canonical: "merchant-store-commissions", component: "CommercialAgreementReviewPage", module: "commercial-agreement-review" },
  { legacy: "partner-commission-receivables", canonical: "merchant-commission-receivables", component: "Receivables", module: "receivables" },
];

test("canonical Merchant finance routes delegate to the existing WLT presentation", () => {
  for (const route of routes) {
    const source = readPage(route.canonical);
    assert.ok(source.includes(`import ${route.component} from "../../../../src/features/finance/${route.module}"`), route.canonical);
    assert.match(source, new RegExp(`<${route.component}\\b`));
    assert.doesNotMatch(source, /\bredirect\s*\(/);
  }
});

test("retained legacy finance bookmarks only redirect, with no private data execution", () => {
  for (const route of routes) {
    const executable = readPage(route.legacy).replace(/^\s*\/\/[^\r\n]*$/gm, "").replace(/\s+/g, " ").trim();
    assert.equal(executable, `import { redirect } from "next/navigation"; export default function LegacyFinanceRoute() { redirect("${financePath(route.canonical)}"); }`, route.legacy);
  }
});

test("finance navigation admits one canonical entry per route and no legacy alias", () => {
  const financeItems = workspaceSubsections.filter((item) => item.parent === "/finance");
  for (const route of routes) {
    assert.equal(financeItems.filter((item) => item.href === financePath(route.canonical)).length, 1);
    assert.ok(financeItems.every((item) => item.href !== financePath(route.legacy)));
  }
});

test("canonical and compatibility routes require the current finance presentation grant", () => {
  for (const route of routes) {
    for (const name of [route.canonical, route.legacy]) {
      const path = financePath(name);
      assert.equal(canEnterOperatorWorkspace(["finance"], path), true, path);
      assert.equal(canEnterOperatorWorkspace(["merchant", "operations"], path), false, path);
      assert.equal(canEnterOperatorWorkspace(["merchant"], path), false, path);
      assert.equal(canEnterOperatorWorkspace([], path), false, path);
      assert.equal(canEnterOperatorWorkspace([], path, true), false, path);
    }
  }
  // Presentation guard only: actual Identity and WLT authorization require owner-backed evidence.
});

test("new Operator permissions accept canonical terms and reject retired aliases", () => {
  for (const permission of ["merchant", "finance"]) {
    assert.equal(isOperatorPermission(permission), true, permission);
  }
  for (const invalid of ["client", "customer", "partner", "partners", "app-client", "app-partner", "Merchant", "", null]) {
    assert.equal(isOperatorPermission(invalid), false, String(invalid));
  }
});

test("the agent entry resolves the canonical naming policy, independent of descriptive wording", () => {
  const entry = readFileSync(resolve(root, "AGENTS.md"), "utf8");
  const policy = readFileSync(resolve(root, "governance/platform.md"), "utf8");
  assert.ok(entry.includes(`](governance/platform.md#${policyAnchor})`), "execution entry must link to the actual naming owner");
  const headings = policy.split(/\r?\n/).filter((line) => /^#{1,6} /.test(line));
  const anchors = headings.map((line) => line.replace(/^#{1,6} /, "").toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-"));
  assert.equal(anchors.filter((anchor) => anchor === policyAnchor).length, 1, "the named policy has one actual owner section");
});
