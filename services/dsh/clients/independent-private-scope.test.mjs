import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";

const source = readFileSync(new URL("./mobile.ts", import.meta.url), "utf8");
const generated = readFileSync(new URL("./generated/dsh-operations.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("mobile.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const methodsToTest = [
  "readPartnerIndependentStorePreview",
  "readPartnerIndependentCustomerPolicyDraft",
  "savePartnerIndependentCustomerPolicyDraft",
];
const methods = new Map();
function visit(node) {
  if (ts.isMethodDeclaration(node) && methodsToTest.includes(node.name.getText(ast))) {
    methods.set(node.name.getText(ast), node.getText(ast));
  }
  ts.forEachChild(node, visit);
}
visit(ast);
for (const name of methodsToTest) assert.ok(methods.has(name), "missing actual DSH mobile method " + name);
const paths = Object.fromEntries(methodsToTest.map(name => {
  const match = generated.match(new RegExp(name + ': \\{ method: "(GET|PUT)", path: "([^"]+)" \\}'));
  assert.ok(match, "missing generated DSH method " + name);
  return [name, { method: match[1], path: match[2] }];
}));
const code = ts.transpileModule("const client = {" + [...methods.values()].join(", ") + "}; client;", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
function harness(response) {
  const calls = [];
  const client = vm.runInNewContext(code, {
    dshOperationPaths: paths,
    userRequest: async (...args) => {
      calls.push(args);
      return structuredClone(response);
    },
    mutationHeaders: (key, correlation) => ({
      "Idempotency-Key": key,
      "X-Correlation-ID": correlation,
    }),
    URLSearchParams,
    encodeURIComponent,
  });
  return { calls, client };
}
const preview = () => ({
  storeId: "store-a", relationModel: "INDEPENDENT_STORE", previewOnly: true,
  checkoutEnabled: false, offers: [], nextCursor: "", name: "اختبار خاص",
});
const policy = () => ({
  policy: { storeId: "store-a", version: 2, cancellationTerms: "clear" },
  draftOnly: true,
});

test("owner preview keeps exact authenticated endpoint and private-only flags", async () => {
  const { client, calls } = harness(preview());
  const response = await client.readPartnerIndependentStorePreview("partner-token", " store-a ", 15);
  assert.equal(response.previewOnly, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "partner-token");
  assert.match(calls[0][1], /\/dsh\/partner\/stores\/store-a\/independent-preview\?limit=15/);
  assert.equal(calls[0][2], "GET");
});
for (const [reason, altered] of [
  ["other Store", { storeId: "store-b" }],
  ["other relation", { relationModel: "BTHWANI_PARTNER" }],
  ["public visibility flag", { previewOnly: false }],
  ["checkout enabled", { checkoutEnabled: true }],
  ["malformed list", { offers: null }],
]) {
  test("owner preview fails closed for " + reason, async () => {
    const { client } = harness({ ...preview(), ...altered });
    await assert.rejects(client.readPartnerIndependentStorePreview("partner-token", "store-a"), /DSH_INDEPENDENT_PREVIEW_SCOPE_MISMATCH/);
  });
}
test("owner policy draft accepts exact private Store response", async () => {
  const { client, calls } = harness(policy());
  const result = await client.readPartnerIndependentCustomerPolicyDraft("partner-token", "store-a");
  assert.equal(result.policy.storeId, "store-a");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2], "GET");
});
for (const [reason, altered] of [
  ["other Store", { policy: { storeId: "store-b" } }],
  ["not private draft", { draftOnly: false }],
]) {
  test("owner policy GET fails closed for " + reason, async () => {
    const { client } = harness({ ...policy(), ...altered });
    await assert.rejects(client.readPartnerIndependentCustomerPolicyDraft("partner-token", "store-a"), /DSH_INDEPENDENT_POLICY_SCOPE_MISMATCH/);
  });
}
const mutationInput = {
  expectedVersion: 2,
  cancellationTerms: "cancel", returnsTerms: "returns",
  fulfillmentTerms: "pickup", collectionTerms: "cash",
};
test("owner policy PUT returns exact Store draft with idempotent attempt metadata", async () => {
  const { client, calls } = harness({ ...policy(), idempotentReplay: false });
  const result = await client.savePartnerIndependentCustomerPolicyDraft(
    "partner-token", "store-a", mutationInput,
    "unique-transaction-key-123456", "correlation-key-123456",
  );
  assert.equal(result.policy.storeId, "store-a");
  assert.equal(calls[0][2], "PUT");
  assert.deepEqual({ ...calls[0][4] }, {
    "Idempotency-Key": "unique-transaction-key-123456",
    "X-Correlation-ID": "correlation-key-123456",
  });
  assert.equal(calls[0][3], mutationInput);
});
for (const [reason, altered] of [
  ["other Store", { policy: { storeId: "store-b" } }],
  ["not private draft", { draftOnly: false }],
]) {
  test("owner policy PUT fails closed for " + reason, async () => {
    const { client } = harness({ ...policy(), idempotentReplay: false, ...altered });
    await assert.rejects(client.savePartnerIndependentCustomerPolicyDraft(
      "partner-token", "store-a", mutationInput,
      "unique-transaction-key-123456", "correlation-key-123456",
    ), /DSH_INDEPENDENT_POLICY_SCOPE_MISMATCH/);
  });
}
