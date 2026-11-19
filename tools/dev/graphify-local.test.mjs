import assert from "node:assert/strict";
import test from "node:test";
import { evaluateIndex } from "./graphify-local.mjs";

const current = {
  repository: "d:/samrim",
  branch: "codex/next-capability-20261118",
  head: "8661b0602f6fdc6988075594bfb48b3c556afe7c",
  worktree: "dirty-fingerprint",
};
const indexed = {
  version: 1,
  ...current,
  graphSha256: "graph-fingerprint",
};

test("accept a local graph only when repository, branch, HEAD, edits and graph match", () => {
  assert.equal(evaluateIndex(indexed, current, "graph-fingerprint"), null);
});

test("reject an index without independently recorded provenance", () => {
  assert.match(evaluateIndex(null, current, "graph-fingerprint"), /INVALIDATED/);
  assert.match(evaluateIndex({ ...indexed, version: 0 }, current, "graph-fingerprint"), /INVALIDATED/);
});

for (const [field, different] of [
  ["repository", "d:/other"],
  ["branch", "main"],
  ["head", "another-commit"],
  ["worktree", "another-dirty-snapshot"],
]) {
  test("reject an index built with a different " + field, () => {
    assert.match(evaluateIndex(indexed, { ...current, [field]: different }, "graph-fingerprint"), /INVALIDATED/);
  });
}

test("reject a graph changed independently of the verified local refresh", () => {
  assert.match(evaluateIndex(indexed, current, "different-graph"), /INVALIDATED/);
});
