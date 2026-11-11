import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";

const source = readFileSync(new URL("./mobile.ts", import.meta.url), "utf8");
const generated = readFileSync(new URL("./generated/dsh-operations.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("mobile.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const keys = ["readPartnerIndependentCustomerPolicyDraft", "savePartnerIndependentCustomerPolicyDraft"];
const methods = new Map();
function visit(node) {
  if (ts.isMethodDeclaration(node) && keys.includes(node.name.getText(ast))) {
    methods.set(node.name.getText(ast), node.getText(ast));
  }
  ts.forEachChild(node, visit);
}
visit(ast);
for (const key of keys) assert.ok(methods.has(key), "extract production DSH client method " + key);
const paths = Object.fromEntries(keys.map(key => {
  const expression = new RegExp(key + ': \\{ method: "(GET|PUT)", path: "([^"]+)" \\}');
  const match = generated.match(expression);
  assert.ok(match, "generated operation must match client method " + key);
  return [key, { method: match[1], path: match[2] }];
}));
assert.equal(paths[keys[0]].method, "GET");
assert.equal(paths[keys[1]].method, "PUT");
assert.equal(paths[keys[0]].path, paths[keys[1]].path);

function harness() {
  const calls = [];
  const code = ts.transpileModule("const client = { " + [...methods.values()].join(", ") + " }; client;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const client = vm.runInNewContext(code, {
    dshOperationPaths: paths,
    userRequest: async (...args) => {
      calls.push(args);
      return { draftOnly: true, policy: { storeId: "store/1", version: 0 } };
    },
    mutationHeaders: (key, correlation) => ({ "Idempotency-Key": key, "X-Correlation-ID": correlation }),
    encodeURIComponent,
  });
  return { client, calls };
}

test("private policy GET routes through canonical generated DSH method with only the bearer", async () => {
  const { client, calls } = harness();
  const result = await client.readPartnerIndependentCustomerPolicyDraft("qa-partner-session", " store/1 ");
  assert.equal(result.draftOnly, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "qa-partner-session");
  assert.equal(calls[0][1], paths[keys[0]].path.replace("{storeId}", "store%2F1"));
  assert.equal(calls[0][2], "GET");
  assert.equal(calls[0][3], undefined);
});

test("private policy PUT preserves exact version, terms and idempotency without actor spoofing", async () => {
  const { client, calls } = harness();
  const input = { expectedVersion: 0, cancellationTerms: "Cancellation details", returnsTerms: "Returns terms",
    fulfillmentTerms: "Pickup only", collectionTerms: "Pay merchant directly" };
  await client.savePartnerIndependentCustomerPolicyDraft("qa-partner-session", " store/1 ", input,
    "independent-policy-key-0001", "independent-policy-correlation-0001");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], paths[keys[1]].path.replace("{storeId}", "store%2F1"));
  assert.equal(calls[0][2], "PUT");
  assert.equal(calls[0][3], input);
  assert.deepEqual({ ...calls[0][4] }, { "Idempotency-Key": "independent-policy-key-0001",
    "X-Correlation-ID": "independent-policy-correlation-0001" });
  assert.equal("X-Actor-ID" in calls[0][4], false);
});

test("draft client rejects unscoped or unversioned mutations before issuing a request", async () => {
  const { client, calls } = harness();
  const input = { expectedVersion: 0, cancellationTerms: "Cancel", returnsTerms: "Return",
    fulfillmentTerms: "Pickup", collectionTerms: "Pay" };
  await assert.rejects(client.readPartnerIndependentCustomerPolicyDraft("partner", ""), /STORE_INVALID/);
  await assert.rejects(client.savePartnerIndependentCustomerPolicyDraft("partner", "", input, "valid-attempt-id-000001", "valid-correlation-00001"), /INPUT_INVALID/);
  await assert.rejects(client.savePartnerIndependentCustomerPolicyDraft("partner", "store", { ...input, expectedVersion: -1 }, "valid-attempt-id-000001", "valid-correlation-00001"), /INPUT_INVALID/);
  await assert.rejects(client.savePartnerIndependentCustomerPolicyDraft("partner", "store", input, "short", "valid-correlation-00001"), /INPUT_INVALID/);
  await assert.rejects(client.savePartnerIndependentCustomerPolicyDraft("partner", "store", input, "valid-attempt-id-000001", "bad"), /INPUT_INVALID/);
  assert.equal(calls.length, 0);
});
