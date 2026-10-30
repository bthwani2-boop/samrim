import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("./fast-guard.yml", import.meta.url), "utf8");
const gates = new Map();
for (const line of workflow.split("\n")) {
  const match = line.match(/^\s*if changed '([^']+)'; then echo '([a-z]+)=true'/);
  if (match) gates.set(match[2], new RegExp(match[1]));
}
assert.deepEqual([...gates.keys()], ["dsh", "wlt", "identity", "finance", "node"]);

function selected(file) {
  return [...gates].filter(([, pattern]) => pattern.test(file)).map(([gate]) => gate).sort();
}
function requireGates(file, expected) {
  assert.deepEqual(selected(file), expected.sort(), file);
}

test("contract-only DSH changes schedule the DSH owner and TypeScript consumers", () => {
  requireGates("services/dsh/contracts/openapi/paths/catalog.yaml", ["dsh", "node"]);
  requireGates("services/dsh/contracts/openapi/paths/beneficiary-finance.yaml", ["dsh", "finance", "node"]);
});
test("WLT contract-only changes schedule wallet financial proof and generated consumers", () => {
  requireGates("services/wlt/contracts/openapi/wlt.openapi.yaml", ["wlt", "finance", "node"]);
});
test("Identity contract-only changes schedule identity and consumer verification", () => {
  requireGates("services/identity/contracts/openapi/identity.openapi.yaml", ["identity", "node"]);
});
test("unrelated docs are not misclassified as an executable service change", () => {
  requireGates("docs/reference/design/example.md", []);
});
test("CI protection does not silently execute invalid retired script remnants", () => {
  assert.doesNotMatch(workflow, /\+\[string\]\[char\]10/);
  assert.match(workflow, /apps\/control-panel\/tests\/historical-field-finance-readonly\.test\.mjs/);
  assert.match(workflow, /apps\/control-panel\/tests\/retired-field-wallet-destination-boundary\.test\.mjs/);
  assert.match(workflow, /\.github\/workflows\/fast-guard-routing\.test\.mjs/);
});
