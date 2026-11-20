import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { workspaceSubsections } from "../src/features/navigation/workspace-registry.ts";
import { canEnterOperatorWorkspace } from "../src/features/session/operator-permissions.ts";

const panel = resolve(import.meta.dirname, "..");
const page = (relative) => resolve(panel, "app/(workspace)/finance", relative, "page.tsx");

const renames = [
  ["partner-store-commissions", "merchant-store-commissions", "Settlements"],
  ["partner-commission-receivables", "merchant-commission-receivables", "Receivables"],
];

test("canonical merchant finance routes render existing WLT presentation components", () => {
  for (const [, canonical, component] of renames) {
    assert.ok(existsSync(page(canonical)), canonical + " must have a real Next route");
    assert.match(readFileSync(page(canonical), "utf8"), new RegExp("\\b" + component + "\\b"));
    assert.doesNotMatch(readFileSync(page(canonical), "utf8"), /\bredirect\(/);
  }
});

test("legacy finance URLs redirect to merchant routes without rendering private finance data", () => {
  for (const [legacy, canonical] of renames) {
    assert.ok(existsSync(page(legacy)), "existing bookmark " + legacy + " must remain routable");
    const text = readFileSync(page(legacy), "utf8");
    assert.match(text, /import \{ redirect \} from "next\/navigation"/);
    assert.ok(text.includes('redirect("/finance/' + canonical + '");'));
    assert.doesNotMatch(text, /Settlements|Receivables|fetch\(|getOrder\(/);
  }
});

test("Operator navigation points only to merchant finance URLs with current finance scope", () => {
  const items = workspaceSubsections.filter((item) => item.parent === "/finance");
  for (const [legacy, canonical] of renames) {
    assert.equal(items.filter((item) => item.href === "/finance/" + canonical).length, 1);
    assert.ok(items.every((item) => item.href !== "/finance/" + legacy));
    for (const path of ["/finance/" + canonical, "/finance/" + legacy]) {
      assert.equal(canEnterOperatorWorkspace(["finance"], path), true, path);
      assert.equal(canEnterOperatorWorkspace(["merchant"], path), false, path);
      assert.equal(canEnterOperatorWorkspace([], path), false, path);
    }
  }
});

test("canonical naming decision and agent execution guard remain in place", () => {
  const root = resolve(panel, "../..");
  const guard = readFileSync(resolve(root, "AGENTS.md"), "utf8");
  const policy = readFileSync(resolve(root, "governance/platform.md"), "utf8");
  assert.match(guard, /Mandatory Customer\/Merchant terminology and authorization guard/);
  assert.match(policy, /CUSTOMER_MERCHANT_CANONICAL_TERMS/);
});
