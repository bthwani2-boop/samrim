import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";

const component = readFileSync(new URL("./partner-independent-customer-policy.tsx", import.meta.url), "utf8");
const preview = readFileSync(new URL("./partner-independent-store-preview.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("./store-readback-client.ts", import.meta.url), "utf8");
const tree = ts.createSourceFile("partner-independent-customer-policy.tsx", component, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const producers = new Map();
function walk(node) {
  if (ts.isVariableDeclaration(node) && ["sameTerms", "fromPolicy"].includes(node.name.getText(tree))) {
    producers.set(node.name.getText(tree), node.getText(tree));
  }
  ts.forEachChild(node, walk);
}
walk(tree);
for (const key of ["sameTerms", "fromPolicy"]) assert.ok(producers.has(key), "extract production policy helper " + key);
const source = ts.transpileModule("const " + [...producers.values()].join(";const ") + ";({sameTerms,fromPolicy});", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const { sameTerms, fromPolicy } = vm.runInNewContext(source);

test("owner editor checks all four terms against canonical readback before claiming saved", () => {
  const policy = { storeId: "store-a", version: 2, policyVersion: "v2", reviewState: "NOT_CHECKED",
    cancellationTerms: "Cancellation policy", returnsTerms: "Returns policy",
    fulfillmentTerms: "Pickup service", collectionTerms: "Pay merchant" };
  const input = { ...fromPolicy(policy), expectedVersion: 1 };
  assert.equal(sameTerms(policy, input), true);
  for (const field of ["cancellationTerms", "returnsTerms", "fulfillmentTerms", "collectionTerms"]) {
    assert.equal(sameTerms(policy, { ...input, [field]: "changed text" }), false, field);
  }
  assert.match(component, /policy\.version >= attempt\.input\.expectedVersion \+ 1/);
  assert.match(component, /policy\.reviewState === "NOT_CHECKED"/);
  assert.match(component, /sameTerms\(policy, attempt\.input\)/);
});

test("Store owner-only editor is never the public Store or a marketplace publication control", () => {
  assert.match(preview, /if \(!store\.owned\)/);
  assert.match(preview, /PartnerIndependentCustomerPolicyDraftEditor key=\{store\.id\} storeID=\{store\.id\}/);
  assert.match(component, /لم تُعتمد للنشر بعد/);
  assert.doesNotMatch(component, /WLT|publishIndependent|checkoutEnabled/);
});

test("editor discards prior-session policy and suppresses old asynchronous replies", () => {
  assert.match(component, /subscribeIdentitySession\(next =>/);
  assert.match(component, /requestGeneration\.current \+= 1/);
  assert.match(component, /setDraft\(blank\)/);
  assert.match(component, /setPending\(null\)/);
  assert.match(component, /scope === partnerSetupSessionKey\(currentIdentityState\(\)\)/);
  assert.match(component, /if \(!stillCurrent\(\)\) return/);
  assert.match(component, /disabled=\{busy \|\| !valid \|\| \(!pending && !changed\)\}/);
});

test("uncertain PUT recovery retains the same attempt and rereads the DSH owner", () => {
  assert.match(component, /const attempt: Pending = pending \?\? \{ input, key: Crypto\.randomUUID\(\), correlation: Crypto\.randomUUID\(\) \}/);
  assert.match(component, /await saveOwnIndependentCustomerPolicyDraft\(storeID, attempt\.input, attempt\.key, attempt\.correlation\)/);
  assert.match(component, /const result = await readOwnIndependentCustomerPolicyDraft\(storeID\)/);
  assert.match(component, /disabled=\{busy \|\| Boolean\(pending\)\}/);
  assert.match(client, /dshClient\(\)\.readPartnerIndependentCustomerPolicyDraft\(token, storeID\)/);
  assert.match(client, /dshClient\(\)\.savePartnerIndependentCustomerPolicyDraft\(token, storeID, input, idempotencyKey, correlationID\)/);
});
