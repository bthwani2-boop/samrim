import assert from "node:assert/strict";
import test from "node:test";
import { evaluateIndex, rejectUntrackedFiles } from "./graphify-local.mjs";

const current = {
  repository: "d:/samrim",
  branch: "codex/close-as-you-go-20261120",
  head: "8661b0602f6fdc6988075594bfb48b3c556afe7c",
  worktree: "clean-fingerprint",
};
const indexed = {
  version: 1,
  ...current,
  graphSha256: "indexed-graph",
};

test("a verified graph is queryable when repository, branch, HEAD, edits and digest match", () => {
  assert.deepEqual(evaluateIndex(indexed, current, "indexed-graph"), {
    status: "PASS",
    queryable: true,
    reason: null,
  });
});

test("missing or incompatible index provenance blocks a query", () => {
  for (const value of [null, { ...indexed, version: 0 }]) {
    const result = evaluateIndex(value, current, "indexed-graph");
    assert.equal(result.queryable, false);
    assert.equal(result.status, "BLOCKED");
  }
});

for (const [field, different] of [
  ["repository", "d:/another-repo"],
  ["branch", "main"],
]) {
  test("a different " + field + " must not be queried as the active checkout", () => {
    const result = evaluateIndex(indexed, { ...current, [field]: different }, "indexed-graph");
    assert.equal(result.queryable, false);
    assert.equal(result.status, "BLOCKED");
  });
}

test("a newer local HEAD does not block querying the older graph", () => {
  const result = evaluateIndex(indexed, { ...current, head: "new-commit" }, "indexed-graph");
  assert.equal(result.queryable, true);
  assert.equal(result.status, "INVALIDATED");
  assert.match(result.reason, /HEAD/);
});

for (const kind of ["modified", "staged", "untracked"]) {
  test(kind + " files do not block read-only Graphify queries", () => {
    const result = evaluateIndex(indexed, { ...current, worktree: kind + "-snapshot" }, "indexed-graph");
    assert.equal(result.queryable, true);
    assert.equal(result.status, "INVALIDATED");
    assert.match(result.reason, /local tracked, staged or untracked/);
  });
}

test("a graph changed by a post-commit hook remains queryable with unverified revision", () => {
  const result = evaluateIndex(indexed, current, "hook-rewritten-graph");
  assert.equal(result.queryable, true);
  assert.equal(result.status, "INVALIDATED");
  assert.match(result.reason, /graph changed/);
});

test("combined source and graph changes preserve all coverage warnings", () => {
  const result = evaluateIndex(indexed, { ...current, head: "next-commit", worktree: "dirty" }, "other-digest");
  assert.equal(result.queryable, true);
  assert.match(result.reason, /graph changed/);
  assert.match(result.reason, /HEAD/);
  assert.match(result.reason, /local tracked/);
});

test("untracked symlinks are not opened by queries and still prevent unsafe refresh", () => {
  assert.doesNotThrow(() => rejectUntrackedFiles([]));
  assert.throws(() => rejectUntrackedFiles(["user-supplied.ts"]), /BLOCKED: review untracked/);
  assert.throws(() => rejectUntrackedFiles(["symlink-to-outside"]), /BLOCKED: review untracked/);
});
